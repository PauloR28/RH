"""WFM — solicitação de troca de plantões (Fase 1 ampliada). Mixin do DatabaseRepository.

Fluxo e regras de calendário/prazo/elegibilidade: `services/wfm_trocas.py` (puro). Aqui ficam o
acesso a dados, o escopo (services/wfm_scope.py) e a aplicação da troca na escala.

Garantias:
  * Nenhuma troca é automática: mesmo com B de acordo, um Supervisor/Control Desk/Gestor aprova.
  * Quem é parte da troca nunca a decide (conflito de interesse), checado no servidor.
  * Editar a escala de A ou B depois do pedido invalida a troca (não se aprova sobre dado velho).
  * Vencido o prazo (48h úteis) a troca expira e fica registrada para os dois operadores.
  * Aprovar altera o rascunho E gera uma nova versão publicada (histórico imutável); desfazer é
    outra nova versão, com justificativa, tudo auditado.
  * Notificação pelo Teams fica para a Fase 2: por ora os avisos são a linha do tempo da troca.
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_SUPERVISOR, WFM_PERFIS_PARTICIPANTES
from ..services import wfm_scope, wfm_trocas as regras
from .wfm_aprovacao import hash_snapshot
from ..services.helpers import normalize_text
from ..services.wfm_montagem import EventoCalendario, TurnoModelo, horario_efetivo
from ..services.wfm_regras import CONTEXTO_TROCA, SEVERIDADE_BLOQUEIO

PARAMS = regras.ParametrosTroca()
ANTECEDENCIA_PADRAO_DIAS = 3


def _params_da_escala(cursor, operacao: str) -> regras.ParametrosTroca:
    """Parâmetros de troca da escala: antecedência mínima configurável (dias) em wfm_operacao_config."""
    cursor.execute("SELECT troca_antecedencia_dias FROM dbo.wfm_operacao_config WHERE operacao = ?", (operacao,))
    row = cursor.fetchone()
    dias = int(row[0]) if row and row[0] is not None else ANTECEDENCIA_PADRAO_DIAS
    return regras.ParametrosTroca(antecedencia_horas=dias * 24)


def _http(codigo: int, detalhe: Any) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def _data(valor: Any) -> date:
    try:
        return valor if isinstance(valor, date) else date.fromisoformat(str(valor))
    except ValueError:
        raise _http(status.HTTP_400_BAD_REQUEST, "Data inválida (AAAA-MM-DD).")


def _chave_violacao(v: dict) -> tuple:
    return (v["id_operador"], v["codigo"], v["data"])


class WfmTrocasRepositoryMixin:
    # ------------------------------------------------------------------
    # Auxiliares
    # ------------------------------------------------------------------
    def _wfm_agora(self) -> datetime:
        """Relógio do servidor (ponto único para testes)."""
        return datetime.now().replace(microsecond=0)

    def _tr_evento(self, cursor, user, operacao: str, id_troca: int, evento: str, detalhe: str = "") -> None:
        cursor.execute(
            "INSERT INTO dbo.wfm_trocas_eventos (operacao, id_troca, evento, por_id, por_nome, detalhe) VALUES (?, ?, ?, ?, ?, ?)",
            (
                operacao, int(id_troca), evento, getattr(user, "id_usuario", None),
                (normalize_text(getattr(user, "nome", "")) or "sistema") if user else "sistema",
                normalize_text(detalhe)[:600] or None,
            ),
        )

    def _tr_feriados(self, cursor, operacao: str, ini: date, fim: date) -> frozenset[date]:
        cursor.execute(
            "SELECT data_ini, data_fim FROM dbo.wfm_calendario_especial WHERE operacao = ? AND ativo = 1 AND tipo = 'FERIADO' "
            "AND data_ini <= ? AND data_fim >= ?",
            (operacao, fim, ini),
        )
        dias: set[date] = set()
        for a, b in cursor.fetchall():
            d = a
            while d <= b:
                dias.add(d)
                d += timedelta(days=1)
        return frozenset(dias)

    def _tr_celulas(self, cursor, operacao: str, ids: list[int], datas: tuple[date, ...]) -> dict:
        """(id_operador, data) -> {"id_turno", "versao_linha"} ou None (sem escala)."""
        celulas: dict = {(i, d): None for i in ids for d in datas}
        marcadores_i = ",".join("?" for _ in ids)
        marcadores_d = ",".join("?" for _ in datas)
        cursor.execute(
            f"SELECT id_operador, data, id_turno, versao_linha, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens WHERE operacao = ? "
            f"AND id_operador IN ({marcadores_i}) AND data IN ({marcadores_d})",
            (operacao, *ids, *datas),
        )
        for r in cursor.fetchall():
            celulas[(int(r[0]), r[1])] = {"id_turno": int(r[2]), "versao_linha": int(r[3]), "ajuste": (r[4], r[5]) if r[4] and r[5] else None}
        return celulas

    def _tr_eventos_calendario(self, cursor, operacao: str, ini: date, fim: date) -> list[EventoCalendario]:
        cursor.execute(
            "SELECT tipo, data_ini, data_fim, id_turno, entrada, saida FROM dbo.wfm_calendario_especial "
            "WHERE operacao = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?",
            (operacao, fim, ini),
        )
        return [EventoCalendario(normalize_text(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in cursor.fetchall()]

    def _tr_contrato_tipo(self, cursor, operacao: str, id_operador: int, data: date) -> str | None:
        cursor.execute(
            """
            SELECT TOP 1 c.tipo FROM dbo.wfm_operador_contratos oc JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato
            WHERE oc.operacao = ? AND oc.id_operador = ? AND oc.vigencia_ini <= ? AND (oc.vigencia_fim IS NULL OR oc.vigencia_fim >= ?)
            ORDER BY oc.vigencia_ini DESC
            """,
            (operacao, int(id_operador), data, data),
        )
        row = cursor.fetchone()
        return normalize_text(row[0]) if row else None

    def _tr_skills(self, cursor, operacao: str, id_operador: int) -> frozenset[int]:
        cursor.execute("SELECT id_skill FROM dbo.wfm_usuario_skills WHERE operacao = ? AND id_usuario = ?", (operacao, int(id_operador)))
        return frozenset(int(r[0]) for r in cursor.fetchall())

    def _tr_inicios(self, cursor, operacao: str, celulas: dict, datas: tuple[date, ...], ids: list[int]) -> list[datetime]:
        """Início (datetime) de cada turno de TRABALHO das células envolvidas, com calendário especial aplicado."""
        modelos = self._wfm_turnos_modelo(cursor, operacao)
        eventos = self._tr_eventos_calendario(cursor, operacao, min(datas), max(datas))
        inicios: list[datetime] = []
        for i in ids:
            for d in datas:
                c = celulas.get((i, d))
                if c and c["id_turno"] in modelos:
                    h = horario_efetivo(d, modelos[c["id_turno"]], modelos, eventos, c.get("ajuste"))
                    if h["trabalha"]:
                        inicios.append(datetime.combine(d, time.fromisoformat(h["entrada"])))
        return inicios

    def _tr_trabalha(self, cursor, operacao: str, celula: dict | None) -> bool:
        if not celula:
            return False
        modelos = self._wfm_turnos_modelo(cursor, operacao)
        turno = modelos.get(celula["id_turno"])
        return bool(turno and turno.tipo == "TRABALHO")

    def _tr_simular(self, cursor, operacao: str, id_a: int, id_b: int, datas: tuple[date, ...]) -> tuple[list[dict], list[dict]]:
        """(bloqueios novos, alertas) provocados pela troca, comparando com a escala atual."""
        celulas = self._tr_celulas(cursor, operacao, [id_a, id_b], datas)
        simples = {k: (v["id_turno"] if v else None) for k, v in celulas.items()}
        depois = regras.aplicar_troca(simples, id_a, id_b, datas)
        segunda, domingo = regras.semana_de(datas[0])
        operadores = self._wfm_todos_operadores(cursor, operacao)
        alvo = [o for o in operadores if o["id_usuario"] in (id_a, id_b)]
        ano_mes = f"{segunda.year}-{segunda.month:02d}"
        antes_v = self._wfm_violacoes(cursor, operacao, ano_mes, alvo, periodo=(segunda, domingo), contexto=CONTEXTO_TROCA)
        depois_v = self._wfm_violacoes(cursor, operacao, ano_mes, alvo, sobrescritas=depois, periodo=(segunda, domingo), contexto=CONTEXTO_TROCA)
        existentes = {_chave_violacao(v) for v in antes_v}
        novas = [v for v in depois_v if _chave_violacao(v) not in existentes]
        return [v for v in novas if v["severidade"] == SEVERIDADE_BLOQUEIO], [v for v in novas if v["severidade"] != SEVERIDADE_BLOQUEIO]

    def _tr_linha(self, cursor, id_troca: int) -> dict:
        cursor.execute(
            "SELECT id_troca, operacao, id_solicitante, id_alvo, data_a, data_b, estado, motivo, prazo_resposta, prazo_decisao, "
            "base_json, alertas_json, bloqueios_json, decidido_por, decidido_em, justificativa, criado_em "
            "FROM dbo.wfm_trocas WHERE id_troca = ?",
            (int(id_troca),),
        )
        r = cursor.fetchone()
        if not r:
            raise _http(status.HTTP_404_NOT_FOUND, "Troca não encontrada.")
        chaves = ("id_troca", "operacao", "id_solicitante", "id_alvo", "data_a", "data_b", "estado", "motivo", "prazo_resposta",
                  "prazo_decisao", "base_json", "alertas_json", "bloqueios_json", "decidido_por", "decidido_em", "justificativa", "criado_em")
        return dict(zip(chaves, r))

    def _tr_exigir_visivel(self, cursor, user, troca: dict) -> None:
        equipe = self._wfm_equipe_ids(cursor, user.id_usuario, troca["operacao"]) if user.perfil == ROLE_SUPERVISOR else set()
        if not wfm_scope.pode_ver_troca(
            perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=troca["operacao"],
            id_a=troca["id_solicitante"], id_b=troca["id_alvo"], equipe_supervisor=equipe,
        ):
            raise _http(status.HTTP_403_FORBIDDEN, "Você não tem acesso a esta troca.")

    def _tr_exigir_decisor(self, cursor, user, troca: dict) -> None:
        equipe = self._wfm_equipe_ids(cursor, user.id_usuario, troca["operacao"]) if user.perfil == ROLE_SUPERVISOR else set()
        if not wfm_scope.pode_decidir_troca(
            perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=troca["operacao"],
            id_a=troca["id_solicitante"], id_b=troca["id_alvo"], equipe_supervisor=equipe,
        ):
            raise _http(status.HTTP_403_FORBIDDEN, "Você não pode decidir esta troca (fora do seu escopo ou conflito de interesse).")

    def _tr_mudar_estado(self, cursor, user, troca: dict, novo: str, detalhe: str = "", **extras) -> None:
        campos, valores = ["estado = ?", "atualizado_em = GETDATE()"], [novo]
        for coluna, valor in extras.items():
            campos.append(f"{coluna} = ?")
            valores.append(valor)
        cursor.execute(f"UPDATE dbo.wfm_trocas SET {', '.join(campos)} WHERE id_troca = ?", (*valores, int(troca["id_troca"])))
        self._tr_evento(cursor, user, troca["operacao"], troca["id_troca"], novo, detalhe)

    def _tr_base_igual(self, cursor, troca: dict) -> bool:
        """As células da troca continuam como estavam quando o pedido foi feito?"""
        base = json.loads(troca["base_json"])
        ids = sorted({b["id_operador"] for b in base})
        datas = tuple(sorted({date.fromisoformat(b["data"]) for b in base}))
        atual = self._tr_celulas(cursor, troca["operacao"], ids, datas)
        for b in base:
            c = atual.get((b["id_operador"], date.fromisoformat(b["data"])))
            if (c["id_turno"] if c else None) != b["id_turno"] or (c["versao_linha"] if c else None) != b["versao_linha"]:
                return False
        return True

    # ------------------------------------------------------------------
    # Expiração e invalidação
    # ------------------------------------------------------------------
    def _wfm_expirar_trocas(self, cursor, operacao: str) -> None:
        agora = self._wfm_agora()
        cursor.execute(
            "SELECT id_troca, estado FROM dbo.wfm_trocas WHERE operacao = ? AND "
            "((estado = 'AGUARDANDO_B' AND prazo_resposta < ?) OR (estado = 'AGUARDANDO_APROVACAO' AND prazo_decisao < ?))",
            (operacao, agora, agora),
        )
        for id_troca, estado in cursor.fetchall():
            etapa = "resposta do colega" if estado == regras.AGUARDANDO_B else "decisão"
            troca = self._tr_linha(cursor, id_troca)
            self._tr_mudar_estado(cursor, None, troca, regras.EXPIRADA, f"Prazo de {etapa} vencido. Os dois operadores foram avisados.")

    def _wfm_invalidar_trocas(self, cursor, user, operacao: str, id_operador: int, data: date, ignorar: int = 0) -> None:
        """A escala de um dos dois operadores mudou: trocas ativas sobre essa célula deixam de valer."""
        cursor.execute(
            "SELECT id_troca FROM dbo.wfm_trocas WHERE operacao = ? AND estado IN ('AGUARDANDO_B', 'AGUARDANDO_APROVACAO') "
            "AND (id_solicitante = ? OR id_alvo = ?) AND (data_a = ? OR data_b = ?) AND id_troca <> ?",
            (operacao, int(id_operador), int(id_operador), data, data, int(ignorar)),
        )
        for (id_troca,) in cursor.fetchall():
            troca = self._tr_linha(cursor, id_troca)
            self._tr_mudar_estado(
                cursor, user, troca, regras.INVALIDADA,
                "A escala de um dos operadores foi editada depois do pedido. Os dois operadores foram avisados.",
            )

    # ------------------------------------------------------------------
    # Colegas (para o formulário do Operador)
    # ------------------------------------------------------------------
    def wfm_list_colegas_troca(self, user, operacao: str) -> list[dict]:
        if user.perfil not in WFM_PERFIS_PARTICIPANTES:
            raise _http(status.HTTP_403_FORBIDDEN, "Somente o Operador solicita trocas.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            hoje = self._wfm_agora().date()
            colegas = [
                o for o in self._wfm_todos_operadores(cursor, operacao)
                if o["id_usuario"] != user.id_usuario and self._tr_contrato_tipo(cursor, operacao, o["id_usuario"], hoje) != regras.TIPO_CONTRATO_APRENDIZ
            ]
            if not colegas:
                return []
            # Dias de trabalho de cada colega daqui para frente (para o Operador escolher com quem e o que trocar)
            # e compatibilidade de skills (a troca exige skills iguais).
            seg, dom = hoje, hoje + timedelta(days=62)
            ids = [c["id_usuario"] for c in colegas]
            marc = ",".join("?" for _ in ids)
            modelos = self._wfm_turnos_modelo(cursor, operacao)
            eventos = self._tr_eventos_calendario(cursor, operacao, seg, dom)
            cursor.execute(
                f"SELECT id_operador, data, id_turno, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens "
                f"WHERE operacao = ? AND data BETWEEN ? AND ? AND id_operador IN ({marc})",
                (operacao, seg, dom, *ids),
            )
            dias: dict[int, dict] = {}
            for id_op, data, id_turno, e_aj, s_aj in cursor.fetchall():
                modelo = modelos.get(int(id_turno))
                if not modelo:
                    continue
                h = horario_efetivo(data, modelo, modelos, eventos, (e_aj, s_aj) if e_aj and s_aj else None)
                if h["trabalha"]:
                    dias.setdefault(int(id_op), {})[data.isoformat()] = {"codigo": h["codigo"], "entrada": h["entrada"], "saida": h["saida"]}
            minhas = self._tr_skills(cursor, operacao, user.id_usuario)
            cursor.execute(f"SELECT id_usuario, id_skill FROM dbo.wfm_usuario_skills WHERE operacao = ? AND id_usuario IN ({marc})", (operacao, *ids))
            skills: dict[int, set] = {}
            for id_op, id_skill in cursor.fetchall():
                skills.setdefault(int(id_op), set()).add(int(id_skill))
            return [
                {"id_usuario": c["id_usuario"], "nome": c["nome"], "dias": dias.get(c["id_usuario"], {}),
                 "compativel": regras.skills_compativeis(minhas, frozenset(skills.get(c["id_usuario"], set())))}
                for c in colegas
            ]
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Solicitar
    # ------------------------------------------------------------------
    def wfm_solicitar_troca(self, user, operacao: str, id_alvo: int, data_a: Any, data_b: Any, motivo: str = "", *, ip: str = "") -> dict:
        if user.perfil not in WFM_PERFIS_PARTICIPANTES or user.id_usuario is None:
            raise _http(status.HTTP_403_FORBIDDEN, "Somente o Operador solicita trocas.")
        data_a, data_b = _data(data_a), _data(data_b or data_a)
        id_a, id_b = int(user.id_usuario), int(id_alvo)
        if id_a == id_b:
            raise _http(status.HTTP_400_BAD_REQUEST, "Escolha um colega diferente de você.")
        datas = regras.datas_envolvidas(data_a, data_b)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_expirar_trocas(cursor, operacao)
            self._wfm_operador_da_operacao(cursor, operacao, id_b)
            agora = self._wfm_agora()
            if any(self._tr_contrato_tipo(cursor, operacao, i, d) == regras.TIPO_CONTRATO_APRENDIZ for i in (id_a, id_b) for d in datas):
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Jovem aprendiz não participa de trocas.")
            for d in datas:
                ano_mes = f"{d.year}-{d.month:02d}"
                cab = self._wfm_cabecalho(cursor, operacao, ano_mes)
                if cab["versao_publicada"] < 1:
                    raise _http(status.HTTP_409_CONFLICT, f"A escala de {ano_mes} ainda não foi publicada.")
                if cab["fechada"]:
                    raise _http(status.HTTP_409_CONFLICT, f"O período {ano_mes} está fechado.")
            celulas = self._tr_celulas(cursor, operacao, [id_a, id_b], datas)
            if not self._tr_trabalha(cursor, operacao, celulas.get((id_a, data_a))):
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Você não está escalado para trabalhar no dia que quer ceder.")
            if not self._tr_trabalha(cursor, operacao, celulas.get((id_b, data_b))):
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O colega não está escalado para trabalhar no dia que você quer assumir.")
            erros = regras.validar_janela(agora, data_a, data_b, self._tr_inicios(cursor, operacao, celulas, datas, [id_a, id_b]), _params_da_escala(cursor, operacao))
            if not regras.skills_compativeis(self._tr_skills(cursor, operacao, id_a), self._tr_skills(cursor, operacao, id_b)):
                erros.append("Os dois operadores precisam ter as mesmas skills (idioma, produto, retenção).")
            if erros:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, {"mensagem": " ".join(erros), "erros": erros})
            marc = ",".join("?" for _ in datas)
            cursor.execute(
                f"SELECT TOP 1 id_troca FROM dbo.wfm_trocas WHERE operacao = ? AND estado IN ('AGUARDANDO_B', 'AGUARDANDO_APROVACAO') "
                f"AND (id_solicitante IN (?, ?) OR id_alvo IN (?, ?)) AND (data_a IN ({marc}) OR data_b IN ({marc}))",
                (operacao, id_a, id_b, id_a, id_b, *datas, *datas),
            )
            if cursor.fetchone():
                raise _http(status.HTTP_409_CONFLICT, "Já existe uma solicitação ativa para um destes dias. Conclua ou cancele a anterior.")
            base = [
                {"id_operador": i, "data": d.isoformat(), "id_turno": (celulas[(i, d)] or {}).get("id_turno"),
                 "versao_linha": (celulas[(i, d)] or {}).get("versao_linha")}
                for i in (id_a, id_b) for d in datas
            ]
            feriados = self._tr_feriados(cursor, operacao, agora.date(), agora.date() + timedelta(days=14))
            prazo = regras.somar_horas_uteis(agora, PARAMS.prazo_resposta_horas_uteis, feriados)
            cursor.execute(
                "INSERT INTO dbo.wfm_trocas (operacao, id_solicitante, id_alvo, data_a, data_b, estado, motivo, prazo_resposta, base_json) "
                "OUTPUT INSERTED.id_troca VALUES (?, ?, ?, ?, ?, 'AGUARDANDO_B', ?, ?, ?)",
                (operacao, id_a, id_b, data_a, data_b, normalize_text(motivo)[:300] or None, prazo, json.dumps(base)),
            )
            id_troca = int(cursor.fetchone()[0])
            self._tr_evento(cursor, user, operacao, id_troca, "SOLICITADA", f"Aguardando resposta do colega até {prazo:%d/%m %H:%M}.")
            self.wfm_audit(cursor, user, operacao=operacao, acao="solicitar_troca", entidade="troca", entidade_id=id_troca,
                           depois={"alvo": id_b, "data_a": data_a.isoformat(), "data_b": data_b.isoformat()}, ip=ip)
            conn.commit()
            return {"success": True, "id_troca": id_troca, "prazo_resposta": prazo.isoformat()}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Responder (Operador B)
    # ------------------------------------------------------------------
    def wfm_responder_troca(self, user, id_troca: int, aceitar: bool, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            troca = self._tr_linha(cursor, id_troca)
            operacao = troca["operacao"]
            self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_expirar_trocas(cursor, operacao)
            troca = self._tr_linha(cursor, id_troca)
            if user.perfil not in WFM_PERFIS_PARTICIPANTES or user.id_usuario != troca["id_alvo"]:
                raise _http(status.HTTP_403_FORBIDDEN, "Somente o colega convidado responde esta troca.")
            if troca["estado"] != regras.AGUARDANDO_B:
                conn.commit()
                raise _http(status.HTTP_409_CONFLICT, f"Esta troca não aguarda mais a sua resposta (estado: {troca['estado']}).")
            if not aceitar:
                self._tr_mudar_estado(cursor, user, troca, regras.RECUSADA, "O colega recusou a troca.")
                conn.commit()
                return {"success": True, "estado": regras.RECUSADA}
            datas = regras.datas_envolvidas(troca["data_a"], troca["data_b"])
            ids = [troca["id_solicitante"], troca["id_alvo"]]
            if not self._tr_base_igual(cursor, troca):
                self._tr_mudar_estado(cursor, user, troca, regras.INVALIDADA, "A escala mudou depois do pedido. Os dois operadores foram avisados.")
                conn.commit()
                return {"success": False, "estado": regras.INVALIDADA}
            celulas = self._tr_celulas(cursor, operacao, ids, datas)
            janela = regras.validar_janela(self._wfm_agora(), troca["data_a"], troca["data_b"], self._tr_inicios(cursor, operacao, celulas, datas, ids), _params_da_escala(cursor, operacao))
            if janela:
                self._tr_mudar_estado(cursor, user, troca, regras.INVALIDADA, " ".join(janela))
                conn.commit()
                return {"success": False, "estado": regras.INVALIDADA, "motivo": " ".join(janela)}
            bloqueios, alertas = self._tr_simular(cursor, operacao, ids[0], ids[1], datas)
            if bloqueios:
                self._tr_mudar_estado(cursor, user, troca, regras.BLOQUEADA, "A simulação pelo motor de regras bloqueou a troca.",
                                      bloqueios_json=json.dumps(bloqueios, ensure_ascii=False))
                conn.commit()
                return {"success": True, "estado": regras.BLOQUEADA}
            feriados = self._tr_feriados(cursor, operacao, self._wfm_agora().date(), self._wfm_agora().date() + timedelta(days=14))
            prazo = regras.somar_horas_uteis(self._wfm_agora(), PARAMS.prazo_decisao_horas_uteis, feriados)
            self._tr_mudar_estado(cursor, user, troca, regras.AGUARDANDO_APROVACAO,
                                  f"O colega aceitou. Aguardando aprovação até {prazo:%d/%m %H:%M}."
                                  + (" Há alerta de risco trabalhista." if alertas else ""),
                                  prazo_decisao=prazo, alertas_json=json.dumps(alertas, ensure_ascii=False) if alertas else None)
            self.wfm_audit(cursor, user, operacao=operacao, acao="aceitar_troca", entidade="troca", entidade_id=id_troca,
                           depois={"alertas": len(alertas)}, ip=ip)
            conn.commit()
            return {"success": True, "estado": regras.AGUARDANDO_APROVACAO, "alertas": len(alertas)}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Cancelar (solicitante)
    # ------------------------------------------------------------------
    def wfm_cancelar_troca(self, user, id_troca: int, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            troca = self._tr_linha(cursor, id_troca)
            if user.id_usuario != troca["id_solicitante"] or user.perfil not in WFM_PERFIS_PARTICIPANTES:
                raise _http(status.HTTP_403_FORBIDDEN, "Somente quem pediu a troca pode cancelá-la.")
            if troca["estado"] not in regras.ESTADOS_ATIVOS:
                raise _http(status.HTTP_409_CONFLICT, f"Esta troca não pode mais ser cancelada (estado: {troca['estado']}).")
            self._tr_mudar_estado(cursor, user, troca, regras.CANCELADA, "O solicitante cancelou a troca.")
            self.wfm_audit(cursor, user, operacao=troca["operacao"], acao="cancelar_troca", entidade="troca", entidade_id=id_troca, ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Aplicar a troca na escala (rascunho + nova versão publicada)
    # ------------------------------------------------------------------
    def _tr_trocar_pausas(self, cursor, operacao: str, id_a: int, id_b: int, datas: tuple[date, ...]) -> int:
        """A troca é 100%: em cada data da troca, A fica com o turno E as pausas que eram de B, e B com os de A (Operador A com
        pausa às 9h troca com B às 11h: depois, B tira às 9h e A às 11h). Só vale nessas datas; os outros dias não mudam.
        Trocar de novo (desfazer) devolve cada pausa ao dono original."""
        movidas = 0
        for d in datas:
            cursor.execute(
                "SELECT id_operador, ordem, tipo, inicio, duracao_min, atualizado_por FROM dbo.wfm_pausas "
                "WHERE operacao = ? AND data = ? AND id_operador IN (?, ?)", (operacao, d, id_a, id_b),
            )
            linhas = cursor.fetchall()
            if not linhas:
                continue
            cursor.execute("DELETE FROM dbo.wfm_pausas WHERE operacao = ? AND data = ? AND id_operador IN (?, ?)", (operacao, d, id_a, id_b))
            for id_op, ordem, tipo, inicio, dur, por in linhas:
                novo_dono = id_b if int(id_op) == id_a else id_a
                cursor.execute(
                    "INSERT INTO dbo.wfm_pausas (operacao, id_operador, data, ordem, tipo, inicio, duracao_min, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (operacao, novo_dono, d, ordem, tipo, inicio, dur, por),
                )
                movidas += 1
        return movidas

    def _tr_aplicar(self, cursor, user, troca: dict, *, desfazer: bool, justificativa: str) -> int:
        operacao, id_a, id_b = troca["operacao"], troca["id_solicitante"], troca["id_alvo"]
        datas = regras.datas_envolvidas(troca["data_a"], troca["data_b"])
        modelos = self._wfm_turnos_modelo(cursor, operacao)
        autor = normalize_text(user.nome) or user.username
        meses: dict[str, list[tuple[int, date, int | None]]] = {}
        for d in datas:
            ano_mes = f"{d.year}-{d.month:02d}"
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes)
            if cab["versao_publicada"] < 1 or cab["fechada"]:
                raise _http(status.HTTP_409_CONFLICT, f"O período {ano_mes} não está aberto para troca.")
            celulas = self._tr_celulas(cursor, operacao, [id_a, id_b], (d,))
            ca, cb = celulas[(id_a, d)], celulas[(id_b, d)]
            novo_a, novo_b = (cb["id_turno"] if cb else None), (ca["id_turno"] if ca else None)
            # A troca é 100%: o horário ajustado (entrada/saída) acompanha o turno, assim como as pausas (_tr_trocar_pausas).
            aj_a, aj_b = ((cb or {}).get("ajuste") or (None, None)), ((ca or {}).get("ajuste") or (None, None))
            for id_op, atual, novo, (aj_ent, aj_sai) in ((id_a, ca, novo_a, aj_a), (id_b, cb, novo_b, aj_b)):
                if atual and novo is None:
                    cursor.execute("DELETE FROM dbo.wfm_escala_itens WHERE id_item = (SELECT id_item FROM dbo.wfm_escala_itens WHERE operacao = ? AND id_operador = ? AND data = ?)", (operacao, id_op, d))
                elif atual:
                    cursor.execute(
                        "UPDATE dbo.wfm_escala_itens SET id_turno = ?, versao_linha = versao_linha + 1, atualizado_por = ?, atualizado_em = GETDATE(), "
                        "entrada_ajuste = ?, saida_ajuste = ? WHERE operacao = ? AND id_operador = ? AND data = ?", (novo, autor, aj_ent, aj_sai, operacao, id_op, d),
                    )
                elif novo is not None:
                    cursor.execute(
                        "INSERT INTO dbo.wfm_escala_itens (operacao, ano_mes, id_operador, data, id_turno, entrada_ajuste, saida_ajuste, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (operacao, ano_mes, id_op, d, novo, aj_ent, aj_sai, autor),
                    )
                meses.setdefault(ano_mes, []).append((id_op, d, novo))
                self._wfm_invalidar_trocas(cursor, user, operacao, id_op, d, ignorar=troca["id_troca"])
        self._tr_trocar_pausas(cursor, operacao, id_a, id_b, datas)
        # Nova versão publicada = última versão publicada com a troca aplicada (edições ainda não publicadas seguem fora).
        ultima = 0
        for ano_mes, mudancas in meses.items():
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes)
            cursor.execute("SELECT snapshot_json FROM dbo.wfm_escala_versoes WHERE operacao = ? AND ano_mes = ? AND versao = ?",
                           (operacao, ano_mes, cab["versao_publicada"]))
            snap = json.loads(cursor.fetchone()[0])
            itens = {(i["id_operador"], i["data"]): i for i in snap["itens"]}
            for id_op, d, novo in mudancas:
                chave = (id_op, d.isoformat())
                if novo is None:
                    itens.pop(chave, None)
                else:
                    itens[chave] = {"id_operador": id_op, "data": d.isoformat(), "id_turno": novo, "codigo": modelos[novo].codigo if novo in modelos else None}
            cursor.execute("SELECT ISNULL(MAX(versao), 0) FROM dbo.wfm_escala_versoes WHERE operacao = ? AND ano_mes = ?", (operacao, ano_mes))
            versao = max(cab["versao_publicada"], int(cursor.fetchone()[0])) + 1
            cursor.execute(
                "INSERT INTO dbo.wfm_escala_versoes (operacao, ano_mes, versao, publicado_por, publicado_por_nome, com_violacao, justificativa, snapshot_json) "
                "VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
                (operacao, ano_mes, versao, user.id_usuario, autor,
                 normalize_text(f"{'Desfez a' if desfazer else 'Troca'} #{troca['id_troca']}: {justificativa}")[:400],
                 json.dumps({"itens": sorted(itens.values(), key=lambda i: (i["id_operador"], i["data"]))}, ensure_ascii=False)),
            )
            cursor.execute("UPDATE dbo.wfm_escalas SET versao_publicada = ?, atualizado_em = GETDATE() WHERE operacao = ? AND ano_mes = ?", (versao, operacao, ano_mes))
            # A troca tem aprovação própria: ela não invalida a aprovação da escala (atualiza o hash aprovado).
            cursor.execute("UPDATE dbo.wfm_escalas SET aprov_hash = ? WHERE operacao = ? AND ano_mes = ? AND aprov_estado IN ('APROVADA', 'EM_APROVACAO')",
                           (hash_snapshot(self._wfm_snapshot(cursor, operacao, ano_mes)), operacao, ano_mes))
            ultima = versao
        return ultima

    # ------------------------------------------------------------------
    # Decidir (Supervisor, Control Desk, Gestor/RH)
    # ------------------------------------------------------------------
    def wfm_decidir_troca(self, user, id_troca: int, aprovar: bool, justificativa: str = "", *, ip: str = "") -> dict:
        justificativa = normalize_text(justificativa)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            troca = self._tr_linha(cursor, id_troca)
            operacao = troca["operacao"]
            self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._tr_exigir_decisor(cursor, user, troca)
            self._wfm_expirar_trocas(cursor, operacao)
            troca = self._tr_linha(cursor, id_troca)
            if troca["estado"] != regras.AGUARDANDO_APROVACAO:
                conn.commit()
                raise _http(status.HTTP_409_CONFLICT, f"Esta troca não está na fila de aprovação (estado: {troca['estado']}).")
            if not aprovar:
                if not justificativa:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe a justificativa da reprovação.")
                self._tr_mudar_estado(cursor, user, troca, regras.REPROVADA, justificativa,
                                      decidido_por=normalize_text(user.nome) or user.username, decidido_em=self._wfm_agora(), justificativa=justificativa[:400])
                self.wfm_audit(cursor, user, operacao=operacao, acao="reprovar_troca", entidade="troca", entidade_id=id_troca, justificativa=justificativa, ip=ip)
                conn.commit()
                return {"success": True, "estado": regras.REPROVADA}
            if not self._tr_base_igual(cursor, troca):
                self._tr_mudar_estado(cursor, user, troca, regras.INVALIDADA, "A escala mudou depois do pedido. Os dois operadores foram avisados.")
                conn.commit()
                raise _http(status.HTTP_409_CONFLICT, "A escala dos operadores mudou depois do pedido: a troca foi invalidada.")
            datas = regras.datas_envolvidas(troca["data_a"], troca["data_b"])
            bloqueios, alertas = self._tr_simular(cursor, operacao, troca["id_solicitante"], troca["id_alvo"], datas)
            if bloqueios:
                self._tr_mudar_estado(cursor, user, troca, regras.BLOQUEADA, "Nova simulação do motor bloqueou a troca.", bloqueios_json=json.dumps(bloqueios, ensure_ascii=False))
                conn.commit()
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A simulação do motor de regras bloqueou esta troca.")
            versao = self._tr_aplicar(cursor, user, troca, desfazer=False, justificativa=justificativa or "aprovada")
            self._tr_mudar_estado(cursor, user, troca, regras.APROVADA, f"Aprovada. Escala publicada na versão {versao}. Os dois operadores foram avisados.",
                                  decidido_por=normalize_text(user.nome) or user.username, decidido_em=self._wfm_agora(), justificativa=justificativa[:400] or None,
                                  alertas_json=json.dumps(alertas, ensure_ascii=False) if alertas else troca["alertas_json"])
            self.wfm_audit(cursor, user, operacao=operacao, acao="aprovar_troca", entidade="troca", entidade_id=id_troca,
                           depois={"versao": versao, "alertas": len(alertas)}, justificativa=justificativa, ip=ip)
            conn.commit()
            return {"success": True, "estado": regras.APROVADA, "versao": versao}
        finally:
            conn.close()

    def wfm_desfazer_troca(self, user, id_troca: int, justificativa: str, *, ip: str = "") -> dict:
        justificativa = normalize_text(justificativa)
        if not justificativa:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe a justificativa para desfazer a troca.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            troca = self._tr_linha(cursor, id_troca)
            operacao = troca["operacao"]
            self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._tr_exigir_decisor(cursor, user, troca)
            if troca["estado"] != regras.APROVADA:
                raise _http(status.HTTP_409_CONFLICT, "Somente uma troca aprovada pode ser desfeita.")
            # Só desfaz se a escala ainda está como a troca a deixou (senão reverteria edições posteriores).
            datas = regras.datas_envolvidas(troca["data_a"], troca["data_b"])
            base = {(b["id_operador"], date.fromisoformat(b["data"])): b["id_turno"] for b in json.loads(troca["base_json"])}
            esperado = regras.aplicar_troca(base, troca["id_solicitante"], troca["id_alvo"], datas)
            atual = self._tr_celulas(cursor, operacao, [troca["id_solicitante"], troca["id_alvo"]], datas)
            if any((atual[k]["id_turno"] if atual[k] else None) != v for k, v in esperado.items()):
                raise _http(status.HTTP_409_CONFLICT, "A escala foi alterada depois da troca: não é possível desfazê-la automaticamente.")
            versao = self._tr_aplicar(cursor, user, troca, desfazer=True, justificativa=justificativa)
            self._tr_mudar_estado(cursor, user, troca, regras.DESFEITA, f"Desfeita: {justificativa}. Escala republicada na versão {versao}.", justificativa=justificativa[:400])
            self.wfm_audit(cursor, user, operacao=operacao, acao="desfazer_troca", entidade="troca", entidade_id=id_troca,
                           depois={"versao": versao}, justificativa=justificativa, ip=ip)
            conn.commit()
            return {"success": True, "estado": regras.DESFEITA, "versao": versao}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Listagem (escopo: Operador só as suas; Supervisor a equipe; Control Desk/Gestor a operação)
    # ------------------------------------------------------------------
    def wfm_list_trocas(self, user, operacao: str, estado: str = "") -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            self._wfm_expirar_trocas(cursor, operacao)
            conn.commit()
            sql = "SELECT id_troca FROM dbo.wfm_trocas WHERE operacao = ?"
            params: list = [operacao]
            if estado:
                sql += " AND estado = ?"
                params.append(normalize_text(estado).upper())
            cursor.execute(sql + " ORDER BY id_troca DESC", tuple(params))
            ids = [int(r[0]) for r in cursor.fetchall()][:200]
            nomes = {o["id_usuario"]: o["nome"] for o in self._wfm_todos_operadores(cursor, operacao)}
            modelos = self._wfm_turnos_modelo(cursor, operacao)
            equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
            sups = {s["id_usuario"]: s for s in self._wfm_supervisores_da_operacao(cursor, operacao)}
            cursor.execute("SELECT id_turno, id_supervisor FROM dbo.wfm_turnos WHERE operacao = ? AND id_supervisor IS NOT NULL", (operacao,))
            resp_turno = {int(r[0]): {"supervisor": sups[int(r[1])]["nome"], "equipe": sups[int(r[1])]["equipe"]} for r in cursor.fetchall() if int(r[1]) in sups}
            saida = []
            for id_troca in ids:
                t = self._tr_linha(cursor, id_troca)
                if not wfm_scope.pode_ver_troca(
                    perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao,
                    id_a=t["id_solicitante"], id_b=t["id_alvo"], equipe_supervisor=equipe,
                ):
                    continue
                datas = regras.datas_envolvidas(t["data_a"], t["data_b"])
                base = {(b["id_operador"], b["data"]): b["id_turno"] for b in json.loads(t["base_json"])}
                cod = lambda idt: modelos[idt].codigo if idt in modelos else "—"  # noqa: E731
                resp = lambda idt: resp_turno.get(idt) or {}  # noqa: E731
                detalhe = [
                    {"data": d.isoformat(), "solicitante_antes": cod(base.get((t["id_solicitante"], d.isoformat()))),
                     "alvo_antes": cod(base.get((t["id_alvo"], d.isoformat()))),
                     "solicitante_supervisor": resp(base.get((t["id_solicitante"], d.isoformat()))).get("supervisor"),
                     "solicitante_equipe": resp(base.get((t["id_solicitante"], d.isoformat()))).get("equipe"),
                     "alvo_supervisor": resp(base.get((t["id_alvo"], d.isoformat()))).get("supervisor"),
                     "alvo_equipe": resp(base.get((t["id_alvo"], d.isoformat()))).get("equipe")}
                    for d in datas
                ]
                sou_decisor = wfm_scope.pode_decidir_troca(
                    perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao,
                    id_a=t["id_solicitante"], id_b=t["id_alvo"], equipe_supervisor=equipe,
                )
                cursor.execute("SELECT evento, por_nome, detalhe, criado_em FROM dbo.wfm_trocas_eventos WHERE id_troca = ? ORDER BY id_evento", (id_troca,))
                linha = [{"evento": r[0], "por": normalize_text(r[1]), "detalhe": normalize_text(r[2]), "em": r[3].isoformat()} for r in cursor.fetchall()]
                saida.append(
                    {
                        "id_troca": id_troca, "estado": t["estado"], "id_solicitante": t["id_solicitante"], "id_alvo": t["id_alvo"],
                        "solicitante": nomes.get(t["id_solicitante"], ""), "alvo": nomes.get(t["id_alvo"], ""),
                        "data_a": t["data_a"].isoformat(), "data_b": t["data_b"].isoformat(), "motivo": t["motivo"], "detalhe": detalhe,
                        "prazo_resposta": t["prazo_resposta"].isoformat() if t["prazo_resposta"] else None,
                        "prazo_decisao": t["prazo_decisao"].isoformat() if t["prazo_decisao"] else None,
                        "alertas": json.loads(t["alertas_json"]) if t["alertas_json"] else [],
                        "bloqueios": json.loads(t["bloqueios_json"]) if t["bloqueios_json"] else [],
                        "decidido_por": t["decidido_por"], "justificativa": t["justificativa"],
                        "criado_em": t["criado_em"].isoformat() if t["criado_em"] else None,
                        "pode_responder": t["estado"] == regras.AGUARDANDO_B and user.id_usuario == t["id_alvo"] and user.perfil in WFM_PERFIS_PARTICIPANTES,
                        "pode_cancelar": t["estado"] in regras.ESTADOS_ATIVOS and user.id_usuario == t["id_solicitante"] and user.perfil in WFM_PERFIS_PARTICIPANTES,
                        "pode_decidir": t["estado"] == regras.AGUARDANDO_APROVACAO and sou_decisor and user.has_permission("wfm.troca.aprovar"),
                        "pode_desfazer": t["estado"] == regras.APROVADA and sou_decisor and user.has_permission("wfm.troca.desfazer"),
                        "linha_do_tempo": linha,
                    }
                )
            return saida
        finally:
            conn.close()

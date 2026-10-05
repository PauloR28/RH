"""WFM — escala mensal, validação (motor de regras), publicação versionada,
fechamento de período, presença e atestados. Mixin do DatabaseRepository.

Regras de negócio deste módulo:
  * Escala é VERSIONADA: publicar grava uma linha imutável em `wfm_escala_versoes`
    (snapshot completo) e nunca sobrescreve a anterior.
  * Edição concorrente: cada linha tem `versao_linha`; quem edita com versão
    desatualizada recebe 409 com quem alterou por último (aviso de conflito).
  * Toda validação roda AQUI (servidor) via `services/wfm_regras.py`.
  * Publicar com violação (bloqueio não-duro) só o Gestor/RH, com justificativa
    obrigatória em auditoria. Bloqueio duro por lei (ex.: estagiário) nunca publica.
  * Após o fechamento do período, só o Gestor/RH corrige, com justificativa.
  * Conflito de interesse: ninguém edita/publica escala em que é a própria parte.
  * Atestado guarda só período, tipo e validador (dado de saúde; sem arquivo/CID).
"""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_ANALISTA_TI, ROLE_SUPERVISOR, WFM_PERFIS_PARTICIPANTES
from ..services import wfm_scope
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_export import gerar_csv, gerar_xlsx
from ..services.wfm_montagem import (
    EventoCalendario,
    TurnoModelo,
    VigenciaContrato,
    dias_do_mes,
    horario_efetivo,
    montar_dias,
)
from ..services.wfm_regras import (
    ExigenciaPausa,
    ParametrosContrato,
    tem_bloqueio,
    tem_bloqueio_duro,
    validar_escala,
)

STATUS_PRESENCA = ("PRESENTE", "FALTA", "FALTA_JUSTIFICADA", "ATESTADO")
TIPOS_ATESTADO = ("MEDICO", "ACOMPANHAMENTO", "DOACAO_SANGUE", "OUTRO")
_RE_ANO_MES = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
CONTEXTO_DIAS = 7  # dias de contexto antes/depois do mês para interjornada e sequência


def _exigir_ano_mes(ano_mes: str) -> str:
    ano_mes = normalize_text(ano_mes)
    if not _RE_ANO_MES.match(ano_mes):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Período inválido (use AAAA-MM).")
    return ano_mes


def _parse_data(valor: Any) -> date:
    try:
        return date.fromisoformat(str(valor))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data inválida (AAAA-MM-DD).")


def _contrato_de_linha(row: dict) -> ParametrosContrato:
    try:
        exig = json.loads(row.get("exigencias_pausa_json") or "[]")
    except ValueError:
        exig = []
    return ParametrosContrato(
        codigo=normalize_text(row["codigo"]),
        jornada_diaria_max_min=int(row["jornada_diaria_max_min"]),
        interjornada_min_min=int(row["interjornada_min_min"]),
        max_dias_consecutivos=int(row["max_dias_consecutivos"]),
        exigencias_pausa=tuple(
            ExigenciaPausa(int(e["a_partir_de_min"]), e["tipo"], int(e["quantidade"]), int(e["duracao_min"])) for e in exig
        ),
        jornada_feriado_max_min=int(row["jornada_feriado_max_min"]) if row.get("jornada_feriado_max_min") is not None else None,
        jornada_bloqueio_duro=bool(row.get("jornada_bloqueio_duro")),
        jornada_semanal_max_min=int(row["jornada_semanal_max_min"]) if row.get("jornada_semanal_max_min") is not None else None,
    )


def _hhmm_ok(valor: str) -> bool:
    return bool(re.match(r"^([01]\d|2[0-3]):[0-5]\d$", valor or ""))


def _validar_ajuste(entrada: Any, saida: Any) -> tuple[str, str] | None:
    """Horário combinado do dia: ambos vazios = remove; senão HH:MM válidos e diferentes (pode virar a meia-noite)."""
    entrada, saida = normalize_text(entrada), normalize_text(saida)
    if not entrada and not saida:
        return None
    if not (_hhmm_ok(entrada) and _hhmm_ok(saida)) or entrada == saida:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe entrada e saída válidas (HH:MM) e diferentes.")
    return entrada, saida


class WfmEscalaRepositoryMixin:
    # ------------------------------------------------------------------
    # Leitura auxiliar
    # ------------------------------------------------------------------
    def _wfm_operadores_visiveis(self, cursor, user, operacao: str) -> list[dict]:
        """Participantes da escala que o usuário PODE VER (Operador/Técnico: só ele; Supervisor: só a equipe)."""
        filtro, parametros = self._wfm_participantes_sql(operacao)
        cursor.execute(
            f"""
            SELECT u.id_usuario, u.nome, u.sobrenome, u.id_equipe, e.nome, u.cargo FROM dbo.usuarios u
            JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario AND uo.operacao = ?
            LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
            WHERE {filtro} AND ISNULL(u.status, 'Ativo') = 'Ativo'
            ORDER BY u.nome, u.sobrenome
            """,
            parametros,
        )
        todos = [
            {"id_usuario": int(r[0]), "nome": f"{normalize_text(r[1])} {normalize_text(r[2])}".strip(),
             "id_equipe": int(r[3]) if r[3] else None, "equipe": normalize_text(r[4]), "cargo": normalize_text(r[5])}
            for r in cursor.fetchall()
        ]
        cursor.execute(
            "SELECT s.id_operador, s.id_supervisor, u.nome FROM dbo.usuarios_supervisores s JOIN dbo.usuarios u ON u.id_usuario = s.id_supervisor"
        )
        supervisores: dict[int, list[dict]] = {}
        for id_op, id_sup, nome_sup in cursor.fetchall():
            supervisores.setdefault(int(id_op), []).append({"id_usuario": int(id_sup), "nome": normalize_text(nome_sup)})
        for op in todos:
            op["supervisores"] = supervisores.get(op["id_usuario"], [])
        equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
        return [
            op
            for op in todos
            if wfm_scope.pode_ver_escala_de(
                perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
                operacao=operacao, id_operador=op["id_usuario"], equipe_supervisor=equipe,
            )
        ]

    def _wfm_todos_operadores(self, cursor, operacao: str) -> list[dict]:
        filtro, parametros = self._wfm_participantes_sql(operacao)
        cursor.execute(
            f"""
            SELECT u.id_usuario, u.nome, u.sobrenome FROM dbo.usuarios u
            JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario AND uo.operacao = ?
            WHERE {filtro} AND ISNULL(u.status, 'Ativo') = 'Ativo'
            """,
            parametros,
        )
        return [{"id_usuario": int(r[0]), "nome": f"{normalize_text(r[1])} {normalize_text(r[2])}".strip()} for r in cursor.fetchall()]

    def _wfm_cabecalho(self, cursor, operacao: str, ano_mes: str, *, criar: bool = False) -> dict:
        vazio_aprov = {"estado": "RASCUNHO", "enviado_por": None, "enviado_por_nome": None, "enviado_em": None,
                       "decidido_por": None, "decidido_em": None, "motivo": None, "hash": None}
        cursor.execute(
            "SELECT versao_publicada, fechada, fechada_por, fechada_em, aprov_estado, aprov_enviado_por, aprov_enviado_nome, aprov_enviado_em, "
            "aprov_decidido_por, aprov_decidido_em, aprov_motivo, aprov_hash FROM dbo.wfm_escalas WHERE operacao = ? AND ano_mes = ?",
            (operacao, ano_mes),
        )
        row = cursor.fetchone()
        if not row and criar:
            cursor.execute("INSERT INTO dbo.wfm_escalas (operacao, ano_mes) VALUES (?, ?)", (operacao, ano_mes))
            return {"versao_publicada": 0, "fechada": False, "fechada_por": None, "fechada_em": None, "aprovacao": vazio_aprov}
        if not row:
            return {"versao_publicada": 0, "fechada": False, "fechada_por": None, "fechada_em": None, "aprovacao": vazio_aprov}
        return {
            "versao_publicada": int(row[0]),
            "fechada": bool(row[1]),
            "fechada_por": normalize_text(row[2]) or None,
            "fechada_em": row[3].isoformat() if row[3] else None,
            "aprovacao": {
                "estado": normalize_text(row[4]) or "RASCUNHO",
                "enviado_por": int(row[5]) if row[5] else None,
                "enviado_por_nome": normalize_text(row[6]) or None,
                "enviado_em": row[7].isoformat() if row[7] else None,
                "decidido_por": normalize_text(row[8]) or None,
                "decidido_em": row[9].isoformat() if row[9] else None,
                "motivo": normalize_text(row[10]) or None,
                "hash": normalize_text(row[11]) or None,
            },
        }

    def _wfm_turnos_modelo(self, cursor, operacao: str) -> dict[int, TurnoModelo]:
        cursor.execute("SELECT id_turno, codigo, tipo, entrada, saida, pausas_json FROM dbo.wfm_turnos WHERE operacao = ?", (operacao,))
        out: dict[int, TurnoModelo] = {}
        for r in cursor.fetchall():
            try:
                pausas = tuple(
                    (int(p["offset_min"]), int(p["duracao_min"]), p["tipo"]) for p in json.loads(r[5] or "[]")
                )
            except (ValueError, KeyError, TypeError):
                pausas = ()
            out[int(r[0])] = TurnoModelo(int(r[0]), normalize_text(r[1]), normalize_text(r[2]), r[3], r[4], pausas)
        return out

    # ------------------------------------------------------------------
    # Escala (leitura)
    # ------------------------------------------------------------------
    def wfm_get_escala(self, user, operacao: str, ano_mes: str, *, propria: bool = False) -> dict:
        ano_mes = _exigir_ano_mes(ano_mes)
        dias = dias_do_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escala=True)
            conn.commit()
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes)
            operadores = self._wfm_operadores_visiveis(cursor, user, operacao)
            ids = [op["id_usuario"] for op in operadores]
            somente_propria = user.perfil in WFM_PERFIS_PARTICIPANTES or (propria and user.has_permission("wfm.escala.propria"))
            itens: list[dict] = []
            fonte = "rascunho"
            if somente_propria:
                # Operador lê SEMPRE a última versão PUBLICADA (nunca o rascunho) e só a própria linha.
                fonte = "publicada"
                if cab["versao_publicada"] > 0 and (ids or propria):
                    cursor.execute(
                        "SELECT snapshot_json FROM dbo.wfm_escala_versoes WHERE operacao = ? AND ano_mes = ? AND versao = ?",
                        (operacao, ano_mes, cab["versao_publicada"]),
                    )
                    row = cursor.fetchone()
                    snap = json.loads(row[0]) if row else {"itens": []}
                    itens = [
                        {"id_operador": i["id_operador"], "data": i["data"], "id_turno": i["id_turno"], "versao_linha": None,
                         "entrada_ajuste": i.get("entrada_ajuste"), "saida_ajuste": i.get("saida_ajuste")}
                        for i in snap.get("itens", [])
                        if i["id_operador"] == user.id_usuario
                    ]
                    # Horário efetivo (feriado/dia/horário especial aplicados) e minutos líquidos por dia.
                    modelos = self._wfm_turnos_modelo(cursor, operacao)
                    cursor.execute(
                        "SELECT tipo, data_ini, data_fim, id_turno, entrada, saida FROM dbo.wfm_calendario_especial "
                        "WHERE operacao = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?",
                        (operacao, dias[-1], dias[0]),
                    )
                    evs = [EventoCalendario(normalize_text(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in cursor.fetchall()]
                    for i in itens:
                        if i["id_turno"] in modelos:
                            ajuste = (i["entrada_ajuste"], i["saida_ajuste"]) if i.get("entrada_ajuste") and i.get("saida_ajuste") else None
                            i.update(horario_efetivo(date.fromisoformat(i["data"]), modelos[i["id_turno"]], modelos, evs, ajuste))
                    cursor.execute(
                        "SELECT data, ordem, tipo, inicio, duracao_min FROM dbo.wfm_pausas WHERE operacao = ? AND id_operador = ? AND data BETWEEN ? AND ? ORDER BY data, ordem",
                        (operacao, user.id_usuario, dias[0], dias[-1]),
                    )
                    pausas_por_dia: dict[str, list[dict]] = {}
                    for r in cursor.fetchall():
                        pausas_por_dia.setdefault(r[0].isoformat(), []).append({"tipo": normalize_text(r[2]), "inicio": normalize_text(r[3]), "duracao_min": int(r[4])})
                    for i in itens:
                        i["pausas"] = pausas_por_dia.get(i["data"], [])
            elif ids:
                marcadores = ",".join("?" for _ in ids)
                cursor.execute(
                    f"SELECT id_operador, data, id_turno, versao_linha, atualizado_por, atualizado_em, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens "
                    f"WHERE operacao = ? AND ano_mes = ? AND id_operador IN ({marcadores})",
                    (operacao, ano_mes, *ids),
                )
                for r in cursor.fetchall():
                    itens.append(
                        {
                            "id_operador": int(r[0]), "data": r[1].isoformat(), "id_turno": int(r[2]),
                            "versao_linha": int(r[3]), "atualizado_por": normalize_text(r[4]) or None,
                            "atualizado_em": r[5].isoformat() if r[5] else None,
                            "entrada_ajuste": normalize_text(r[6]) or None, "saida_ajuste": normalize_text(r[7]) or None,
                        }
                    )
            turnos = self.wfm_list_turnos(user, operacao, incluir_excluidos=True)  # excluídos só entram se aparecem no histórico
            eventos = self.wfm_list_calendario(user, operacao, ano_mes)
            contratos_op = self._wfm_contratos_vigentes(cursor, operacao, ids, dias[0], dias[-1]) if ids else {}
            skills_op: dict[int, list[int]] = {}
            if ids:
                cursor.execute(
                    f"SELECT id_usuario, id_skill FROM dbo.wfm_usuario_skills WHERE operacao = ? AND id_usuario IN ({','.join('?' for _ in ids)})",
                    (operacao, *ids),
                )
                for r in cursor.fetchall():
                    skills_op.setdefault(int(r[0]), []).append(int(r[1]))
            for op in operadores:
                op["contratos"] = contratos_op.get(op["id_usuario"], [])
                op["skills"] = sorted(skills_op.get(op["id_usuario"], []))
            pode_editar = (
                not somente_propria
                and user.has_permission("wfm.escala.editar")
                and user.perfil != ROLE_ADMIN
                and (not cab["fechada"] or user.has_permission("wfm.escala.corrigir_fechada"))
            )
            aprovacao = None
            if not somente_propria:
                aprovacao = self._wfm_aprovacao_resumo(user, operacao, cab, self._wfm_snapshot(cursor, operacao, ano_mes), self._wfm_aprovadores(cursor, operacao))
                if aprovacao["estado"] == "EM_APROVACAO":
                    pode_editar = False  # em análise: ninguém edita até aprovar, declinar ou cancelar o envio
            status_cab = {k: v for k, v in cab.items() if k != "aprovacao"}
            cursor.execute("SELECT troca_antecedencia_dias FROM dbo.wfm_operacao_config WHERE operacao = ?", (operacao,))
            cfg_troca = cursor.fetchone()
            return {
                "troca_antecedencia_dias": int(cfg_troca[0]) if cfg_troca and cfg_troca[0] is not None else 3,
                "operacao": operacao,
                "ano_mes": ano_mes,
                "dias": [d.isoformat() for d in dias],
                "fonte": fonte,
                "status": status_cab,
                "aprovacao": aprovacao,
                "nome_escala": self._wfm_nome_escala(cursor, operacao),
                "operadores": operadores,
                "itens": itens,
                "personalizacoes": [
                    {"id_turno": t, "id_operador": o, "entrada": h[0], "saida": h[1]}
                    for (t, o), h in sorted(self._wfm_personalizacoes_mapa(cursor, operacao).items()) if o in set(ids)
                ],
                "turnos": [t for t in turnos if t["ativo"] or t["id_turno"] in {i["id_turno"] for i in itens}],  # inativo/excluído só se aparece no histórico
                "eventos": eventos,
                "pode_editar": pode_editar,
            }
        finally:
            conn.close()

    def _wfm_contratos_vigentes(self, cursor, operacao: str, ids: list[int], ini: date, fim: date) -> dict[int, list[dict]]:
        marcadores = ",".join("?" for _ in ids)
        cursor.execute(
            f"""
            SELECT oc.id_operador, oc.vigencia_ini, oc.vigencia_fim, c.codigo
            FROM dbo.wfm_operador_contratos oc JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato
            WHERE oc.operacao = ? AND oc.id_operador IN ({marcadores})
              AND oc.vigencia_ini <= ? AND (oc.vigencia_fim IS NULL OR oc.vigencia_fim >= ?)
            ORDER BY oc.vigencia_ini
            """,
            (operacao, *ids, fim, ini),
        )
        out: dict[int, list[dict]] = {}
        for r in cursor.fetchall():
            out.setdefault(int(r[0]), []).append(
                {"codigo": normalize_text(r[3]), "ini": r[1].isoformat(), "fim": r[2].isoformat() if r[2] else None}
            )
        padrao = self._wfm_contrato_padrao_escala(cursor, operacao)
        if padrao:  # jornada atrelada à escala vale para quem não tem contrato próprio
            for id_operador in ids:
                if not out.get(int(id_operador)):
                    out[int(id_operador)] = [{"codigo": normalize_text(padrao["codigo"]), "ini": ini.isoformat(), "fim": None}]
        return out

    def _wfm_contrato_padrao_escala(self, cursor, operacao: str) -> dict | None:
        """Jornada (contrato) atrelada à escala nas configurações; `None` quando não há."""
        cursor.execute(
            """
            SELECT c.codigo, c.jornada_diaria_max_min, c.interjornada_min_min, c.max_dias_consecutivos,
                   c.jornada_feriado_max_min, c.jornada_bloqueio_duro, c.exigencias_pausa_json, c.jornada_semanal_max_min
            FROM dbo.wfm_operacao_config oc JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato
            WHERE oc.operacao = ? AND c.ativo = 1
            """,
            (operacao,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return rows[0] if rows else None

    # ------------------------------------------------------------------
    # Escala (edição com trava otimista)
    # ------------------------------------------------------------------
    def wfm_salvar_itens(
        self, user, operacao: str, ano_mes: str, itens: list[dict], *, justificativa: str = "", ip: str = ""
    ) -> dict:
        ano_mes = _exigir_ano_mes(ano_mes)
        dias_validos = set(dias_do_mes(ano_mes))
        justificativa = normalize_text(justificativa)
        if not itens:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhuma alteração informada.")
        if len(itens) > 1500:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alterações demais em uma única operação.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True, escala=True)
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes, criar=True)
            if cab["fechada"]:
                if not user.has_permission("wfm.escala.corrigir_fechada"):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Período fechado: somente o Gestor/RH corrige.")
                if not justificativa:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Informe a justificativa da correção após o fechamento.")
            if not cab["fechada"] and cab["aprovacao"]["estado"] == "EM_APROVACAO":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A escala está em aprovação: cancele o envio ou aguarde a decisão para editar.",
                )
            turnos = self._wfm_turnos_modelo(cursor, operacao)
            cursor.execute("SELECT id_turno FROM dbo.wfm_turnos WHERE operacao = ? AND ativo = 1", (operacao,))
            turnos_ativos = {int(r[0]) for r in cursor.fetchall()}
            personalizados = self._wfm_personalizacoes_mapa(cursor, operacao)
            todos_operadores = self._wfm_todos_operadores(cursor, operacao)
            operadores = {op["id_usuario"] for op in todos_operadores}
            nomes_operadores = {op["id_usuario"]: op["nome"] for op in todos_operadores}
            equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
            conflitos: list[dict] = []
            mudancas: list[tuple[str, dict, dict | None, dict | None]] = []
            for item in itens:
                id_operador = int(item["id_operador"])
                data = _parse_data(item["data"])
                if id_operador not in operadores:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operador não encontrado nesta operação.")
                if not wfm_scope.pode_editar_escala_de(
                    perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
                    operacao=operacao, id_operador=id_operador, equipe_supervisor=equipe,
                ):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Você não pode editar a escala deste operador (fora da sua equipe/escopo ou conflito de interesse).",
                    )
                if data not in dias_validos:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data fora do mês da escala.")
                id_turno = item.get("id_turno")
                if id_turno is not None:
                    id_turno = int(id_turno)
                    if id_turno not in turnos_ativos:
                        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Turno inválido ou inativo para esta operação.")
                cursor.execute(
                    "SELECT id_item, id_turno, versao_linha, atualizado_por, atualizado_em, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens "
                    "WHERE operacao = ? AND id_operador = ? AND data = ?",
                    (operacao, id_operador, data),
                )
                atual = cursor.fetchone()
                esperado = item.get("versao_linha")
                if atual and (esperado is None or int(esperado) != int(atual[2])):
                    conflitos.append(
                        {
                            "id_operador": id_operador, "data": data.isoformat(), "versao_atual": int(atual[2]),
                            "alterado_por": normalize_text(atual[3]) or None,
                            "alterado_em": atual[4].isoformat() if atual[4] else None,
                        }
                    )
                    continue
                if not atual and esperado is not None:
                    conflitos.append({"id_operador": id_operador, "data": data.isoformat(), "versao_atual": None, "alterado_por": None, "alterado_em": None})
                    continue
                ajuste_atual = (normalize_text(atual[5]), normalize_text(atual[6])) if atual and atual[5] and atual[6] else None
                if item.get("ajustar_horario"):
                    ajuste = _validar_ajuste(item.get("entrada"), item.get("saida"))
                    if ajuste and (id_turno is None or turnos[id_turno].tipo != "TRABALHO"):
                        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Só dia de trabalho aceita horário ajustado.")
                else:
                    # Trocou o turno do dia: o horário combinado deixa de valer. Mesmo turno: mantém.
                    ajuste = ajuste_atual if atual and id_turno == int(atual[1]) else None
                # Turno personalizado do colaborador: sem horário combinado para o dia, vale o horário próprio dele neste turno.
                if ajuste is None and id_turno is not None and turnos[id_turno].tipo == "TRABALHO":
                    ajuste = personalizados.get((id_turno, id_operador))
                antes = {"id_turno": int(atual[1]), "codigo": turnos[int(atual[1])].codigo, "horario": ajuste_atual} if atual and int(atual[1]) in turnos else None
                depois = {"id_turno": id_turno, "codigo": turnos[id_turno].codigo, "horario": ajuste} if id_turno else None
                if (antes or {}).get("id_turno") == (depois or {}).get("id_turno") and ajuste == ajuste_atual:
                    continue  # sem mudança real
                if id_turno is not None and turnos[id_turno].tipo == "TRABALHO":
                    ent_efetiva, sai_efetiva = ajuste or (turnos[id_turno].entrada, turnos[id_turno].saida)
                    if ent_efetiva and sai_efetiva:
                        choque = self._wfm_conflito_outras_escalas(cursor, operacao, id_operador, nomes_operadores.get(id_operador, "O colaborador"), data, ent_efetiva, sai_efetiva)
                        if choque:
                            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=choque)
                mudancas.append(("upsert" if id_turno else "remover", {"id_operador": id_operador, "data": data, "atual": atual, "id_turno": id_turno, "ajuste": ajuste}, antes, depois))
            if conflitos:
                conn.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"mensagem": "A escala foi alterada por outra pessoa. Recarregue antes de salvar.", "conflitos": conflitos},
                )
            autor = normalize_text(user.nome) or user.username
            for tipo, alvo, antes, depois in mudancas:
                if tipo == "remover":
                    cursor.execute("DELETE FROM dbo.wfm_escala_itens WHERE id_item = ?", (int(alvo["atual"][0]),))
                elif alvo["atual"]:
                    cursor.execute(
                        "UPDATE dbo.wfm_escala_itens SET id_turno = ?, versao_linha = versao_linha + 1, atualizado_por = ?, "
                        "atualizado_em = GETDATE(), ano_mes = ?, entrada_ajuste = ?, saida_ajuste = ? WHERE id_item = ?",
                        (alvo["id_turno"], autor, ano_mes, (alvo["ajuste"] or (None, None))[0], (alvo["ajuste"] or (None, None))[1], int(alvo["atual"][0])),
                    )
                else:
                    cursor.execute(
                        "INSERT INTO dbo.wfm_escala_itens (operacao, ano_mes, id_operador, data, id_turno, atualizado_por, entrada_ajuste, saida_ajuste) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (operacao, ano_mes, alvo["id_operador"], alvo["data"], alvo["id_turno"], autor, (alvo["ajuste"] or (None, None))[0], (alvo["ajuste"] or (None, None))[1]),
                    )
                self._wfm_invalidar_trocas(cursor, user, operacao, alvo["id_operador"], alvo["data"])
                self.wfm_audit(
                    cursor, user, operacao=operacao, acao="editar_escala" if not cab["fechada"] else "corrigir_escala_fechada",
                    entidade="escala_item", entidade_id=f"{alvo['id_operador']}:{alvo['data'].isoformat()}",
                    antes=antes, depois=depois, justificativa=justificativa, ip=ip,
                )
            cursor.execute("UPDATE dbo.wfm_escalas SET atualizado_em = GETDATE() WHERE operacao = ? AND ano_mes = ?", (operacao, ano_mes))
            conn.commit()
            return {"success": True, "alteradas": len(mudancas)}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Validação pelo motor de regras
    # ------------------------------------------------------------------
    def _wfm_violacoes(
        self,
        cursor,
        operacao: str,
        ano_mes: str,
        operadores: list[dict],
        *,
        sobrescritas: dict | None = None,
        periodo: tuple[date, date] | None = None,
        contexto: str = "publicacao",
    ) -> list[dict]:
        """Roda o motor sobre a escala-rascunho. `sobrescritas` ((id_operador, data) -> id_turno|None)
        simula uma escala hipotética (ex.: depois de uma troca); `periodo` restringe o intervalo avaliado."""
        if periodo:
            ini, fim = periodo
        else:
            dias = dias_do_mes(ano_mes)
            ini, fim = dias[0], dias[-1]
        janela_ini, janela_fim = ini - timedelta(days=CONTEXTO_DIAS), fim + timedelta(days=CONTEXTO_DIAS)
        turnos = self._wfm_turnos_modelo(cursor, operacao)
        cursor.execute(
            "SELECT tipo, data_ini, data_fim, id_turno, entrada, saida FROM dbo.wfm_calendario_especial "
            "WHERE operacao = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?",
            (operacao, janela_fim, janela_ini),
        )
        eventos = [EventoCalendario(normalize_text(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in cursor.fetchall()]
        ids = [op["id_usuario"] for op in operadores]
        if not ids:
            return []
        marcadores = ",".join("?" for _ in ids)
        cursor.execute(
            f"SELECT id_operador, data, id_turno, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens WHERE operacao = ? AND data BETWEEN ? AND ? AND id_operador IN ({marcadores})",
            (operacao, janela_ini, janela_fim, *ids),
        )
        por_operador: dict[int, dict[date, int]] = {}
        ajustes_por_operador: dict[int, dict[date, tuple[str, str]]] = {}
        for r in cursor.fetchall():
            por_operador.setdefault(int(r[0]), {})[r[1]] = int(r[2])
            if r[3] and r[4]:
                ajustes_por_operador.setdefault(int(r[0]), {})[r[1]] = (normalize_text(r[3]), normalize_text(r[4]))
        for (id_op, dia), id_turno in (sobrescritas or {}).items():
            ajustes_por_operador.get(int(id_op), {}).pop(dia, None)  # outro turno no dia: o horário combinado não vale
            if id_turno is None:
                por_operador.get(int(id_op), {}).pop(dia, None)
            else:
                por_operador.setdefault(int(id_op), {})[dia] = int(id_turno)
        cursor.execute(
            f"""
            SELECT oc.id_operador, oc.vigencia_ini, oc.vigencia_fim, c.codigo, c.jornada_diaria_max_min, c.interjornada_min_min,
                   c.max_dias_consecutivos, c.jornada_feriado_max_min, c.jornada_bloqueio_duro, c.exigencias_pausa_json, c.jornada_semanal_max_min
            FROM dbo.wfm_operador_contratos oc JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato
            WHERE oc.operacao = ? AND oc.id_operador IN ({marcadores})
            """,
            (operacao, *ids),
        )
        vigencias: dict[int, list[VigenciaContrato]] = {}
        for row in rows_to_dicts(cursor, cursor.fetchall()):
            vigencias.setdefault(int(row["id_operador"]), []).append(
                VigenciaContrato(_contrato_de_linha(row), row["vigencia_ini"], row["vigencia_fim"])
            )
        padrao = self._wfm_contrato_padrao_escala(cursor, operacao)
        if padrao:
            for id_operador in ids:
                if not vigencias.get(int(id_operador)):
                    vigencias[int(id_operador)] = [VigenciaContrato(_contrato_de_linha(padrao), date.min, None)]
        nomes = {op["id_usuario"]: op["nome"] for op in operadores}
        saida: list[dict] = []
        for id_operador in ids:
            itens = por_operador.get(id_operador, {})
            if not any(ini <= d <= fim for d in itens):
                continue  # operador sem escala no mês
            if wfm_scope.eh_tipo_escala(operacao) and not vigencias.get(id_operador):
                continue  # escalas do TI (plantão/sobreaviso) só passam pelo motor de jornada se houver contrato vinculado
            dias_motor, violacoes = montar_dias(itens, turnos, eventos, vigencias.get(id_operador, []), ajustes_por_operador.get(id_operador))
            violacoes = violacoes + validar_escala(dias_motor, periodo=(ini, fim), contexto=contexto)
            for v in violacoes:
                if not (ini <= v.data <= fim):
                    continue
                saida.append(
                    {
                        "id_operador": id_operador,
                        "operador": nomes.get(id_operador, ""),
                        "codigo": v.codigo,
                        "severidade": v.severidade,
                        "data": v.data.isoformat(),
                        "mensagem": v.mensagem,
                        "permite_override": v.permite_override,
                        "detalhe": v.detalhe,
                    }
                )
        return sorted(saida, key=lambda x: (x["data"], x["operador"], x["codigo"]))

    @staticmethod
    def _wfm_resumo_violacoes(violacoes: list[dict]) -> dict:
        return {
            "violacoes": violacoes,
            "bloqueio": any(v["severidade"] == "bloqueio" for v in violacoes),
            "bloqueio_duro": any(v["severidade"] == "bloqueio" and not v["permite_override"] for v in violacoes),
        }

    def wfm_validar(self, user, operacao: str, ano_mes: str) -> dict:
        """Validação da escala-rascunho para a tela; devolve só violações dos operadores que o usuário pode ver."""
        ano_mes = _exigir_ano_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            visiveis = self._wfm_operadores_visiveis(cursor, user, operacao)
            return self._wfm_resumo_violacoes(self._wfm_violacoes(cursor, operacao, ano_mes, visiveis))
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Publicação (versionada) e fechamento
    # ------------------------------------------------------------------
    def _wfm_snapshot(self, cursor, operacao: str, ano_mes: str) -> dict:
        turnos = self._wfm_turnos_modelo(cursor, operacao)
        cursor.execute(
            "SELECT id_operador, data, id_turno, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens WHERE operacao = ? AND ano_mes = ? ORDER BY id_operador, data",
            (operacao, ano_mes),
        )
        itens = [
            {"id_operador": int(r[0]), "data": r[1].isoformat(), "id_turno": int(r[2]), "codigo": turnos[int(r[2])].codigo if int(r[2]) in turnos else None,
             "entrada_ajuste": normalize_text(r[3]) or None, "saida_ajuste": normalize_text(r[4]) or None}
            for r in cursor.fetchall()
        ]
        return {"itens": itens}

    def _wfm_conflito_outras_escalas(self, cursor, operacao: str, id_operador: int, nome: str, data: date, entrada: str, saida: str) -> str | None:
        """Mesma pessoa em mais de uma escala (ex.: plantão de sábado + sobreaviso) é permitido desde que os horários
        não se sobreponham. Devolve a mensagem do primeiro choque encontrado com as OUTRAS escalas."""
        def minutos(hhmm: str) -> int:
            h, m = hhmm.split(":")
            return int(h) * 60 + int(m)

        def intervalo(dia: date, ent: str, sai: str) -> tuple[int, int]:
            ini = dia.toordinal() * 1440 + minutos(ent)
            fim = dia.toordinal() * 1440 + minutos(sai)
            return ini, fim + 1440 if minutos(sai) <= minutos(ent) else fim

        ini, fim = intervalo(data, entrada, saida)
        cursor.execute(
            "SELECT i.operacao, i.data, i.id_turno, i.entrada_ajuste, i.saida_ajuste FROM dbo.wfm_escala_itens i "
            "WHERE i.id_operador = ? AND i.operacao <> ? AND i.data BETWEEN ? AND ? "
            # escalas excluídas ou desativadas não participam do conflito (o histórico delas não bloqueia a agenda)
            "AND NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config oc WHERE oc.operacao = i.operacao AND (oc.excluida = 1 OR oc.ativa = 0)) "
            "AND NOT EXISTS (SELECT 1 FROM dbo.wfm_tipos_escala t WHERE t.chave = i.operacao AND t.ativo = 0)",
            (id_operador, operacao, data - timedelta(days=1), data + timedelta(days=1)),
        )
        for op_outra, dia_outro, id_turno_outro, aj_ent, aj_sai in cursor.fetchall():
            turno = self._wfm_turnos_modelo(cursor, op_outra).get(int(id_turno_outro))
            if not turno or turno.tipo != "TRABALHO":
                continue
            ent, sai = (normalize_text(aj_ent), normalize_text(aj_sai)) if aj_ent and aj_sai else (turno.entrada, turno.saida)
            if not ent or not sai:
                continue
            o_ini, o_fim = intervalo(dia_outro, ent, sai)
            if ini < o_fim and o_ini < fim:
                return (
                    f"{nome} já está escalado em {self._wfm_nome_escala(cursor, op_outra)} em {dia_outro.strftime('%d/%m/%Y')}, "
                    f"das {ent} às {sai}. Ajuste o horário para não coincidir."
                )
        return None

    def wfm_publicar(self, user, operacao: str, ano_mes: str, *, justificativa: str = "", ip: str = "") -> dict:
        ano_mes = _exigir_ano_mes(ano_mes)
        justificativa = normalize_text(justificativa)
        if user.perfil == ROLE_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="O Administrador não publica escalas.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True, escala=True)
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes, criar=True)
            if cab["fechada"]:
                if not user.has_permission("wfm.escala.corrigir_fechada"):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Período fechado: somente o Gestor/RH publica correções.")
                if not justificativa:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Informe a justificativa da correção após o fechamento.")
            snapshot = self._wfm_snapshot(cursor, operacao, ano_mes)
            if not snapshot["itens"]:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A escala está vazia: nada a publicar.")
            if not cab["fechada"]:
                ap = self._wfm_aprov_efetivo(cab, snapshot)
                if ap["estado"] != "APROVADA":
                    detalhe = (
                        "A escala foi alterada depois da aprovação: envie novamente para aprovação."
                        if ap["invalidada"] else "A escala precisa ser aprovada pelo Gestor ou Supervisor antes de ser publicada."
                    )
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalhe)
            # Conflito de interesse: quem está na escala como operador não a publica (o Analista de TI é exceção).
            if user.perfil != ROLE_ANALISTA_TI and any(i["id_operador"] == user.id_usuario for i in snapshot["itens"]):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Você consta nesta escala como operador e não pode publicá-la.")
            todos = self._wfm_todos_operadores(cursor, operacao)
            resumo = self._wfm_resumo_violacoes(self._wfm_violacoes(cursor, operacao, ano_mes, todos))
            violacoes = resumo["violacoes"]
            com_violacao = resumo["bloqueio"]
            if resumo["bloqueio_duro"]:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"mensagem": "Existe violação de lei que nenhum perfil pode publicar. Corrija a escala.", **self._wfm_filtrar_violacoes(cursor, user, operacao, resumo)},
                )
            if com_violacao:
                if not user.has_permission("wfm.escala.publicar_com_violacao"):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail={"mensagem": "A escala tem violações pendentes. Corrija ou peça ao Gestor/RH para publicar com justificativa.", **self._wfm_filtrar_violacoes(cursor, user, operacao, resumo)},
                    )
                if not justificativa:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"mensagem": "Justificativa obrigatória para publicar com violação pendente.", "exige_justificativa": True})
            # O histórico é imutável: a próxima versão parte do maior número JÁ gravado, nunca só do cabeçalho.
            cursor.execute("SELECT ISNULL(MAX(versao), 0) FROM dbo.wfm_escala_versoes WHERE operacao = ? AND ano_mes = ?", (operacao, ano_mes))
            versao = max(cab["versao_publicada"], int(cursor.fetchone()[0])) + 1
            cursor.execute(
                "INSERT INTO dbo.wfm_escala_versoes (operacao, ano_mes, versao, publicado_por, publicado_por_nome, com_violacao, justificativa, violacoes_json, snapshot_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    operacao, ano_mes, versao, user.id_usuario, normalize_text(user.nome) or user.username,
                    1 if com_violacao else 0, justificativa or None,
                    json.dumps(violacoes, ensure_ascii=False) if violacoes else None,
                    json.dumps(snapshot, ensure_ascii=False),
                ),
            )
            cursor.execute(
                "UPDATE dbo.wfm_escalas SET versao_publicada = ?, atualizado_em = GETDATE() WHERE operacao = ? AND ano_mes = ?",
                (versao, operacao, ano_mes),
            )
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="publicar_com_violacao" if com_violacao else "publicar_escala",
                entidade="escala", entidade_id=f"{ano_mes}:v{versao}",
                antes={"versao": cab["versao_publicada"]},
                depois={"versao": versao, "itens": len(snapshot["itens"]), "violacoes": len(violacoes)},
                justificativa=justificativa, ip=ip,
            )
            conn.commit()
            return {"success": True, "versao": versao, "com_violacao": com_violacao}
        finally:
            conn.close()

    def _wfm_filtrar_violacoes(self, cursor, user, operacao: str, resumo: dict) -> dict:
        """Detalhe de violações só dos operadores que o usuário pode ver; o resto vira contagem."""
        visiveis = {op["id_usuario"] for op in self._wfm_operadores_visiveis(cursor, user, operacao)}
        vistas = [v for v in resumo["violacoes"] if v["id_operador"] in visiveis]
        return {"violacoes": vistas, "violacoes_outras_equipes": len(resumo["violacoes"]) - len(vistas)}

    def wfm_fechar_periodo(self, user, operacao: str, ano_mes: str, *, ip: str = "") -> dict:
        ano_mes = _exigir_ano_mes(ano_mes)
        if user.perfil == ROLE_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="O Administrador não fecha períodos.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True, escala=True)
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes)
            if cab["fechada"]:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este período já está fechado.")
            if cab["versao_publicada"] < 1:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Publique a escala antes de fechar o período.")
            cursor.execute(
                "SELECT snapshot_json FROM dbo.wfm_escala_versoes WHERE operacao = ? AND ano_mes = ? AND versao = ?",
                (operacao, ano_mes, cab["versao_publicada"]),
            )
            publicado = json.loads(cursor.fetchone()[0])
            atual = self._wfm_snapshot(cursor, operacao, ano_mes)
            chave = lambda s: sorted((i["id_operador"], i["data"], i["id_turno"]) for i in s["itens"])  # noqa: E731
            if chave(publicado) != chave(atual):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Há alterações não publicadas: publique antes de fechar o período.")
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "UPDATE dbo.wfm_escalas SET fechada = 1, fechada_por = ?, fechada_em = GETDATE() WHERE operacao = ? AND ano_mes = ?",
                (autor, operacao, ano_mes),
            )
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="fechar_periodo", entidade="escala", entidade_id=ano_mes,
                antes={"fechada": False}, depois={"fechada": True, "versao": cab["versao_publicada"]}, ip=ip,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def wfm_list_versoes(self, user, operacao: str, ano_mes: str) -> list[dict]:
        ano_mes = _exigir_ano_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escala=True)
            conn.commit()
            cursor.execute(
                "SELECT v.versao, v.publicado_por_nome, v.publicado_em, v.com_violacao, v.justificativa, "
                "(SELECT TOP 1 a.usuario_nome FROM dbo.wfm_auditoria a WHERE a.operacao = v.operacao AND a.acao = 'aprovar_escala' "
                "AND a.entidade_id = v.ano_mes AND a.criado_em <= v.publicado_em ORDER BY a.criado_em DESC) "
                "FROM dbo.wfm_escala_versoes v WHERE v.operacao = ? AND v.ano_mes = ? ORDER BY v.versao DESC",
                (operacao, ano_mes),
            )
            return [
                {
                    "versao": int(r[0]), "publicado_por": normalize_text(r[1]) or None,
                    "publicado_em": r[2].isoformat() if r[2] else None, "com_violacao": bool(r[3]),
                    "justificativa": normalize_text(r[4]) or None, "aprovado_por": normalize_text(r[5]) or None,
                }
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def wfm_get_versao(self, user, operacao: str, ano_mes: str, versao: int) -> dict:
        ano_mes = _exigir_ano_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escala=True)
            conn.commit()
            cursor.execute(
                "SELECT snapshot_json, violacoes_json FROM dbo.wfm_escala_versoes WHERE operacao = ? AND ano_mes = ? AND versao = ?",
                (operacao, ano_mes, int(versao)),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Versão não encontrada.")
            visiveis = {op["id_usuario"] for op in self._wfm_operadores_visiveis(cursor, user, operacao)}
            snap = json.loads(row[0])
            snap["itens"] = [i for i in snap["itens"] if i["id_operador"] in visiveis]
            violacoes = [v for v in (json.loads(row[1]) if row[1] else []) if v["id_operador"] in visiveis]
            return {"versao": int(versao), **snap, "violacoes": violacoes}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Presença e atestados
    # ------------------------------------------------------------------
    def wfm_list_presencas(self, user, operacao: str, ano_mes: str) -> list[dict]:
        ano_mes = _exigir_ano_mes(ano_mes)
        dias = dias_do_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            ids = [op["id_usuario"] for op in self._wfm_operadores_visiveis(cursor, user, operacao)]
            if not ids:
                return []
            marcadores = ",".join("?" for _ in ids)
            cursor.execute(
                f"SELECT id_operador, data, status, observacao, lancado_por FROM dbo.wfm_presencas "
                f"WHERE operacao = ? AND data BETWEEN ? AND ? AND id_operador IN ({marcadores})",
                (operacao, dias[0], dias[-1], *ids),
            )
            return [
                {"id_operador": int(r[0]), "data": r[1].isoformat(), "status": normalize_text(r[2]),
                 "observacao": normalize_text(r[3]) or None, "lancado_por": normalize_text(r[4]) or None}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def wfm_lancar_presenca(
        self, user, operacao: str, id_operador: int, data: Any, status_presenca: str, observacao: str = "", *, ip: str = ""
    ) -> dict:
        """Sem prazo para lançar ou corrigir (regra do RH): a alteração é sempre permitida, sempre auditada."""
        data = _parse_data(data)
        status_presenca = normalize_text(status_presenca).upper()
        if status_presenca not in STATUS_PRESENCA:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status de presença inválido.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_operador_da_operacao(cursor, operacao, id_operador)
            self._wfm_exigir_edicao_do_operador(cursor, user, operacao, id_operador)
            cursor.execute(
                "SELECT id_presenca, status, observacao FROM dbo.wfm_presencas WHERE operacao = ? AND id_operador = ? AND data = ?",
                (operacao, int(id_operador), data),
            )
            atual = cursor.fetchone()
            autor = normalize_text(user.nome) or user.username
            obs = normalize_text(observacao)[:300] or None
            if atual:
                cursor.execute(
                    "UPDATE dbo.wfm_presencas SET status = ?, observacao = ?, lancado_por = ?, atualizado_em = GETDATE() WHERE id_presenca = ?",
                    (status_presenca, obs, autor, int(atual[0])),
                )
            else:
                cursor.execute(
                    "INSERT INTO dbo.wfm_presencas (operacao, id_operador, data, status, observacao, lancado_por) VALUES (?, ?, ?, ?, ?, ?)",
                    (operacao, int(id_operador), data, status_presenca, obs, autor),
                )
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="lancar_presenca", entidade="presenca", entidade_id=f"{id_operador}:{data.isoformat()}",
                antes={"status": normalize_text(atual[1]), "observacao": normalize_text(atual[2])} if atual else None,
                depois={"status": status_presenca, "observacao": obs}, ip=ip,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Hora extra (lançamento simples: minutos por operador/dia; sem aprovação)
    # ------------------------------------------------------------------
    def wfm_list_horas_extras(self, user, operacao: str, ano_mes: str) -> list[dict]:
        ano_mes = _exigir_ano_mes(ano_mes)
        dias = dias_do_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            ids = [op["id_usuario"] for op in self._wfm_operadores_visiveis(cursor, user, operacao)]
            if not ids:
                return []
            cursor.execute(
                f"SELECT id_operador, data, minutos, observacao, lancado_por FROM dbo.wfm_horas_extras "
                f"WHERE operacao = ? AND data BETWEEN ? AND ? AND id_operador IN ({','.join('?' for _ in ids)})",
                (operacao, dias[0], dias[-1], *ids),
            )
            return [
                {"id_operador": int(r[0]), "data": r[1].isoformat(), "minutos": int(r[2]),
                 "observacao": normalize_text(r[3]) or None, "lancado_por": normalize_text(r[4]) or None}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def wfm_lancar_hora_extra(
        self, user, operacao: str, id_operador: int, data: Any, minutos: int, observacao: str = "", *, ip: str = ""
    ) -> dict:
        data = _parse_data(data)
        minutos = int(minutos)
        if minutos < 0 or minutos > 720:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe de 0 a 720 minutos de hora extra.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_operador_da_operacao(cursor, operacao, id_operador)
            self._wfm_exigir_edicao_do_operador(cursor, user, operacao, id_operador)
            cursor.execute(
                "SELECT id_hora_extra, minutos, observacao FROM dbo.wfm_horas_extras WHERE operacao = ? AND id_operador = ? AND data = ?",
                (operacao, int(id_operador), data),
            )
            atual = cursor.fetchone()
            autor = normalize_text(user.nome) or user.username
            obs = normalize_text(observacao)[:200] or None
            if minutos == 0:
                if atual:
                    cursor.execute("DELETE FROM dbo.wfm_horas_extras WHERE id_hora_extra = ?", (int(atual[0]),))
            elif atual:
                cursor.execute(
                    "UPDATE dbo.wfm_horas_extras SET minutos = ?, observacao = ?, lancado_por = ?, atualizado_em = GETDATE() WHERE id_hora_extra = ?",
                    (minutos, obs, autor, int(atual[0])),
                )
            else:
                cursor.execute(
                    "INSERT INTO dbo.wfm_horas_extras (operacao, id_operador, data, minutos, observacao, lancado_por) VALUES (?, ?, ?, ?, ?, ?)",
                    (operacao, int(id_operador), data, minutos, obs, autor),
                )
            if (int(atual[1]) if atual else 0) != minutos:
                self.wfm_audit(
                    cursor, user, operacao=operacao, acao="lancar_hora_extra", entidade="hora_extra", entidade_id=f"{id_operador}:{data.isoformat()}",
                    antes={"minutos": int(atual[1])} if atual else None, depois={"minutos": minutos, "observacao": obs}, ip=ip,
                )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def wfm_registrar_atestado(
        self, user, operacao: str, id_operador: int, data_ini: Any, data_fim: Any, tipo: str, *, ip: str = ""
    ) -> dict:
        """Guarda só período, tipo e quem validou. Nunca o arquivo do atestado nem CID (dado de saúde)."""
        data_ini, data_fim = _parse_data(data_ini), _parse_data(data_fim)
        tipo = normalize_text(tipo).upper()
        if tipo not in TIPOS_ATESTADO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de atestado inválido.")
        if data_fim < data_ini or (data_fim - data_ini).days > 60:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Período do atestado inválido (máximo 60 dias).")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_operador_da_operacao(cursor, operacao, id_operador)
            self._wfm_exigir_edicao_do_operador(cursor, user, operacao, id_operador)
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "INSERT INTO dbo.wfm_atestados (operacao, id_operador, data_ini, data_fim, tipo, validado_por) OUTPUT INSERTED.id_atestado VALUES (?, ?, ?, ?, ?, ?)",
                (operacao, int(id_operador), data_ini, data_fim, tipo, autor),
            )
            id_atestado = int(cursor.fetchone()[0])
            dia = data_ini
            while dia <= data_fim:
                cursor.execute(
                    "IF EXISTS (SELECT 1 FROM dbo.wfm_presencas WHERE operacao = ? AND id_operador = ? AND data = ?) "
                    "UPDATE dbo.wfm_presencas SET status = 'ATESTADO', lancado_por = ?, atualizado_em = GETDATE() WHERE operacao = ? AND id_operador = ? AND data = ? "
                    "ELSE INSERT INTO dbo.wfm_presencas (operacao, id_operador, data, status, lancado_por) VALUES (?, ?, ?, 'ATESTADO', ?)",
                    (operacao, int(id_operador), dia, autor, operacao, int(id_operador), dia, operacao, int(id_operador), dia, autor),
                )
                dia += timedelta(days=1)
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="registrar_atestado", entidade="atestado", entidade_id=id_atestado,
                depois={"id_operador": int(id_operador), "data_ini": str(data_ini), "data_fim": str(data_fim), "tipo": tipo}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_atestado": id_atestado}
        finally:
            conn.close()

    def wfm_list_atestados(self, user, operacao: str, ano_mes: str) -> list[dict]:
        """Leitura mínima: só quem lança presença (dentro do próprio escopo/equipe). Sem arquivo, sem CID."""
        ano_mes = _exigir_ano_mes(ano_mes)
        dias = dias_do_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            ids = [op["id_usuario"] for op in self._wfm_operadores_visiveis(cursor, user, operacao)]
            if not ids:
                return []
            marcadores = ",".join("?" for _ in ids)
            cursor.execute(
                f"SELECT id_atestado, id_operador, data_ini, data_fim, tipo, validado_por FROM dbo.wfm_atestados "
                f"WHERE operacao = ? AND data_ini <= ? AND data_fim >= ? AND id_operador IN ({marcadores}) ORDER BY data_ini",
                (operacao, dias[-1], dias[0], *ids),
            )
            return [
                {"id_atestado": int(r[0]), "id_operador": int(r[1]), "data_ini": r[2].isoformat(), "data_fim": r[3].isoformat(),
                 "tipo": normalize_text(r[4]), "validado_por": normalize_text(r[5])}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Exportação em planilha (escala mensal do escopo do usuário)
    # ------------------------------------------------------------------
    def wfm_exportar_escala(self, user, operacao: str, ano_mes: str, formato: str = "xlsx", *, ip: str = "") -> tuple[bytes, str, str]:
        """XLSX/CSV da escala-rascunho do mês, só dos operadores que o usuário pode ver. Duas abas:
        "Escala" (código do turno por dia + total de horas) e "Horários" (um dia por linha, com
        entrada, saída e horas líquidas já com feriado/dia/horário especial aplicados)."""
        ano_mes = _exigir_ano_mes(ano_mes)
        formato = "csv" if normalize_text(formato).lower() == "csv" else "xlsx"
        dias = dias_do_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escala=True)
            conn.commit()
            operadores = self._wfm_operadores_visiveis(cursor, user, operacao)
            ids = [op["id_usuario"] for op in operadores]
            modelos = self._wfm_turnos_modelo(cursor, operacao)
            cursor.execute(
                "SELECT tipo, data_ini, data_fim, id_turno, entrada, saida FROM dbo.wfm_calendario_especial "
                "WHERE operacao = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?",
                (operacao, dias[-1], dias[0]),
            )
            eventos = [EventoCalendario(normalize_text(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in cursor.fetchall()]
            itens: dict[tuple[int, date], int] = {}
            ajustes_exp: dict[tuple[int, date], tuple[str, str]] = {}
            if ids:
                cursor.execute(
                    f"SELECT id_operador, data, id_turno, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens WHERE operacao = ? AND ano_mes = ? AND id_operador IN ({','.join('?' for _ in ids)})",
                    (operacao, ano_mes, *ids),
                )
                for r in cursor.fetchall():
                    itens[(int(r[0]), r[1])] = int(r[2])
                    if r[3] and r[4]:
                        ajustes_exp[(int(r[0]), r[1])] = (normalize_text(r[3]), normalize_text(r[4]))
            contratos = self._wfm_contratos_vigentes(cursor, operacao, ids, dias[0], dias[-1]) if ids else {}
            cab_dias = [f"{d.day:02d}/{d.month:02d}" for d in dias]
            linhas_escala, linhas_horarios = [], []
            for op in operadores:
                codigos, total_min, trabalhados = [], 0, 0
                for d in dias:
                    id_turno = itens.get((op["id_usuario"], d))
                    if id_turno is None or id_turno not in modelos:
                        codigos.append("")
                        continue
                    h = horario_efetivo(d, modelos[id_turno], modelos, eventos, ajustes_exp.get((op["id_usuario"], d)))
                    codigos.append(h["codigo"])
                    if h["trabalha"]:
                        total_min += h["minutos"]
                        trabalhados += 1
                    linhas_horarios.append([op["nome"], d.strftime("%d/%m/%Y"), h["codigo"], h["entrada"] or "", h["saida"] or "", round(h["minutos"] / 60, 2) if h["trabalha"] else 0])
                contrato = (contratos.get(op["id_usuario"]) or [{}])[-1].get("codigo", "")
                linhas_escala.append([op["nome"], contrato, *codigos, trabalhados, round(total_min / 60, 2)])
            colunas = ["Operador", "Contrato", *cab_dias, "Dias trabalhados", "Horas no mês"]
            self.wfm_audit(cursor, user, operacao=operacao, acao="exportar_escala", entidade="escala", entidade_id=ano_mes,
                           depois={"formato": formato, "operadores": len(operadores)}, ip=ip)
            conn.commit()
        finally:
            conn.close()
        nome = f"escala_{re.sub(r'[^A-Za-z0-9]+', '_', operacao).strip('_')}_{ano_mes}.{formato}"  # chave de tipo de escala tem '::'
        if formato == "csv":
            return gerar_csv(colunas, linhas_escala), nome, "text/csv; charset=utf-8"
        abas = [
            {"nome": "Escala", "colunas": colunas, "linhas": linhas_escala},
            {"nome": "Horários", "colunas": ["Operador", "Data", "Turno", "Entrada", "Saída", "Horas líquidas"], "linhas": linhas_horarios},
        ]
        return gerar_xlsx(abas), nome, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def wfm_lancar_presenca_lote(
        self, user, operacao: str, data: Any, status_presenca: str, excecoes: list[int] | None = None, *, ip: str = ""
    ) -> dict:
        """Aplica o mesmo status a TODOS os operadores escalados do dia que o usuário pode editar, exceto
        os `excecoes` (ex.: "presença para todos, menos quem faltou"). Sem prazo; tudo auditado."""
        data = _parse_data(data)
        status_presenca = normalize_text(status_presenca).upper()
        if status_presenca not in STATUS_PRESENCA:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status de presença inválido.")
        excecoes_set = {int(i) for i in (excecoes or [])}
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
            cursor.execute(
                "SELECT DISTINCT i.id_operador FROM dbo.wfm_escala_itens i JOIN dbo.wfm_turnos t ON t.id_turno = i.id_turno "
                "WHERE i.operacao = ? AND i.data = ? AND t.tipo = 'TRABALHO'",
                (operacao, data),
            )
            escalados = [int(r[0]) for r in cursor.fetchall()]
            alvos = [
                i for i in escalados
                if i not in excecoes_set
                and wfm_scope.pode_editar_escala_de(
                    perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
                    operacao=operacao, id_operador=i, equipe_supervisor=equipe,
                )
            ]
            autor = normalize_text(user.nome) or user.username
            for id_op in alvos:
                cursor.execute(
                    "IF EXISTS (SELECT 1 FROM dbo.wfm_presencas WHERE operacao = ? AND id_operador = ? AND data = ?) "
                    "UPDATE dbo.wfm_presencas SET status = ?, lancado_por = ?, atualizado_em = GETDATE() WHERE operacao = ? AND id_operador = ? AND data = ? "
                    "ELSE INSERT INTO dbo.wfm_presencas (operacao, id_operador, data, status, lancado_por) VALUES (?, ?, ?, ?, ?)",
                    (operacao, id_op, data, status_presenca, autor, operacao, id_op, data, operacao, id_op, data, status_presenca, autor),
                )
            self.wfm_audit(cursor, user, operacao=operacao, acao="lancar_presenca_lote", entidade="presenca", entidade_id=data.isoformat(),
                           depois={"status": status_presenca, "operadores": len(alvos), "excecoes": sorted(excecoes_set)}, ip=ip)
            conn.commit()
            return {"success": True, "aplicados": len(alvos), "ignorados": len(excecoes_set & set(escalados))}
        finally:
            conn.close()

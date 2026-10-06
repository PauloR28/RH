"""WFM — escala de pausas individual e capacidade de pausas por operação. Mixin do DatabaseRepository.

Cada operador escalado tem 3 pausas por dia (2 de 10 min + 1 de 20 min, contadas como jornada). Quantos
operadores podem estar em pausa ao mesmo tempo é parâmetro da operação (`wfm_operacao_config`): exceder
é ALERTA, não bloqueio (o RH disse que não há limite rígido; o recomendado varia com o tamanho da operação).
Pausas emergenciais (banheiro, feedback...) ficam fora desta escala.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_SUPERVISOR
from ..services import wfm_pausas as regras
from ..services import wfm_scope
from ..services.helpers import normalize_text
from ..services.wfm_montagem import EventoCalendario, horario_efetivo

TIPOS_PAUSA_PROGRAMADA = ("DESCANSO", "REFEICAO")


def _http(codigo: int, detalhe: Any) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def _data(valor: Any) -> date:
    try:
        return valor if isinstance(valor, date) else date.fromisoformat(str(valor))
    except ValueError:
        raise _http(status.HTTP_400_BAD_REQUEST, "Data inválida (AAAA-MM-DD).")


class WfmPausasRepositoryMixin:
    # ------------------------------------------------------------------
    # Capacidade da operação
    # ------------------------------------------------------------------
    def _wfm_capacidade(self, cursor, operacao: str) -> int:
        cursor.execute("SELECT pausas_simultaneas FROM dbo.wfm_operacao_config WHERE operacao = ?", (operacao,))
        row = cursor.fetchone()
        return int(row[0]) if row else 1

    def wfm_set_capacidade_pausas(self, user, operacao: str, simultaneas: int, *, ip: str = "") -> dict:
        simultaneas = int(simultaneas)
        if not 1 <= simultaneas <= 200:
            raise _http(status.HTTP_400_BAD_REQUEST, "Informe entre 1 e 200 operadores em pausa ao mesmo tempo.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            antes = self._wfm_capacidade(cursor, operacao)
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "IF EXISTS (SELECT 1 FROM dbo.wfm_operacao_config WITH (UPDLOCK, HOLDLOCK) WHERE operacao = ?) "
                "UPDATE dbo.wfm_operacao_config SET pausas_simultaneas = ?, atualizado_por = ?, atualizado_em = GETDATE() WHERE operacao = ? "
                "ELSE INSERT INTO dbo.wfm_operacao_config (operacao, pausas_simultaneas, atualizado_por) VALUES (?, ?, ?)",
                (operacao, simultaneas, autor, operacao, operacao, simultaneas, autor),
            )
            self.wfm_audit(cursor, user, operacao=operacao, acao="definir_capacidade_pausas", entidade="operacao",
                           entidade_id=operacao, antes={"pausas_simultaneas": antes}, depois={"pausas_simultaneas": simultaneas}, ip=ip)
            conn.commit()
            return {"success": True, "pausas_simultaneas": simultaneas}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Leitura do dia
    # ------------------------------------------------------------------
    def _wfm_escalados_do_dia(self, cursor, operacao: str, dia: date) -> dict[int, dict]:
        """id_operador -> turno efetivo (entrada/saída/código) de quem TRABALHA no dia (rascunho da escala)."""
        modelos = self._wfm_turnos_modelo(cursor, operacao)
        cursor.execute(
            "SELECT tipo, data_ini, data_fim, id_turno, entrada, saida FROM dbo.wfm_calendario_especial "
            "WHERE operacao = ? AND ativo = 1 AND data_ini <= ? AND data_fim >= ?",
            (operacao, dia, dia),
        )
        eventos = [EventoCalendario(normalize_text(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in cursor.fetchall()]
        cursor.execute("SELECT id_operador, id_turno, entrada_ajuste, saida_ajuste FROM dbo.wfm_escala_itens WHERE operacao = ? AND data = ?", (operacao, dia))
        saida: dict[int, dict] = {}
        for id_op, id_turno, e_aj, s_aj in cursor.fetchall():
            modelo = modelos.get(int(id_turno))
            if not modelo:
                continue
            h = horario_efetivo(dia, modelo, modelos, eventos, (e_aj, s_aj) if e_aj and s_aj else None)
            if h["trabalha"]:
                saida[int(id_op)] = {"codigo": h["codigo"], "entrada": h["entrada"], "saida": h["saida"]}
        return saida

    def _wfm_pausas_programadas(self, cursor, operacao: str, dia: date) -> dict[int, list[dict]]:
        cursor.execute(
            "SELECT id_operador, ordem, tipo, inicio, duracao_min FROM dbo.wfm_pausas WHERE operacao = ? AND data = ? ORDER BY id_operador, ordem",
            (operacao, dia),
        )
        out: dict[int, list[dict]] = {}
        for r in cursor.fetchall():
            out.setdefault(int(r[0]), []).append({"ordem": int(r[1]), "tipo": normalize_text(r[2]), "inicio": normalize_text(r[3]), "duracao_min": int(r[4])})
        return out

    def _wfm_programacao(self, escalados: dict[int, dict], programadas: dict[int, list[dict]]) -> dict[int, list[regras.PausaProgramada]]:
        prog: dict[int, list[regras.PausaProgramada]] = {}
        for id_op, pausas in programadas.items():
            turno = escalados.get(id_op)
            if not turno:
                continue
            ini, _ = regras.janela_do_turno(turno["entrada"], turno["saida"])
            prog[id_op] = [regras.PausaProgramada(p["ordem"], p["tipo"], regras.desenrolar(p["inicio"], ini), p["duracao_min"]) for p in pausas]
        return prog

    def wfm_get_pausas_dia(self, user, operacao: str, data: Any) -> dict:
        dia = _data(data)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            capacidade = self._wfm_capacidade(cursor, operacao)
            escalados = self._wfm_escalados_do_dia(cursor, operacao, dia)
            programadas = self._wfm_pausas_programadas(cursor, operacao, dia)
            prog = self._wfm_programacao(escalados, programadas)
            visiveis = {o["id_usuario"]: o["nome"] for o in self._wfm_operadores_visiveis(cursor, user, operacao)}
            itens = []
            for id_op, turno in sorted(escalados.items(), key=lambda kv: (kv[1]["entrada"], visiveis.get(kv[0], ""))):
                if id_op not in visiveis:
                    continue
                ini, fim = regras.janela_do_turno(turno["entrada"], turno["saida"])
                itens.append({
                    "id_operador": id_op, "nome": visiveis[id_op], "turno": turno,
                    "pausas": programadas.get(id_op, []),
                    "erros": regras.validar_pausas_do_operador(prog.get(id_op, []), ini, fim),
                })
            ocup = regras.ocupacao(prog)
            blocos: dict[int, int] = {}
            for minuto, qtd in ocup.items():  # pico por faixa de 30 min
                blocos[minuto - minuto % 30] = max(blocos.get(minuto - minuto % 30, 0), qtd)
            return {
                "data": dia.isoformat(), "capacidade": capacidade,
                "pausas_padrao": [{"ordem": o, "tipo": t, "duracao_min": d} for o, t, d in regras.PAUSAS_PADRAO],
                "operadores": itens,
                "excedentes": regras.excedentes(prog, capacidade),
                "ocupacao": [{"hora": regras.min_para_hhmm(k), "qtd": v} for k, v in sorted(blocos.items())],
                "sem_pausa_programada": sum(1 for i in itens if not i["pausas"]),
            }
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Escrita (Supervisor da equipe / Control Desk / Gestor)
    # ------------------------------------------------------------------
    def _wfm_exigir_periodo_editavel(self, cursor, user, operacao: str, dia: date) -> None:
        cab = self._wfm_cabecalho(cursor, operacao, f"{dia.year}-{dia.month:02d}")
        if cab["fechada"] and not user.has_permission("wfm.escala.corrigir_fechada"):
            raise _http(status.HTTP_403_FORBIDDEN, "Período fechado: somente o Gestor/RH altera as pausas.")

    def wfm_salvar_pausas(self, user, operacao: str, data: Any, itens: list[dict], *, ip: str = "") -> dict:
        dia = _data(data)
        if user.perfil == ROLE_ADMIN:
            raise _http(status.HTTP_403_FORBIDDEN, "O Administrador não programa pausas.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_exigir_periodo_editavel(cursor, user, operacao, dia)
            escalados = self._wfm_escalados_do_dia(cursor, operacao, dia)
            equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
            autor = normalize_text(user.nome) or user.username
            erros: list[str] = []
            gravar: list[tuple[int, list[dict]]] = []
            for item in itens:
                id_op = int(item["id_operador"])
                if not wfm_scope.pode_editar_escala_de(perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
                                                       operacao=operacao, id_operador=id_op, equipe_supervisor=equipe):
                    raise _http(status.HTTP_403_FORBIDDEN, "Você não pode programar as pausas deste operador (fora da equipe/escopo ou conflito de interesse).")
                turno = escalados.get(id_op)
                if not turno:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O operador não está escalado para trabalhar neste dia.")
                ini, fim = regras.janela_do_turno(turno["entrada"], turno["saida"])
                pausas = []
                for p in item.get("pausas", []):
                    tipo = normalize_text(p.get("tipo")).upper()
                    inicio = normalize_text(p.get("inicio"))
                    duracao = int(p.get("duracao_min") or 0)
                    if tipo not in TIPOS_PAUSA_PROGRAMADA or duracao < 1 or len(inicio) != 5 or inicio[2] != ":":
                        raise _http(status.HTTP_400_BAD_REQUEST, "Pausa inválida (tipo, horário HH:MM e duração).")
                    pausas.append({"ordem": int(p.get("ordem") or len(pausas) + 1), "tipo": tipo, "inicio": inicio, "duracao_min": duracao})
                prog = [regras.PausaProgramada(p["ordem"], p["tipo"], regras.desenrolar(p["inicio"], ini), p["duracao_min"]) for p in pausas]
                erros += [f"{id_op}: {e}" for e in regras.validar_pausas_do_operador(prog, ini, fim)]
                gravar.append((id_op, pausas))
            if erros:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, {"mensagem": " ".join(erros), "erros": erros})
            for id_op, pausas in gravar:
                cursor.execute("DELETE FROM dbo.wfm_pausas WHERE operacao = ? AND id_operador = ? AND data = ?", (operacao, id_op, dia))
                for p in pausas:
                    cursor.execute(
                        "INSERT INTO dbo.wfm_pausas (operacao, id_operador, data, ordem, tipo, inicio, duracao_min, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (operacao, id_op, dia, p["ordem"], p["tipo"], p["inicio"], p["duracao_min"], autor),
                    )
                self.wfm_audit(cursor, user, operacao=operacao, acao="programar_pausas", entidade="pausas", entidade_id=f"{id_op}:{dia.isoformat()}",
                               depois={"pausas": [f"{p['inicio']} {p['tipo']} {p['duracao_min']}min" for p in pausas]}, ip=ip)
            conn.commit()
            return {"success": True, "operadores": len(gravar)}
        finally:
            conn.close()

    def wfm_distribuir_pausas_periodo(
        self, user, operacao: str, data_ini: Any, data_fim: Any, ids: list[int] | None = None, *,
        sobrescrever: bool = False, dias_semana: list[int] | None = None, ip: str = "",
    ) -> dict:
        """Distribui as pausas de cada dia entre `data_ini` e `data_fim` (semana ou mês). Dia de período fechado
        ou sem escalados é pulado; o resumo informa quantos dias foram programados."""
        ini, fim = _data(data_ini), _data(data_fim)
        if fim < ini or (fim - ini).days > 62:
            raise _http(status.HTTP_400_BAD_REQUEST, "Período inválido (máximo de 2 meses).")
        dias_ok = set(dias_semana) if dias_semana is not None else set(range(7))
        programados, pulados, operadores = 0, 0, 0
        dia = ini
        while dia <= fim:
            if dia.weekday() in dias_ok:
                try:
                    r = self.wfm_distribuir_pausas(user, operacao, dia, ids, sobrescrever=sobrescrever, ip=ip)
                    if r["operadores"]:
                        programados += 1
                        operadores += r["operadores"]
                except HTTPException as exc:
                    if exc.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN) and user.perfil == ROLE_ADMIN:
                        raise
                    pulados += 1
            dia = date.fromordinal(dia.toordinal() + 1)
        return {"success": True, "dias_programados": programados, "dias_pulados": pulados, "operadores": operadores}

    def wfm_distribuir_pausas(self, user, operacao: str, data: Any, ids: list[int] | None = None, *, sobrescrever: bool = False, ip: str = "") -> dict:
        """Preenche as 3 pausas de cada operador escalado do escopo (ou só dos `ids`), respeitando a
        capacidade simultânea da operação. Por padrão não mexe em quem já tem pausas programadas."""
        dia = _data(data)
        if user.perfil == ROLE_ADMIN:
            raise _http(status.HTTP_403_FORBIDDEN, "O Administrador não programa pausas.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_exigir_periodo_editavel(cursor, user, operacao, dia)
            capacidade = self._wfm_capacidade(cursor, operacao)
            escalados = self._wfm_escalados_do_dia(cursor, operacao, dia)
            programadas = self._wfm_pausas_programadas(cursor, operacao, dia)
            equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
            alvos = []
            for id_op, turno in escalados.items():
                if ids is not None and id_op not in ids:
                    continue
                if not wfm_scope.pode_editar_escala_de(perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
                                                       operacao=operacao, id_operador=id_op, equipe_supervisor=equipe):
                    continue
                if programadas.get(id_op) and not sobrescrever:
                    continue
                ini, fim = regras.janela_do_turno(turno["entrada"], turno["saida"])
                alvos.append({"id": id_op, "entrada_min": ini, "saida_min": fim})
            ids_alvo = {a["id"] for a in alvos}
            ja = {k: v for k, v in self._wfm_programacao(escalados, programadas).items() if k not in ids_alvo}
            resultado = regras.distribuir(alvos, capacidade, regras.ocupacao(ja))
            autor = normalize_text(user.nome) or user.username
            for id_op, pausas in resultado.items():
                cursor.execute("DELETE FROM dbo.wfm_pausas WHERE operacao = ? AND id_operador = ? AND data = ?", (operacao, id_op, dia))
                for p in pausas:
                    cursor.execute(
                        "INSERT INTO dbo.wfm_pausas (operacao, id_operador, data, ordem, tipo, inicio, duracao_min, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (operacao, id_op, dia, p.ordem, p.tipo, regras.min_para_hhmm(p.inicio_min), p.duracao_min, autor),
                    )
            self.wfm_audit(cursor, user, operacao=operacao, acao="distribuir_pausas", entidade="pausas", entidade_id=dia.isoformat(),
                           depois={"operadores": len(resultado), "capacidade": capacidade}, ip=ip)
            conn.commit()
            return {"success": True, "operadores": len(resultado)}
        finally:
            conn.close()

    def wfm_replicar_pausas(
        self, user, operacao: str, data_origem: Any, data_ini: Any, data_fim: Any, ids: list[int] | None = None, *,
        dias_semana: list[int] | None = None, sobrescrever: bool = True, ip: str = "",
    ) -> dict:
        """Copia os horários de pausa programados em `data_origem` para os demais dias do período (semana/mês), só nos dias da
        semana escolhidos e só para quem trabalha no dia. O limite de operadores em pausa ao mesmo tempo é respeitado em cada
        dia: o horário do modelo é mantido enquanto cabe no limite e no turno; só a pausa que estouraria é deslocada para o
        horário livre mais próximo (quem não tem pausa no modelo e já tem pausas no dia continua ocupando as vagas)."""
        origem, ini, fim = _data(data_origem), _data(data_ini), _data(data_fim)
        if fim < ini or (fim - ini).days > 62:
            raise _http(status.HTTP_400_BAD_REQUEST, "Período inválido (máximo de 2 meses).")
        if user.perfil == ROLE_ADMIN:
            raise _http(status.HTTP_403_FORBIDDEN, "O Administrador não programa pausas.")
        if not user.has_permission("wfm.escala.editar"):
            raise _http(status.HTTP_403_FORBIDDEN, "Você não pode programar as pausas desta escala.")
        dias_ok = set(dias_semana) if dias_semana is not None else set(range(7))
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            capacidade = self._wfm_capacidade(cursor, operacao)
            equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
            modelo = self._wfm_pausas_programadas(cursor, operacao, origem)
            modelo = {
                i: p for i, p in modelo.items()
                if (ids is None or i in ids) and p and wfm_scope.pode_editar_escala_de(
                    perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao,
                    id_operador=i, equipe_supervisor=equipe)
            }
            if not modelo:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nenhum operador do escopo tem pausas programadas no dia de origem. Defina e salve as pausas primeiro.")
            autor = normalize_text(user.nome) or user.username
            dias_gravados = pausas_gravadas = deslocadas = acima_do_limite = dias_com_excesso = periodos_fechados = 0
            dia = ini
            while dia <= fim:
                if dia != origem and dia.weekday() in dias_ok:
                    try:
                        self._wfm_exigir_periodo_editavel(cursor, user, operacao, dia)
                    except HTTPException:
                        periodos_fechados += 1
                        dia = date.fromordinal(dia.toordinal() + 1)
                        continue
                    escalados = self._wfm_escalados_do_dia(cursor, operacao, dia)
                    existentes = self._wfm_pausas_programadas(cursor, operacao, dia)
                    alvos = []
                    for id_op, pausas in modelo.items():
                        turno = escalados.get(id_op)
                        if not turno or (existentes.get(id_op) and not sobrescrever):
                            continue
                        janela_ini, janela_fim = regras.janela_do_turno(turno["entrada"], turno["saida"])
                        alvos.append({"id": id_op, "entrada_min": janela_ini, "saida_min": janela_fim,
                                      "modelo": [(p["ordem"], p["tipo"], p["inicio"], p["duracao_min"]) for p in pausas]})
                    if alvos:
                        ids_alvo = {a["id"] for a in alvos}
                        ja = {k: v for k, v in self._wfm_programacao(escalados, existentes).items() if k not in ids_alvo}
                        resultado, mexidas, estouro = regras.replicar(alvos, capacidade, regras.ocupacao(ja))
                        deslocadas += mexidas
                        acima_do_limite += estouro
                        for id_op, pausas in resultado.items():
                            cursor.execute("DELETE FROM dbo.wfm_pausas WHERE operacao = ? AND id_operador = ? AND data = ?", (operacao, id_op, dia))
                            for p in pausas:
                                cursor.execute(
                                    "INSERT INTO dbo.wfm_pausas (operacao, id_operador, data, ordem, tipo, inicio, duracao_min, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                    (operacao, id_op, dia, p.ordem, p.tipo, regras.min_para_hhmm(p.inicio_min), p.duracao_min, autor),
                                )
                            pausas_gravadas += 1
                        dias_gravados += 1
                        prog_dia = self._wfm_programacao(escalados, self._wfm_pausas_programadas(cursor, operacao, dia))
                        if regras.excedentes(prog_dia, capacidade):
                            dias_com_excesso += 1
                dia = date.fromordinal(dia.toordinal() + 1)
            self.wfm_audit(cursor, user, operacao=operacao, acao="replicar_pausas", entidade="pausas", entidade_id=origem.isoformat(),
                           depois={"periodo": f"{ini.isoformat()}..{fim.isoformat()}", "dias_semana": sorted(dias_ok), "dias": dias_gravados,
                                   "operadores": len(modelo), "deslocadas": deslocadas}, ip=ip)
            conn.commit()
            return {"success": True, "dias_programados": dias_gravados, "pausas_gravadas": pausas_gravadas, "deslocadas": deslocadas,
                    "acima_do_limite": acima_do_limite, "dias_com_excesso": dias_com_excesso, "periodos_fechados": periodos_fechados,
                    "capacidade": capacidade}
        finally:
            conn.close()

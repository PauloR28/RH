"""WFM: turno personalizado por colaborador ("ramificação" de um turno).

O turno-modelo continua inalterado para todos; só o colaborador personalizado tem outro horário (entrada/saída) nesse turno.
A personalização é aplicada ao lançar o turno na escala (vira o `entrada_ajuste`/`saida_ajuste` do dia, que todo o resto do
WFM já entende: validação de jornada, pausas, relatórios, trocas). Opcionalmente também se aplica aos dias já lançados.
"""

from __future__ import annotations

import re

from fastapi import HTTPException, status

from ..services import wfm_scope
from ..services.helpers import normalize_text

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _http(code: int, msg: str) -> HTTPException:
    return HTTPException(status_code=code, detail=msg)


class WfmPersonalizacaoRepositoryMixin:
    def _wfm_personalizacoes_mapa(self, cursor, operacao: str) -> dict[tuple[int, int], tuple[str, str]]:
        """(id_turno, id_operador) -> (entrada, saida). Tabela ausente (migration pendente) = sem personalizações."""
        try:
            cursor.execute("SELECT id_turno, id_operador, entrada, saida FROM dbo.wfm_turno_personalizacoes WHERE operacao = ?", (operacao,))
            return {(int(r[0]), int(r[1])): (normalize_text(r[2]), normalize_text(r[3])) for r in cursor.fetchall()}
        except Exception:  # noqa: BLE001
            return {}

    def _wfm_turno_de_trabalho(self, cursor, operacao: str, id_turno: int) -> dict:
        cursor.execute("SELECT codigo, nome, tipo, entrada, saida FROM dbo.wfm_turnos WHERE id_turno = ? AND operacao = ? AND excluido = 0", (int(id_turno), operacao))
        row = cursor.fetchone()
        if not row:
            raise _http(status.HTTP_404_NOT_FOUND, "Turno não encontrado nesta operação.")
        if normalize_text(row[2]) != "TRABALHO":
            raise _http(status.HTTP_409_CONFLICT, "Só turnos de trabalho podem ser personalizados.")
        return {"codigo": normalize_text(row[0]), "nome": normalize_text(row[1]), "entrada": normalize_text(row[3]), "saida": normalize_text(row[4])}

    def wfm_listar_personalizacoes(self, user, operacao: str, id_turno: int | None = None) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            filtro, params = ("", (operacao,)) if id_turno is None else (" AND p.id_turno = ?", (operacao, int(id_turno)))
            cursor.execute(
                "SELECT p.id_turno, p.id_operador, LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))), p.entrada, p.saida, p.atualizado_por, p.atualizado_em "
                f"FROM dbo.wfm_turno_personalizacoes p JOIN dbo.usuarios u ON u.id_usuario = p.id_operador WHERE p.operacao = ?{filtro} ORDER BY 3",
                params,
            )
            return [{"id_turno": int(r[0]), "id_operador": int(r[1]), "operador": normalize_text(r[2]), "entrada": normalize_text(r[3]),
                     "saida": normalize_text(r[4]), "atualizado_por": normalize_text(r[5]) or None,
                     "atualizado_em": r[6].isoformat() if r[6] else None} for r in cursor.fetchall()]
        finally:
            conn.close()

    def wfm_salvar_personalizacao(self, user, data: dict, *, ip: str = "") -> dict:
        if not wfm_scope.pode_editar_cadastros(user.perfil):
            raise _http(status.HTTP_403_FORBIDDEN, "Sem permissão para personalizar turnos.")
        entrada, saida = normalize_text(data.get("entrada")), normalize_text(data.get("saida"))
        if not (_HHMM.match(entrada) and _HHMM.match(saida)) or entrada == saida:
            raise _http(status.HTTP_400_BAD_REQUEST, "Informe entrada e saída válidas (HH:MM) e diferentes.")
        id_turno, id_operador = int(data["id_turno"]), int(data["id_operador"])
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, data.get("operacao", ""), escrita=True)
            turno = self._wfm_turno_de_trabalho(cursor, operacao, id_turno)
            if entrada == turno["entrada"] and saida == turno["saida"]:
                raise _http(status.HTTP_400_BAD_REQUEST, "O horário é igual ao do turno: não há o que personalizar.")
            if id_operador not in {op["id_usuario"] for op in self._wfm_todos_operadores(cursor, operacao)}:
                raise _http(status.HTTP_404_NOT_FOUND, "Colaborador não encontrado nesta operação.")
            anterior = self._wfm_personalizacoes_mapa(cursor, operacao).get((id_turno, id_operador))
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "UPDATE dbo.wfm_turno_personalizacoes SET entrada = ?, saida = ?, atualizado_por = ?, atualizado_em = GETDATE() WHERE id_turno = ? AND id_operador = ?\n"
                "IF @@ROWCOUNT = 0 INSERT INTO dbo.wfm_turno_personalizacoes (operacao, id_turno, id_operador, entrada, saida, atualizado_por) VALUES (?, ?, ?, ?, ?, ?)",
                (entrada, saida, autor, id_turno, id_operador, operacao, id_turno, id_operador, entrada, saida, autor),
            )
            aplicados = 0
            if data.get("aplicar_lancados"):
                aplicados = self._wfm_aplicar_personalizacao_lancados(cursor, operacao, id_turno, id_operador, (entrada, saida), anterior, autor)
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="personalizar_turno", entidade="turno_personalizado", entidade_id=f"{id_turno}:{id_operador}",
                antes={"horario": list(anterior)} if anterior else None, depois={"horario": [entrada, saida], "dias_ajustados": aplicados}, ip=ip,
            )
            conn.commit()
            return {"success": True, "dias_ajustados": aplicados}
        finally:
            conn.close()

    def wfm_remover_personalizacao(self, user, operacao: str, id_turno: int, id_operador: int, *, remover_lancados: bool = False, ip: str = "") -> dict:
        if not wfm_scope.pode_editar_cadastros(user.perfil):
            raise _http(status.HTTP_403_FORBIDDEN, "Sem permissão para personalizar turnos.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            anterior = self._wfm_personalizacoes_mapa(cursor, operacao).get((int(id_turno), int(id_operador)))
            if not anterior:
                raise _http(status.HTTP_404_NOT_FOUND, "Este colaborador não tem horário personalizado neste turno.")
            autor = normalize_text(user.nome) or user.username
            removidos = 0
            if remover_lancados:
                removidos = self._wfm_aplicar_personalizacao_lancados(cursor, operacao, int(id_turno), int(id_operador), None, anterior, autor)
            cursor.execute("DELETE FROM dbo.wfm_turno_personalizacoes WHERE id_turno = ? AND id_operador = ?", (int(id_turno), int(id_operador)))
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="remover_turno_personalizado", entidade="turno_personalizado", entidade_id=f"{id_turno}:{id_operador}",
                antes={"horario": list(anterior)}, depois={"dias_ajustados": removidos}, ip=ip,
            )
            conn.commit()
            return {"success": True, "dias_ajustados": removidos}
        finally:
            conn.close()

    def _wfm_aplicar_personalizacao_lancados(self, cursor, operacao: str, id_turno: int, id_operador: int,
                                              novo: tuple[str, str] | None, anterior: tuple[str, str] | None, autor: str) -> int:
        """Dias já lançados DE HOJE EM DIANTE que ainda seguem o horário vigente (sem ajuste manual ou igual à personalização
        anterior) passam ao novo horário (ou voltam ao do turno, se `novo` é None). Meses fechados não são tocados."""
        igual_anterior = "(i.entrada_ajuste IS NULL AND i.saida_ajuste IS NULL)"
        params: list = [novo[0] if novo else None, novo[1] if novo else None, autor, operacao, id_turno, id_operador]
        if anterior:
            igual_anterior = "((i.entrada_ajuste IS NULL AND i.saida_ajuste IS NULL) OR (i.entrada_ajuste = ? AND i.saida_ajuste = ?))"
            params += [anterior[0], anterior[1]]
        cursor.execute(
            "UPDATE i SET entrada_ajuste = ?, saida_ajuste = ?, versao_linha = i.versao_linha + 1, atualizado_por = ?, atualizado_em = GETDATE() "
            "FROM dbo.wfm_escala_itens i "
            "WHERE i.operacao = ? AND i.id_turno = ? AND i.id_operador = ? AND i.data >= CAST(GETDATE() AS DATE) AND " + igual_anterior + " "
            "AND NOT EXISTS (SELECT 1 FROM dbo.wfm_escalas e WHERE e.operacao = i.operacao AND e.ano_mes = i.ano_mes AND e.fechada = 1)",
            tuple(params),
        )
        return int(cursor.rowcount or 0)

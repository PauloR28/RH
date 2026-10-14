"""Histórico de Plantões (antiga Auditoria): listagem com cursor, opções de filtro e exportação.

Só leitura sobre `wfm_auditoria` (imutável). Hora início/fim e supervisor são DERIVADOS do plantão ligado ao registro
(`wfm_escala_itens` + `wfm_turnos`); quem solicitou/aceitou/efetivou a troca vem de `wfm_trocas_eventos` (histórico
imutável que o fluxo de trocas já grava). Não há coluna nova nem mudança no fluxo de negócio.
"""

from __future__ import annotations

from typing import Any, Callable, Iterator

from ..services import wfm_historico as hist
from ..services import wfm_scope

# Entidades cujo `entidade_id` é "id_operador:AAAA-MM-DD" (o plantão é o dia daquele operador).
_ENTIDADES_COM_PLANTAO = "('presenca', 'escala_item', 'hora_extra')"

_FROM = f"""
FROM dbo.wfm_auditoria a
CROSS APPLY (SELECT
    CASE WHEN a.entidade IN {_ENTIDADES_COM_PLANTAO} AND CHARINDEX(':', a.entidade_id) > 1
         THEN TRY_CAST(LEFT(a.entidade_id, CHARINDEX(':', a.entidade_id) - 1) AS INT) END AS id_op,
    CASE WHEN a.entidade IN {_ENTIDADES_COM_PLANTAO} AND CHARINDEX(':', a.entidade_id) > 1
         THEN TRY_CAST(SUBSTRING(a.entidade_id, CHARINDEX(':', a.entidade_id) + 1, 10) AS DATE) END AS dia) k
LEFT JOIN dbo.wfm_trocas tr ON a.entidade = 'troca' AND tr.id_troca = TRY_CAST(a.entidade_id AS INT)
LEFT JOIN dbo.wfm_escala_itens it ON it.operacao = a.operacao AND (
        (k.id_op IS NOT NULL AND it.id_operador = k.id_op AND it.data = k.dia)
     OR (tr.id_troca IS NOT NULL AND it.id_operador = tr.id_solicitante AND it.data = tr.data_a))
LEFT JOIN dbo.wfm_turnos t ON t.id_turno = it.id_turno
LEFT JOIN dbo.usuarios s ON s.id_usuario = t.id_supervisor
"""

_COLUNAS = """a.id_auditoria, a.operacao, a.usuario_nome, a.perfil, a.acao, a.entidade, a.entidade_id,
    a.antes_json, a.depois_json, a.justificativa, a.criado_em,
    COALESCE(k.dia, tr.data_a) AS dia_plantao,
    CASE WHEN t.tipo = 'TRABALHO' THEN COALESCE(it.entrada_ajuste, t.entrada) END AS hora_inicio,
    CASE WHEN t.tipo = 'TRABALHO' THEN COALESCE(it.saida_ajuste, t.saida) END AS hora_fim,
    s.nome AS supervisor_nome"""


class WfmHistoricoRepositoryMixin:
    # ------------------------------------------------------------------
    # Escopo e consulta
    # ------------------------------------------------------------------
    def _hist_escopo(self, cursor, user, filtro: hist.FiltroHistorico) -> list[str] | None:
        """Mesmo controle da Auditoria de hoje: operação pedida precisa estar no escopo; sem operação, só as permitidas."""
        if filtro.operacao:
            filtro.operacao = self._wfm_exigir_operacao(cursor, user, filtro.operacao)
            return None
        return wfm_scope.operacoes_permitidas(user.perfil, user.operacoes)

    @staticmethod
    def _hist_dicts(cursor) -> list[dict]:
        nomes = [c[0] for c in cursor.description]
        return [dict(zip(nomes, linha)) for linha in cursor.fetchall()]

    @staticmethod
    def _hist_eventos(cursor, linhas: list[dict]) -> dict[int, list[dict]]:
        ids = sorted({int(l["entidade_id"]) for l in linhas if l.get("entidade") == "troca" and str(l.get("entidade_id") or "").isdigit()})
        if not ids:
            return {}
        cursor.execute(
            f"SELECT id_troca, evento, por_nome, criado_em FROM dbo.wfm_trocas_eventos WHERE id_troca IN ({','.join('?' for _ in ids)}) ORDER BY id_evento",
            ids,
        )
        por_troca: dict[int, list[dict]] = {}
        for id_troca, evento, por_nome, criado_em in cursor.fetchall():
            por_troca.setdefault(int(id_troca), []).append({"evento": evento, "por_nome": por_nome, "criado_em": criado_em})
        return por_troca

    def _hist_itens(self, cursor, linhas: list[dict]) -> list[dict]:
        eventos = self._hist_eventos(cursor, linhas)
        servidor = hist.fuso_do_servidor()
        itens = []
        for linha in linhas:
            id_troca = int(linha["entidade_id"]) if linha.get("entidade") == "troca" and str(linha.get("entidade_id") or "").isdigit() else None
            itens.append(hist.montar_item(linha, eventos.get(id_troca, []) if id_troca else None, servidor))
        return itens

    # ------------------------------------------------------------------
    # Listagem (cursor) e opções de filtro
    # ------------------------------------------------------------------
    def wfm_hist_listar(self, user, filtro: hist.FiltroHistorico, cursor_token: str | None = None, limite: int | None = None) -> dict:
        cursor_pos = hist.decodificar_cursor(cursor_token)
        # primeira página: 8 linhas; "Ver mais": 20 (o cliente pede o tamanho)
        tamanho = max(1, min(int(limite or (hist.TAMANHO_PROXIMAS_PAGINAS if cursor_pos else hist.TAMANHO_PRIMEIRA_PAGINA)), hist.TAMANHO_MAXIMO_PAGINA))
        conn = self._connect()
        try:
            cursor = conn.cursor()
            permitidas = self._hist_escopo(cursor, user, filtro)
            where, params = hist.montar_where(filtro, permitidas=permitidas)
            cursor.execute(f"SELECT COUNT(*) {_FROM} WHERE {where}", params)
            total = int(cursor.fetchone()[0])
            condicoes, parametros = where, list(params)
            if cursor_pos:
                condicoes += f" AND {hist.PREDICADO_CURSOR}"
                parametros += hist.parametros_cursor(cursor_pos)
            cursor.execute(f"SELECT TOP ({tamanho + 1}) {_COLUNAS} {_FROM} WHERE {condicoes} ORDER BY {hist.ORDEM}", parametros)
            linhas = self._hist_dicts(cursor)
            tem_mais = len(linhas) > tamanho
            linhas = linhas[:tamanho]
            itens = self._hist_itens(cursor, linhas)
            proximo = hist.codificar_cursor(linhas[-1]["criado_em"], linhas[-1]["id_auditoria"]) if tem_mais and linhas else None
            return {"itens": itens, "total": total, "tem_mais": tem_mais, "proximo_cursor": proximo}
        finally:
            conn.close()

    def wfm_hist_opcoes(self, user, operacao: str = "") -> dict:
        filtro = hist.FiltroHistorico(operacao=operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            permitidas = self._hist_escopo(cursor, user, filtro)
            where, params = hist.montar_where(filtro, permitidas=permitidas)
            cursor.execute(f"SELECT DISTINCT TOP (300) a.usuario_nome FROM dbo.wfm_auditoria a WHERE {where} AND a.usuario_nome IS NOT NULL ORDER BY a.usuario_nome", params)
            operadores = [r[0] for r in cursor.fetchall()]
            cursor.execute(f"SELECT DISTINCT TOP (300) s.nome {_FROM} WHERE {where} AND s.nome IS NOT NULL ORDER BY s.nome", params)
            supervisores = [r[0] for r in cursor.fetchall()]
            return {"operadores": operadores, "supervisores": supervisores}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Exportação
    # ------------------------------------------------------------------
    def wfm_hist_preparar_exportacao(
        self, user, filtro: hist.FiltroHistorico, formato: str, escopo: str, ids: list[int] | None, *, ip: str = "",
    ) -> dict[str, Any]:
        """Valida, conta, registra a exportação no próprio Histórico e devolve um gerador de linhas (em blocos)."""
        formato, escopo, ids = hist.validar_exportacao(formato, escopo, ids)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            permitidas = self._hist_escopo(cursor, user, filtro)
            where, params = hist.montar_where(filtro, permitidas=permitidas, ids=ids)
            cursor.execute(f"SELECT COUNT(*) {_FROM} WHERE {where}", params)
            total = int(cursor.fetchone()[0])
            hist.validar_limite_linhas(total, formato)
            # a própria exportação vira uma linha do Histórico: o arquivo só leva o que existia ao contar
            cursor.execute("SELECT ISNULL(MAX(id_auditoria), 0) FROM dbo.wfm_auditoria")
            limite_id = int(cursor.fetchone()[0])
            where, params = f"({where}) AND a.id_auditoria <= ?", [*params, limite_id]
            if permitidas:
                operacao_log = filtro.operacao or sorted(permitidas)[0]
            else:
                operacao_log = filtro.operacao or "TODAS"
            periodo = f"{filtro.data_ini.isoformat() if filtro.data_ini else ''}..{filtro.data_fim.isoformat() if filtro.data_fim else ''}"
            self.wfm_audit(
                cursor, user, operacao=operacao_log, acao="exportar_relatorio", entidade="relatorio", entidade_id="historico",
                depois={"formato": formato, "periodo": periodo, "escopo": "selecionados" if ids else "filtro", "linhas": total}, ip=ip,
            )
            conn.commit()
        finally:
            conn.close()

        def linhas() -> Iterator[list[str]]:
            conexao = self._connect()
            conexao_eventos = self._connect()  # leitura dos eventos de troca em outra conexão (sem MARS)
            try:
                cur = conexao.cursor()
                cur.execute(f"SELECT {_COLUNAS} {_FROM} WHERE {where} ORDER BY {hist.ORDEM}", params)
                nomes = [c[0] for c in cur.description]
                while True:
                    bloco = cur.fetchmany(500)
                    if not bloco:
                        break
                    dicts = [dict(zip(nomes, linha)) for linha in bloco]
                    for item in self._hist_itens(conexao_eventos.cursor(), dicts):
                        yield hist.linha_exportacao(item)
            finally:
                conexao.close()
                conexao_eventos.close()

        mime = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "csv": "text/csv; charset=utf-8", "pdf": "application/pdf"}[formato]
        return {"formato": formato, "total": total, "nome": hist.nome_arquivo(formato), "mime": mime, "linhas": linhas}

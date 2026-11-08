from __future__ import annotations

import sys
import unittest
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.repositories.analytics import AnalyticsRepositoryMixin
from rh_api.routers.analytics import get_funnel_dashboard

_PROCESS_COLUMNS = [
    "id_processo",
    "vaga",
    "quantidade_vagas",
    "vagas_preenchidas",
    "data_encerramento",
    "operacao",
    "trilha",
    "usa_nota_corte",
    "nota_corte",
    "status",
    "data_criacao",
    "link_agendamento",
    "link_publico_slug",
    "link_publico_token",
    "link_publico_ativo",
    "link_publico_criado_em",
    "link_publico_desativado_em",
    "descricao_publica",
    "requisitos_publicos",
    "responsabilidades_publicas",
    "observacoes_publicas_vaga",
    "configuracao_prova_json",
    "prova_configurada_em",
    "urgente",
    "urgente_marcado_em",
    "urgente_marcado_por",
    "ia_analise_desabilitada",
]


def process_row(
    id_processo: str,
    *,
    quantidade_vagas: int = 0,
    vagas_preenchidas: int = 0,
    status: str = "Aberto",
    data_criacao: str = "2026-01-01T00:00:00",
) -> tuple:
    """Monta uma linha completa de `processos_seletivos` (26 colunas, mesma
    ordem de `_select_process_query`), preenchendo com defaults neutros os
    campos irrelevantes para os testes de time-to-fill."""
    return (
        id_processo,
        "Vaga de teste",
        quantidade_vagas,
        vagas_preenchidas,
        None,
        "Operação teste",
        "",
        0,
        None,
        status,
        data_criacao,
        "",
        "",
        "",
        0,
        None,
        None,
        "",
        "",
        "",
        "",
        None,
        None,
        0,
        None,
        None,
        0,
    )


class FakeFunnelCursor:
    """Cursor mínimo: só reconhece os SELECTs usados por get_funnel_dashboard
    (candidatos_processos e processos_seletivos). Comandos DDL dos `ensure_*`
    de bootstrap são aceitos e ignorados."""

    _COLUMNS = [
        "id_registro",
        "id_processo",
        "id_processo_ref",
        "status_candidato",
        "etapa_pipeline",
        "origem",
        "data_prova",
        "aprovado_em",
    ]

    def __init__(self, rows: list[tuple], process_rows: list[tuple] | None = None):
        self._rows = rows
        self._process_rows = process_rows or []
        self.description = []
        self._current_rows: list[tuple] = []

    def execute(self, query: str, params=()):
        if "candidatos_processos" in query and "etapa_pipeline" in query:
            self.description = [(column,) for column in self._COLUMNS]
            self._current_rows = self._rows
        elif "processos_seletivos" in query and "quantidade_vagas" in query and "vaga," in query:
            self.description = [(column,) for column in _PROCESS_COLUMNS]
            self._current_rows = self._process_rows
        else:
            self.description = []
            self._current_rows = []

    def fetchall(self):
        return self._current_rows

    def fetchone(self):
        return (0,)

    def columns(self, table: str = "", schema: str | None = None):
        return []


class FakeFunnelConnection:
    def __init__(self, cursor: FakeFunnelCursor):
        self._cursor = cursor
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


class FakeFunnelRepository(AnalyticsRepositoryMixin):
    def __init__(self, cursor: FakeFunnelCursor):
        self._connection = FakeFunnelConnection(cursor)

    def _connect(self):
        return self._connection


# id_registro, id_processo, id_processo_ref, status_candidato, etapa_pipeline, origem, data_prova, aprovado_em
SAMPLE_ROWS = [
    (1, "P1", "P1", "Analise", "Triagem", "Prova", "2026-01-01T09:00:00", None),
    (2, "P1", "P1", "Qualificado", "Prova", "Prova", "2026-01-02T09:00:00", None),
    (3, "P1", "P1", "Agendado", "Entrevista", "Indicação", "2026-01-03T09:00:00", None),
    (4, "P1", "P1", "Aprovado", "Aprovado", "Prova", "2026-01-01T09:00:00", "2026-01-11T09:00:00"),
    (5, "P1", "P1", "Aprovado", "Aprovado", "Indicação", "2026-01-05T09:00:00", "2026-01-10T09:00:00"),
    (6, "P1", "P1", "Eliminado", "Reprovado", "Prova", "2026-01-01T09:00:00", None),
    # Fora do período/processo filtrado nos testes de filtro:
    (7, "P2", "P2", "Aprovado", "Aprovado", "LinkedIn", "2025-01-01T09:00:00", "2025-01-31T09:00:00"),
]


class FunnelDashboardHappyPathTests(unittest.TestCase):
    def test_computes_funnel_time_to_hire_and_origin_breakdown(self):
        cursor = FakeFunnelCursor(SAMPLE_ROWS)
        repository = FakeFunnelRepository(cursor)

        result = repository.get_funnel_dashboard()

        self.assertEqual(result["total_candidatos"], len(SAMPLE_ROWS))
        self.assertEqual(result["total_aprovados_considerados"], 3)

        # Time-to-hire: (10 + 5 + 30) / 3 dias = 15.0
        self.assertEqual(result["time_to_hire_medio_dias"], 15.0)

        etapas_por_nome = {item["etapa"]: item for item in result["funil_etapas"]}
        self.assertEqual(etapas_por_nome["Triagem"]["total"], 1)
        self.assertEqual(etapas_por_nome["Prova"]["total"], 1)
        self.assertEqual(etapas_por_nome["Entrevista"]["total"], 1)
        self.assertEqual(etapas_por_nome["Aprovado"]["total"], 3)
        self.assertEqual(etapas_por_nome["Reprovado"]["total"], 1)
        # 3 aprovados em 7 candidatos totais = 42.9%
        self.assertAlmostEqual(etapas_por_nome["Aprovado"]["percentual_conversao"], round(3 / 7 * 100, 1))

        origem_por_nome = {item["origem"]: item["total"] for item in result["origem_candidatos"]}
        self.assertEqual(origem_por_nome["Prova"], 4)
        self.assertEqual(origem_por_nome["Indicação"], 2)
        self.assertEqual(origem_por_nome["LinkedIn"], 1)

    def test_filters_by_process_id(self):
        cursor = FakeFunnelCursor(SAMPLE_ROWS)
        repository = FakeFunnelRepository(cursor)

        result = repository.get_funnel_dashboard(id_processo="P2")

        self.assertEqual(result["total_candidatos"], 1)
        self.assertEqual(result["total_aprovados_considerados"], 1)
        self.assertEqual(result["time_to_hire_medio_dias"], 30.0)

    def test_filters_by_date_range(self):
        cursor = FakeFunnelCursor(SAMPLE_ROWS)
        repository = FakeFunnelRepository(cursor)

        # Só candidatos com data_prova em 2026 (exclui a linha de P2/2025).
        result = repository.get_funnel_dashboard(start_date="2026-01-01", end_date="2026-01-31")

        self.assertEqual(result["total_candidatos"], 6)

    def test_returns_none_time_to_hire_when_no_approved_candidates(self):
        cursor = FakeFunnelCursor(
            [
                (1, "P3", "P3", "Analise", "Triagem", "Prova", "2026-01-01T09:00:00", None),
            ]
        )
        repository = FakeFunnelRepository(cursor)

        result = repository.get_funnel_dashboard(id_processo="P3")

        self.assertIsNone(result["time_to_hire_medio_dias"])
        self.assertEqual(result["total_aprovados_considerados"], 0)

    def test_computes_time_to_fill_for_fully_filled_process(self):
        cursor = FakeFunnelCursor(
            SAMPLE_ROWS,
            process_rows=[
                process_row(
                    "P1",
                    quantidade_vagas=2,
                    vagas_preenchidas=2,
                    status="Encerrado",
                    data_criacao="2026-01-01T00:00:00",
                ),
            ],
        )
        repository = FakeFunnelRepository(cursor)

        result = repository.get_funnel_dashboard(id_processo="P1")

        # Preenchimento = aprovado_em mais recente entre os aprovados de P1
        # (2026-01-11T09:00) - abertura (data_criacao, 2026-01-01T00:00) = 10.375 dias.
        self.assertEqual(result["time_to_fill_medio_dias"], 10.4)
        self.assertEqual(result["total_vagas_preenchidas_consideradas"], 1)

    def test_excludes_processes_not_fully_filled_from_time_to_fill(self):
        cursor = FakeFunnelCursor(
            SAMPLE_ROWS,
            process_rows=[
                process_row(
                    "P1",
                    quantidade_vagas=5,
                    vagas_preenchidas=2,
                    status="Aberto",
                    data_criacao="2026-01-01T00:00:00",
                ),
            ],
        )
        repository = FakeFunnelRepository(cursor)

        result = repository.get_funnel_dashboard(id_processo="P1")

        self.assertIsNone(result["time_to_fill_medio_dias"])
        self.assertEqual(result["total_vagas_preenchidas_consideradas"], 0)

    def test_returns_none_time_to_fill_when_no_process_row_matches(self):
        cursor = FakeFunnelCursor(SAMPLE_ROWS, process_rows=[])
        repository = FakeFunnelRepository(cursor)

        result = repository.get_funnel_dashboard(id_processo="P1")

        self.assertIsNone(result["time_to_fill_medio_dias"])
        self.assertEqual(result["total_vagas_preenchidas_consideradas"], 0)

    def test_router_delegates_to_repository(self):
        cursor = FakeFunnelCursor(SAMPLE_ROWS)
        repository = FakeFunnelRepository(cursor)

        result = get_funnel_dashboard(
            start_date="",
            end_date="",
            id_processo="P1",
            repository=repository,
        )
        self.assertEqual(result["total_candidatos"], 6)


if __name__ == "__main__":
    unittest.main()

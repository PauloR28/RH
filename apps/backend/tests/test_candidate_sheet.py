from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.repositories.candidate_sheet import CandidateSheetRepositoryMixin, _format_score
from rh_api.routers.processes import get_candidate_sheet, update_candidate_sheet
from rh_api.schemas.processes import CandidateSheetUpdateRequest


class FakeCandidateSheetRepository:
    def __init__(self):
        self.updated_payload = None
        self.updated_id = ""

    def get_candidate_sheet(self, id_teste: str) -> dict:
        return {
            "success": True,
            "candidato": {"id_teste": id_teste, "nome_candidato": "Ana Souza"},
            "processos": [],
            "resultados": [],
            "avaliacao_rh": {
                "observacoes": "",
                "classificacao": "",
                "classificacao_label": "Não definido",
                "justificativa": "",
            },
        }

    def update_candidate_sheet(self, id_teste: str, data: dict) -> dict:
        self.updated_id = id_teste
        self.updated_payload = data
        response = self.get_candidate_sheet(id_teste)
        response["avaliacao_rh"] = {
            "observacoes": data.get("observacao_rh", ""),
            "classificacao": data.get("classificacao", ""),
            "classificacao_label": data.get("classificacao") or "Não definido",
            "justificativa": data.get("justificativa", ""),
        }
        return response


def test_get_candidate_sheet_returns_repository_payload():
    repository = FakeCandidateSheetRepository()

    payload = get_candidate_sheet("TESTE-001", repository=repository)

    assert payload["success"] is True
    assert payload["candidato"]["id_teste"] == "TESTE-001"
    assert payload["avaliacao_rh"]["classificacao_label"] == "Não definido"


def test_update_candidate_sheet_sends_only_provided_fields():
    repository = FakeCandidateSheetRepository()
    request = CandidateSheetUpdateRequest(
        observacao_rh="Boa comunicação.",
        classificacao="Indicado",
    )

    payload = update_candidate_sheet("TESTE-001", request, repository=repository)

    assert repository.updated_id == "TESTE-001"
    assert repository.updated_payload == {
        "observacao_rh": "Boa comunicação.",
        "classificacao": "Indicado",
    }
    assert payload["avaliacao_rh"]["classificacao"] == "Indicado"


def test_candidate_sheet_rejects_invalid_recommendation():
    with pytest.raises(ValidationError):
        CandidateSheetUpdateRequest(classificacao="Talvez indicar")


def test_candidate_sheet_preserves_zero_cv_score():
    assert _format_score(0) == "0"


def test_serialize_candidate_sheet_timeline_orders_events_newest_first():
    mixin = CandidateSheetRepositoryMixin()

    timeline = mixin._serialize_candidate_sheet_timeline(
        movement_rows=[
            {
                "tipo_movimentacao": "Eliminação reconsiderada",
                "status_anterior": "Eliminado",
                "status_novo": "Em Análise",
                "observacao": "Revisão solicitada pelo gestor.",
                "usuario_responsavel": "rh.usuario",
                "processo_destino": "",
                "criado_em": "2026-08-20T10:00:00",
            },
        ],
        history_rows=[
            {
                "trilha": "Atendimento",
                "nivel": "",
                "pontuacao_final": "8,0",
                "vaga": "Analista",
                "data_iso": "2026-08-10T09:00:00",
                "data_exibicao": "",
            },
        ],
        interview_rows=[
            {
                "status_entrevista": "Realizada",
                "vaga": "Analista",
                "data_entrevista": "2026-08-15T14:00:00",
            },
        ],
        cv_pre_analysis={
            "classificacao": "Indicado",
            "criado_em": "2026-08-05T08:00:00",
        },
    )

    assert [evento["tipo"] for evento in timeline] == [
        "movimentacao",
        "entrevista",
        "prova",
        "curriculo",
    ]
    assert timeline[0]["titulo"] == "Eliminação reconsiderada"
    assert "Eliminado → Em Análise" in timeline[0]["descricao"]
    assert "Revisão solicitada pelo gestor." in timeline[0]["descricao"]
    assert "Responsável: rh.usuario" in timeline[0]["descricao"]


def test_serialize_candidate_sheet_timeline_handles_empty_inputs():
    mixin = CandidateSheetRepositoryMixin()

    timeline = mixin._serialize_candidate_sheet_timeline(
        movement_rows=[],
        history_rows=[],
        interview_rows=[],
        cv_pre_analysis={},
    )

    assert timeline == []

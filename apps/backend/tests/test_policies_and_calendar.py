from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.auth import AuthenticatedUser
from rh_api.repositories.celebratory_dates import _days_until_next_occurrence
from rh_api.routers import calendar as calendar_router
from rh_api.routers import policies as policies_router
from rh_api.schemas.calendar import CelebratoryDateCreateRequest
from rh_api.schemas.policies import PolicyCreateRequest
from rh_api.schemas.processes import ProcessCandidateCreateRequest


class FakePolicyRepository:
    def __init__(self):
        self.created = None
        self.confirmed = []

    def create_policy(self, data: dict, *, actor: str = "") -> dict:
        self.created = {**data, "criado_por": actor}
        return {"id_politica": 1, **self.created}

    def get_pending_policy_for_user(self, *, id_usuario, usuario_login):
        if usuario_login == "ja-confirmou":
            return None
        return {"id_politica": 1, "titulo": "Política de dados", "corpo_texto": "Texto"}

    def confirm_policy_reading(self, id_politica, *, id_usuario, usuario_login, usuario_nome=""):
        self.confirmed.append((id_politica, usuario_login))
        return {"success": True, "ja_confirmado": False}


class FakeCelebratoryDateRepository:
    def __init__(self):
        self.created = None

    def create_celebratory_date(self, data: dict, *, actor: str = "") -> dict:
        self.created = {**data, "criado_por": actor}
        return {"id_data": 1, **self.created}

    def list_celebratory_dates(self):
        return [
            {"id_data": 1, "titulo": "Aniversário da empresa", "dia": 1, "mes": 1},
            {"id_data": 2, "titulo": "Dia do Trabalho", "dia": 1, "mes": 5},
        ]


def _user(username="rh.usuario"):
    return AuthenticatedUser(username=username, id_usuario=42, nome="RH Usuário")


def test_policy_schema_requires_title_and_body():
    with pytest.raises(ValidationError):
        PolicyCreateRequest(titulo="", corpo_texto="Texto")


def test_create_policy_route_persists_and_audits():
    repository = FakePolicyRepository()
    payload = PolicyCreateRequest(titulo="Política de dados", corpo_texto="Conteúdo da política.")

    result = policies_router.create_policy(payload, user=_user(), repository=repository)

    assert result["id_politica"] == 1
    assert repository.created["titulo"] == "Política de dados"
    assert repository.created["criado_por"] == "rh.usuario"


def test_pending_policy_route_returns_empty_when_already_confirmed():
    repository = FakePolicyRepository()

    pendente = policies_router.get_pending_policy(user=_user("ja-confirmou"), repository=repository)
    assert pendente == {}

    pendente_novo = policies_router.get_pending_policy(user=_user("novo.usuario"), repository=repository)
    assert pendente_novo["id_politica"] == 1


def test_confirm_policy_reading_route_records_confirmation():
    repository = FakePolicyRepository()

    result = policies_router.confirm_policy_reading(1, user=_user(), repository=repository)

    assert result["success"] is True
    assert repository.confirmed == [(1, "rh.usuario")]


def test_celebratory_date_schema_validates_day_and_month():
    with pytest.raises(ValidationError):
        CelebratoryDateCreateRequest(titulo="Data", dia=32, mes=1)
    with pytest.raises(ValidationError):
        CelebratoryDateCreateRequest(titulo="Data", dia=1, mes=13)


def test_create_celebratory_date_route_persists_and_audits():
    repository = FakeCelebratoryDateRepository()
    payload = CelebratoryDateCreateRequest(titulo="Dia do Trabalho", dia=1, mes=5)

    result = calendar_router.create_celebratory_date(payload, user=_user(), repository=repository)

    assert result["id_data"] == 1
    assert repository.created["titulo"] == "Dia do Trabalho"


def test_list_celebratory_dates_route_returns_repository_payload():
    repository = FakeCelebratoryDateRepository()

    result = calendar_router.list_celebratory_dates(repository=repository)

    assert len(result) == 2
    assert result[0]["titulo"] == "Aniversário da empresa"


def test_days_until_next_occurrence_wraps_to_next_year():
    hoje = date(2026, 8, 23)
    dias = _days_until_next_occurrence(1, 1, today=hoje)
    assert dias == (date(2027, 1, 1) - hoje).days


def test_days_until_next_occurrence_same_year():
    hoje = date(2026, 1, 1)
    dias = _days_until_next_occurrence(1, 5, today=hoje)
    assert dias == (date(2026, 5, 1) - hoje).days


def test_process_candidate_referral_origin_requires_indicated_by():
    with pytest.raises(ValidationError):
        ProcessCandidateCreateRequest(
            nome_candidato="Fulano",
            id_teste="TESTE-01",
            origem="Indicação",
        )


def test_process_candidate_referral_origin_accepts_indicated_by():
    payload = ProcessCandidateCreateRequest(
        nome_candidato="Fulano",
        id_teste="TESTE-01",
        origem="Indicação",
        indicado_por="Maria da Silva",
    )
    assert payload.indicado_por == "Maria da Silva"

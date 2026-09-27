from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError


API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.auth import AuthenticatedUser
from rh_api.routers import document_templates as document_templates_router
from rh_api.routers import onboarding as onboarding_router
from rh_api.schemas.document_templates import (
    DocumentTemplateCreateRequest,
    GenerateDocumentRequest,
)
from rh_api.schemas.onboarding import (
    OnboardingAttendanceRequest,
    OnboardingStartRequest,
    OnboardingTrilhaCreateRequest,
    ProcessTrainingReleaseRequest,
)
from rh_api.services.document_template_engine import (
    MISSING_VALUE_PLACEHOLDER,
    extract_template_variables,
    render_template_text,
)


def _user(username="rh.usuario"):
    return AuthenticatedUser(username=username, id_usuario=42, nome="RH Usuário")


# ---------------------------------------------------------------------------
# Motor de substituição de variáveis
# ---------------------------------------------------------------------------


def test_render_template_text_substitutes_known_variables():
    texto = "Olá {{nome_candidato}}, você foi selecionado para {{vaga}}."
    resultado = render_template_text(texto, {"nome_candidato": "Fulano", "vaga": "Analista"})
    assert resultado == "Olá Fulano, você foi selecionado para Analista."


def test_render_template_text_missing_variable_uses_placeholder_and_never_raises():
    texto = "Salário combinado: {{salario}}. Admissão em {{data_admissao}}."
    resultado = render_template_text(texto, {"vaga": "Analista"})
    assert MISSING_VALUE_PLACEHOLDER in resultado
    assert resultado.count(MISSING_VALUE_PLACEHOLDER) == 2


def test_render_template_text_handles_empty_string_value_as_missing():
    resultado = render_template_text("{{nome_candidato}}", {"nome_candidato": "   "})
    assert resultado == MISSING_VALUE_PLACEHOLDER


def test_render_template_text_with_no_placeholders_returns_text_unchanged():
    assert render_template_text("Texto simples sem variáveis.", {}) == "Texto simples sem variáveis."


def test_extract_template_variables_returns_unique_ordered_list():
    texto = "{{nome_candidato}} - {{vaga}} - {{nome_candidato}}"
    assert extract_template_variables(texto) == ["nome_candidato", "vaga"]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


def test_document_template_schema_requires_title_and_body():
    with pytest.raises(ValidationError):
        DocumentTemplateCreateRequest(titulo="", corpo_texto="Texto")
    with pytest.raises(ValidationError):
        DocumentTemplateCreateRequest(titulo="Título", corpo_texto="")


def test_onboarding_trilha_schema_requires_item_title():
    with pytest.raises(ValidationError):
        OnboardingTrilhaCreateRequest(nome="Trilha", itens=[{"titulo": ""}])


def test_onboarding_trilha_schema_accepts_valid_items():
    payload = OnboardingTrilhaCreateRequest(
        nome="Trilha",
        itens=[{"titulo": "Item 1", "ordem": 1, "obrigatorio": True}],
    )
    assert payload.itens[0].titulo == "Item 1"


def test_generate_document_request_requires_valid_ids():
    with pytest.raises(ValidationError):
        GenerateDocumentRequest(template_id=0, id_registro=1)


def test_onboarding_start_request_requires_valid_ids():
    with pytest.raises(ValidationError):
        OnboardingStartRequest(id_registro=0, trilha_id=1)


def test_process_training_release_request_requires_at_least_one_candidate():
    with pytest.raises(ValidationError):
        ProcessTrainingReleaseRequest(candidatos=[])


def test_process_training_release_request_drops_falsy_ids():
    payload = ProcessTrainingReleaseRequest(candidatos=[1, 0, 2])
    assert payload.candidatos == [1, 2]


def test_process_training_release_request_enforces_limit():
    with pytest.raises(ValidationError):
        ProcessTrainingReleaseRequest(candidatos=list(range(1, 202)))


def test_onboarding_attendance_request_accepts_multiple_entries():
    payload = OnboardingAttendanceRequest(
        presencas=[{"id_onboarding": 1, "presente": True}, {"id_onboarding": 2, "presente": False}],
    )
    assert payload.presencas[0].presente is True
    assert payload.presencas[1].presente is False


# ---------------------------------------------------------------------------
# Router (CRUD caminho feliz) usando repositórios fake
# ---------------------------------------------------------------------------


class FakeOnboardingRepository:
    def __init__(self):
        self.trilhas = {}
        self.progress = {}

    def create_onboarding_trilha(self, data: dict, *, actor: str = "") -> dict:
        id_trilha = len(self.trilhas) + 1
        trilha = {"id_trilha": id_trilha, **data, "criado_por": actor}
        self.trilhas[id_trilha] = trilha
        return trilha

    def update_onboarding_trilha(self, id_trilha: int, data: dict, *, actor: str = "") -> dict:
        trilha = {"id_trilha": id_trilha, **data}
        self.trilhas[id_trilha] = trilha
        return trilha

    def list_onboarding_trilhas(self):
        return list(self.trilhas.values())

    def start_onboarding(
        self,
        id_registro: int,
        trilha_id: int,
        *,
        actor: str = "",
        data_prevista=None,
        local: str = "",
        ministrante: str = "",
        ministrante_email: str = "",
        duracao_minutos: int = 60,
        enviar_lembrete_calendario: bool = False,
    ) -> dict:
        progresso = {
            "iniciado": True,
            "candidato": {"id_registro": id_registro},
            "onboarding": {"id_onboarding": 1, "trilha_id": trilha_id},
            "itens": [{"id_onboarding_item": 1, "titulo": "Item 1", "concluido": False}],
            "total_itens": 1,
            "itens_concluidos": 0,
            "percentual_concluido": 0,
        }
        self.progress[id_registro] = progresso
        return progresso

    def get_onboarding_progress(self, id_registro: int) -> dict:
        return self.progress.get(id_registro, {"iniciado": False})

    def set_onboarding_item_status(self, id_onboarding_item: int, concluido: bool, *, actor: str = "") -> dict:
        for progresso in self.progress.values():
            for item in progresso.get("itens", []):
                if item["id_onboarding_item"] == id_onboarding_item:
                    item["concluido"] = concluido
                    progresso["itens_concluidos"] = sum(1 for i in progresso["itens"] if i["concluido"])
                    progresso["percentual_concluido"] = round(
                        progresso["itens_concluidos"] / progresso["total_itens"] * 100
                    )
                    return progresso
        return {"iniciado": False}


class FakeDocumentTemplateRepository:
    def __init__(self):
        self.templates = {}

    def create_document_template(self, data: dict, *, actor: str = "") -> dict:
        id_template = len(self.templates) + 1
        template = {"id_template": id_template, **data}
        self.templates[id_template] = template
        return template

    def generate_document(self, template_id: int, id_registro: int, *, variaveis_extra=None) -> dict:
        template = self.templates[template_id]
        variaveis = {"nome_candidato": "Fulano de Tal", **(variaveis_extra or {})}
        texto_gerado = render_template_text(template["corpo_texto"], variaveis)
        return {
            "template_id": template_id,
            "id_registro": id_registro,
            "variaveis_utilizadas": variaveis,
            "texto_gerado": texto_gerado,
        }


def test_create_onboarding_trilha_route_persists_and_audits():
    repository = FakeOnboardingRepository()
    payload = OnboardingTrilhaCreateRequest(
        nome="Trilha padrão",
        itens=[{"titulo": "Documentação", "ordem": 1, "obrigatorio": True}],
    )

    result = onboarding_router.create_onboarding_trilha(payload, user=_user(), repository=repository)

    assert result["id_trilha"] == 1
    assert result["nome"] == "Trilha padrão"


def test_start_onboarding_route_creates_progress_snapshot():
    repository = FakeOnboardingRepository()
    payload = OnboardingStartRequest(id_registro=10, trilha_id=1)

    result = onboarding_router.start_onboarding(payload, user=_user(), repository=repository)

    assert result["iniciado"] is True
    assert result["total_itens"] == 1
    assert result["itens_concluidos"] == 0


def test_set_onboarding_item_status_route_marks_item_completed():
    repository = FakeOnboardingRepository()
    repository.start_onboarding(10, 1, actor="rh.usuario")

    from rh_api.schemas.onboarding import OnboardingItemToggleRequest

    resultado = onboarding_router.set_onboarding_item_status(
        1,
        OnboardingItemToggleRequest(concluido=True),
        user=_user(),
        repository=repository,
    )

    assert resultado["itens_concluidos"] == 1
    assert resultado["percentual_concluido"] == 100


def test_get_onboarding_progress_route_returns_repository_payload():
    repository = FakeOnboardingRepository()
    repository.start_onboarding(10, 1)

    resultado = onboarding_router.get_onboarding_progress(10, repository=repository)

    assert resultado["iniciado"] is True


def test_create_document_template_route_persists_and_audits():
    repository = FakeDocumentTemplateRepository()
    payload = DocumentTemplateCreateRequest(
        titulo="Carta de admissão",
        corpo_texto="Prezado {{nome_candidato}}, bem-vindo à {{nome_empresa}}.",
    )

    result = document_templates_router.create_document_template(payload, user=_user(), repository=repository)

    assert result["id_template"] == 1
    assert result["titulo"] == "Carta de admissão"


def test_generate_document_route_renders_text_with_missing_placeholder_kept_safe():
    repository = FakeDocumentTemplateRepository()
    repository.create_document_template(
        {
            "titulo": "Carta de admissão",
            "corpo_texto": "Prezado {{nome_candidato}}, salário {{salario}}.",
            "ativo": True,
        }
    )
    payload = GenerateDocumentRequest(template_id=1, id_registro=10, variaveis_extra={})

    result = document_templates_router.generate_document(payload, user=_user(), repository=repository)

    assert "Fulano de Tal" in result["texto_gerado"]
    assert MISSING_VALUE_PLACEHOLDER in result["texto_gerado"]


def test_generate_document_route_allows_manual_variable_override():
    repository = FakeDocumentTemplateRepository()
    repository.create_document_template(
        {
            "titulo": "Carta de admissão",
            "corpo_texto": "Salário: {{salario}}.",
            "ativo": True,
        }
    )
    payload = GenerateDocumentRequest(template_id=1, id_registro=10, variaveis_extra={"salario": "R$ 3.000,00"})

    result = document_templates_router.generate_document(payload, user=_user(), repository=repository)

    assert "R$ 3.000,00" in result["texto_gerado"]
    assert MISSING_VALUE_PLACEHOLDER not in result["texto_gerado"]

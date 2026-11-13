"""Testes das regras críticas da evolução da Central de Treinamentos
(Prompt.txt, rodada 06/set/2026 — ver docs/central-treinamentos/01-plano-tecnico.md §8):

1) validação do schema JSON de módulo;
2) transição de estados de chamada pendente (3/5 dias);
3) permissão de criação de treinamento;
4) fluxo de aceite de termo LGPD para liberar download de anexo.

Mesmo espírito de `test_onboarding_and_document_templates.py`: testes puros,
sem tocar banco de dados de verdade (não há fixture de banco neste projeto)."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.rbac import ROLE_ADMIN, ROLE_MANAGER, ROLE_RH, ROLE_SUPERVISOR, get_role_permissions
from rh_api.repositories.onboarding import compute_training_call_escalation
from rh_api.schemas.onboarding import (
    DEFAULT_TEXTO_ENCERRAMENTO,
    AnexoDownloadToggleRequest,
    ModuloImportSchema,
    OcorrenciaTreinamentoInput,
    OnboardingTrilhaCreateRequest,
    SaibaMaisItemInput,
    TreinamentoWizardCreateRequest,
)

# ---------------------------------------------------------------------------
# 1) Validação do schema JSON de módulo
# ---------------------------------------------------------------------------


def test_modulo_import_schema_accepts_valid_module():
    modulo = ModuloImportSchema(
        titulo="Introdução ao Sistema X",
        subtitulo="Visão geral",
        texto_principal="Conteúdo do módulo.",
        tipo_conteudo="texto",
        dica_texto="Lembre-se de salvar seu progresso.",
        saiba_mais=[{"tipo": "dica", "texto": "Consulte a política Y."}],
    )
    assert modulo.titulo == "Introdução ao Sistema X"
    assert modulo.saiba_mais[0].tipo == "dica"


def test_modulo_import_schema_rejects_missing_titulo():
    with pytest.raises(ValidationError) as excinfo:
        ModuloImportSchema(titulo="   ")
    erros = excinfo.value.errors()
    assert any(erro["loc"] == ("titulo",) for erro in erros)


def test_modulo_import_schema_rejects_invalid_saiba_mais_tipo():
    with pytest.raises(ValidationError) as excinfo:
        ModuloImportSchema(titulo="Módulo 1", saiba_mais=[{"tipo": "invalido", "texto": "x"}])
    erros = excinfo.value.errors()
    assert any("saiba_mais" in erro["loc"] for erro in erros)


def test_saiba_mais_item_defaults_to_dica():
    item = SaibaMaisItemInput(texto="Uma dica")
    assert item.tipo == "dica"


# ---------------------------------------------------------------------------
# 2) Transição de estados de chamada pendente (3/5 dias)
# ---------------------------------------------------------------------------


def _atribuicao(id_onboarding, *, status, dias_atras, notificado=False, presenca=None):
    agora = datetime(2026, 9, 6, 12, 0, 0)
    return {
        "id_onboarding": id_onboarding,
        "status": status,
        "presenca": presenca,
        "data_prevista": agora - timedelta(days=dias_atras),
        "notificado_pendente_em": datetime(2026, 9, 1) if notificado else None,
        "trilha_nome": "Treinamento X",
        "nome_candidato": "Fulano",
    }, agora


def test_em_andamento_com_data_passada_vira_pendente_chamada():
    linha, agora = _atribuicao(1, status="em_andamento", dias_atras=1)
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado["promover_pendente"] == [1]
    assert resultado["notificar_3_dias"] == []
    assert resultado["encerrar_5_dias"] == []


def test_em_andamento_com_data_futura_nao_e_afetado():
    linha, agora = _atribuicao(2, status="em_andamento", dias_atras=-1)
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado["promover_pendente"] == []
    assert resultado["notificar_3_dias"] == []
    assert resultado["encerrar_5_dias"] == []


def test_pendente_chamada_com_3_dias_e_notificado_uma_vez():
    linha, agora = _atribuicao(3, status="pendente_chamada", dias_atras=4)
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado["promover_pendente"] == []
    assert [item["id_onboarding"] for item in resultado["notificar_3_dias"]] == [3]
    assert resultado["encerrar_5_dias"] == []


def test_pendente_chamada_ja_notificado_nao_notifica_de_novo():
    linha, agora = _atribuicao(4, status="pendente_chamada", dias_atras=4, notificado=True)
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado["notificar_3_dias"] == []


def test_pendente_chamada_com_5_dias_encerra_sem_chamada():
    linha, agora = _atribuicao(5, status="pendente_chamada", dias_atras=6)
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert [item["id_onboarding"] for item in resultado["encerrar_5_dias"]] == [5]
    # Aos 5+ dias não notifica mais como "3 dias" (a notificação de
    # encerramento é a que importa nesse ponto).
    assert resultado["notificar_3_dias"] == []


def test_encerra_diretamente_de_em_andamento_se_job_ficou_muito_tempo_parado():
    """Se o job ficou parado e uma linha "em_andamento" já passou de 5 dias,
    ela deve ser promovida a pendente E encerrada no mesmo ciclo (nunca fica
    presa em 'em_andamento' para sempre)."""
    linha, agora = _atribuicao(6, status="em_andamento", dias_atras=6)
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado["promover_pendente"] == [6]
    assert [item["id_onboarding"] for item in resultado["encerrar_5_dias"]] == [6]


def test_com_presenca_registrada_nao_e_afetado():
    linha, agora = _atribuicao(7, status="pendente_chamada", dias_atras=10, presenca="presente")
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado["promover_pendente"] == []
    assert resultado["notificar_3_dias"] == []
    assert resultado["encerrar_5_dias"] == []


def test_sem_data_prevista_nao_e_afetado():
    linha, agora = _atribuicao(8, status="em_andamento", dias_atras=10)
    linha["data_prevista"] = None
    resultado = compute_training_call_escalation([linha], agora=agora)
    assert resultado == {"promover_pendente": [], "notificar_3_dias": [], "encerrar_5_dias": []}


# ---------------------------------------------------------------------------
# 3) Permissão de criação de treinamento
# ---------------------------------------------------------------------------


def test_gestor_ganha_permissao_de_criar_e_gerenciar_treinamento():
    permissoes = get_role_permissions(ROLE_MANAGER)
    assert "onboarding.criar" in permissoes
    assert "onboarding.gerenciar" in permissoes
    assert "onboarding.visualizar" in permissoes


def test_supervisor_nao_ganha_permissao_de_criar_treinamento_por_padrao():
    """Prompt §3.7: "Criar Treinamento" é visível só para Gestor e ADM por
    padrão — outros papéis só ganham se o ADM conceder explicitamente via
    Configurações → Segurança (fora do escopo deste teste, que cobre o
    default)."""
    permissoes = get_role_permissions(ROLE_SUPERVISOR)
    assert "onboarding.criar" not in permissoes
    assert "onboarding.visualizar" in permissoes  # segue podendo ver, só não criar


def test_rh_ganha_permissao_de_criar_e_gerenciar_treinamento():
    permissoes = get_role_permissions(ROLE_RH)
    assert "onboarding.criar" in permissoes
    assert "onboarding.gerenciar" in permissoes


def test_admin_tem_todas_as_permissoes_de_treinamento():
    permissoes = get_role_permissions(ROLE_ADMIN)
    assert {"onboarding.criar", "onboarding.gerenciar", "onboarding.configurar_acesso"} <= permissoes


# ---------------------------------------------------------------------------
# 4) Fluxo de aceite de termo LGPD (liberar download de anexo)
# ---------------------------------------------------------------------------


def test_toggle_download_sem_aceite_do_termo_e_rejeitado():
    with pytest.raises(ValidationError):
        AnexoDownloadToggleRequest(permite_download=True, termo_aceito=False)


def test_toggle_download_com_aceite_do_termo_e_aceito():
    payload = AnexoDownloadToggleRequest(permite_download=True, termo_aceito=True)
    assert payload.permite_download is True


def test_toggle_download_desligar_nao_exige_aceite():
    payload = AnexoDownloadToggleRequest(permite_download=False, termo_aceito=False)
    assert payload.permite_download is False


# ---------------------------------------------------------------------------
# Extras: wizard de criação de treinamento (ocorrências e texto de encerramento)
# ---------------------------------------------------------------------------


def test_texto_encerramento_vazio_usa_padrao():
    trilha = OnboardingTrilhaCreateRequest(nome="Treinamento X", texto_encerramento="")
    assert trilha.texto_encerramento == DEFAULT_TEXTO_ENCERRAMENTO


def test_texto_encerramento_customizado_e_preservado():
    trilha = OnboardingTrilhaCreateRequest(nome="Treinamento X", texto_encerramento="Obrigado a todos!")
    assert trilha.texto_encerramento == "Obrigado a todos!"


def test_ocorrencia_exige_data_ou_sem_horario_definido():
    with pytest.raises(ValidationError):
        OcorrenciaTreinamentoInput(data_prevista=None, sem_horario_definido=False)
    # Não levanta quando tem data OU quando marca "sem horário definido":
    OcorrenciaTreinamentoInput(data_prevista=datetime(2026, 10, 1, 9, 0))
    OcorrenciaTreinamentoInput(sem_horario_definido=True)


def test_wizard_exige_ao_menos_uma_ocorrencia():
    with pytest.raises(ValidationError):
        TreinamentoWizardCreateRequest(nome="Treinamento X", ocorrencias=[])

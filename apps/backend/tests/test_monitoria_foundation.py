"""Vertente Monitoria — Fase C1 (fundação): perfis/RBAC, escopo por operação,
hierarquia de usuários, schema versionado. Testes puros (sem banco)."""

from __future__ import annotations

import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.rbac import (
    ROLE_ADMIN,
    ROLE_CONTROL_DESK,
    ROLE_EMPLOYEE,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_QUALIDADE,
    ROLE_RH,
    ROLE_SUPERVISOR,
    ROLE_DEFINITIONS,
    ROLE_PERMISSIONS,
    PERMISSION_DEFINITIONS,
    get_role_definition,
    normalize_role_id,
)
from rh_api.repositories.monitoria_schema import TABELAS_IMUTAVEIS, render_migration_sql, schema_statements
from rh_api.services.monitoria_scope import (
    pode_gerenciar_perfil,
    pode_ver_detalhe_monitoria,
    pode_ver_operacao,
    validar_vinculos,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# Perfis e permissões
# ---------------------------------------------------------------------------
def test_novos_perfis_existem_e_nomes_exibidos():
    assert get_role_definition(ROLE_QUALIDADE).name == "Qualidade"
    assert get_role_definition(ROLE_CONTROL_DESK).name == "Control Desk"
    assert get_role_definition(ROLE_RH).name == "Analista"
    assert normalize_role_id("Analista") == ROLE_RH
    assert normalize_role_id("Control Desk") == ROLE_CONTROL_DESK
    assert normalize_role_id("Analista de Qualidade") == ROLE_QUALIDADE


def test_perfis_antigos_continuam_existindo_mas_ocultos():
    assert ROLE_DEFINITIONS[ROLE_EMPLOYEE].hidden is True
    assert ROLE_DEFINITIONS["candidato"].hidden is True
    visiveis = {r.id for r in ROLE_DEFINITIONS.values() if not r.hidden}
    assert visiveis == {
        "administrador", "gestor", "rh", "dp", "estagiario", "supervisor", "operador", "qualidade", "control_desk",
    }


def test_admin_tem_todas_as_permissoes_novas():
    assert set(PERMISSION_DEFINITIONS) <= ROLE_PERMISSIONS[ROLE_ADMIN]
    assert "monitoria.configurar" in ROLE_PERMISSIONS[ROLE_ADMIN]
    assert "sessao.monitoria.acessar" in ROLE_PERMISSIONS[ROLE_ADMIN]


def test_matriz_base_de_permissoes_por_perfil():
    operador = ROLE_PERMISSIONS[ROLE_OPERATOR]
    assert {"monitoria.contestar", "monitoria.visualizar"} <= operador
    assert not {"monitoria.criar", "monitoria.reanalisar", "monitoria.logs", "monitoria.exportar"} & operador

    supervisor = ROLE_PERMISSIONS[ROLE_SUPERVISOR]
    assert {"monitoria.reanalisar", "monitoria.feedback_aplicar", "monitoria.logs"} <= supervisor

    qualidade = ROLE_PERMISSIONS[ROLE_QUALIDADE]
    assert "monitoria.feedback_aplicar" in qualidade
    # "Conforme permissão" fica DESLIGADO por padrão.
    assert not {"monitoria.reanalisar", "monitoria.logs", "monitoria.matriz"} & qualidade

    control_desk = ROLE_PERMISSIONS[ROLE_CONTROL_DESK]
    assert {"monitoria.dashboard", "monitoria.relatorios", "monitoria.exportar"} <= control_desk
    assert not {"monitoria.criar", "monitoria.feedback_aplicar", "monitoria.reanalisar"} & control_desk

    gestor = ROLE_PERMISSIONS[ROLE_MANAGER]
    assert "monitoria.visualizar" in gestor and "monitoria.criar" not in gestor


def test_sessoes_mestras_nao_concedem_acesso_novo_a_perfis_existentes():
    # Operador nunca ganha sessões de RH só por causa da chave-mestra.
    operador = ROLE_PERMISSIONS[ROLE_OPERATOR]
    assert not {"sessao.curriculos.acessar", "sessao.processos.acessar", "sessao.configuracoes.acessar"} & operador
    # RH (Analista) mantém as sessões que já tinha acesso.
    assert "sessao.processos.acessar" in ROLE_PERMISSIONS[ROLE_RH]


# ---------------------------------------------------------------------------
# Escopo (deny por padrão) e hierarquia
# ---------------------------------------------------------------------------
def test_escopo_global_e_restrito():
    assert pode_ver_operacao(ROLE_ADMIN, [], "CRF")
    assert pode_ver_operacao(ROLE_CONTROL_DESK, [], "DAVITA")
    assert pode_ver_operacao(ROLE_MANAGER, [], "NEWE")
    # Supervisor / Qualidade / Operador sem vínculo => nenhum acesso (deny).
    assert not pode_ver_operacao(ROLE_SUPERVISOR, [], "CRF")
    assert not pode_ver_operacao(ROLE_QUALIDADE, [], "CRF")
    assert pode_ver_operacao(ROLE_SUPERVISOR, ["CRF"], "CRF")
    assert not pode_ver_operacao(ROLE_SUPERVISOR, ["CRF"], "DAVITA")


def test_detalhe_da_monitoria_por_perfil():
    base = dict(operacao="CRF", id_operador=10)
    # Operador: só a própria.
    assert pode_ver_detalhe_monitoria(perfil=ROLE_OPERATOR, id_usuario=10, operacoes_usuario=["CRF"], **base)
    assert not pode_ver_detalhe_monitoria(perfil=ROLE_OPERATOR, id_usuario=11, operacoes_usuario=["CRF"], **base)
    # Supervisor: só operadores supervisionados (mesmo dentro da mesma operação).
    assert pode_ver_detalhe_monitoria(
        perfil=ROLE_SUPERVISOR, id_usuario=5, operacoes_usuario=["CRF"], operadores_supervisionados=[10], **base
    )
    assert not pode_ver_detalhe_monitoria(
        perfil=ROLE_SUPERVISOR, id_usuario=5, operacoes_usuario=["CRF"], operadores_supervisionados=[99], **base
    )
    # Supervisor de OUTRA operação nunca vê, mesmo supervisionando o id.
    assert not pode_ver_detalhe_monitoria(
        perfil=ROLE_SUPERVISOR, id_usuario=5, operacoes_usuario=["DAVITA"], operadores_supervisionados=[10], **base
    )
    # Qualidade: detalhe de toda a operação vinculada; Control Desk/Adm: tudo.
    assert pode_ver_detalhe_monitoria(perfil=ROLE_QUALIDADE, id_usuario=7, operacoes_usuario=["CRF"], **base)
    assert not pode_ver_detalhe_monitoria(perfil=ROLE_QUALIDADE, id_usuario=7, operacoes_usuario=["NEWE"], **base)
    assert pode_ver_detalhe_monitoria(perfil=ROLE_CONTROL_DESK, id_usuario=8, operacoes_usuario=[], **base)


def test_hierarquia_de_quem_altera_quem():
    assert pode_gerenciar_perfil(ROLE_ADMIN, ROLE_SUPERVISOR)
    assert pode_gerenciar_perfil(ROLE_SUPERVISOR, ROLE_QUALIDADE)
    assert pode_gerenciar_perfil(ROLE_SUPERVISOR, ROLE_CONTROL_DESK)
    assert pode_gerenciar_perfil(ROLE_SUPERVISOR, ROLE_OPERATOR)
    assert not pode_gerenciar_perfil(ROLE_SUPERVISOR, ROLE_ADMIN)
    assert not pode_gerenciar_perfil(ROLE_SUPERVISOR, ROLE_SUPERVISOR)
    assert pode_gerenciar_perfil(ROLE_QUALIDADE, ROLE_OPERATOR)
    assert not pode_gerenciar_perfil(ROLE_QUALIDADE, ROLE_QUALIDADE)
    assert not pode_gerenciar_perfil(ROLE_OPERATOR, ROLE_OPERATOR)


def test_validacao_dos_vinculos_por_perfil():
    assert validar_vinculos(ROLE_OPERATOR, ["CRF"], [1, 2]) == []
    assert validar_vinculos(ROLE_OPERATOR, ["CRF", "NEWE"], [1])  # 2 operações
    assert validar_vinculos(ROLE_OPERATOR, ["CRF"], [])  # sem supervisor
    assert validar_vinculos(ROLE_OPERATOR, ["CRF"], [1, 2, 3])  # 3 supervisores
    assert validar_vinculos(ROLE_SUPERVISOR, ["A", "B", "C"], []) == []
    assert validar_vinculos(ROLE_SUPERVISOR, ["A", "B", "C", "D"], [])
    assert validar_vinculos(ROLE_QUALIDADE, ["A", "B"], []) == []
    assert validar_vinculos(ROLE_QUALIDADE, ["A", "B", "C"], [])
    assert validar_vinculos(ROLE_CONTROL_DESK, ["A"], [])  # CD é global
    assert validar_vinculos(ROLE_SUPERVISOR, ["A"], [4])  # só operador tem supervisor


# ---------------------------------------------------------------------------
# Schema versionado: bootstrap runtime e migration coincidem; imutabilidade
# ---------------------------------------------------------------------------
def test_migration_v037_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V037__monitoria.sql"
    assert arquivo.exists(), "gere V037__monitoria.sql a partir de render_migration_sql()"
    assert arquivo.read_text(encoding="utf-8") == render_migration_sql()


def test_toda_tabela_imutavel_recebe_trigger_de_bloqueio():
    ddl = "\n".join(schema_statements())
    for tabela in TABELAS_IMUTAVEIS:
        assert f"CREATE TABLE dbo.{tabela} " in ddl, tabela
        assert f"TR_{tabela}_imutavel" in ddl, tabela
    assert "INSTEAD OF UPDATE, DELETE" in ddl
    # estado atual e planos de ação são mutáveis por desenho
    assert "TR_monitoria_estado_imutavel" not in ddl
    assert "TR_monitoria_planos_acao_imutavel" not in ddl


def test_token_antigo_sem_versao_de_permissoes_e_recusado():
    """Tokens emitidos antes da reorganização de perfis/permissões precisam de novo login,
    senão o menu da Monitoria não aparece para quem já estava logado."""
    import base64
    import hashlib
    import hmac
    import json
    import time

    import pytest
    from fastapi import HTTPException

    from rh_api.auth import _build_token, validate_access_token
    from rh_api.config import get_settings
    from rh_api.auth import AuthenticatedUser

    atual = _build_token(AuthenticatedUser(username="x", id_usuario=1, nome="X"))
    assert validate_access_token(atual).username == "x"

    payload_atual = json.loads(base64.urlsafe_b64decode(atual.split(".")[0] + "=="))
    payload_atual.pop("pv")
    payload_atual["exp"] = int(time.time()) + 600
    corpo = base64.urlsafe_b64encode(json.dumps(payload_atual, separators=(",", ":")).encode()).decode().rstrip("=")
    assinatura = base64.urlsafe_b64encode(
        hmac.new(get_settings().auth_token_secret.encode(), corpo.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    with pytest.raises(HTTPException) as erro:
        validate_access_token(f"{corpo}.{assinatura}")
    assert erro.value.status_code == 401 and "login novamente" in erro.value.detail

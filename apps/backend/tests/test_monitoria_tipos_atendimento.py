"""Tipos de atendimento por canal (Correções.txt, 21/set/2026): migração V040 e contrato da aba."""

from __future__ import annotations

from pathlib import Path

from rh_api.repositories.monitoria_schema import render_migration_tipos_atendimento_sql, schema_tipos_atendimento_statements

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_migration_v040_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V040__monitoria_tipos_atendimento_canal.sql"
    assert arquivo.exists()
    assert arquivo.read_text(encoding="utf-8") == render_migration_tipos_atendimento_sql()


def test_migration_v040_e_aditiva_e_idempotente():
    for instrucao in schema_tipos_atendimento_statements():
        assert "COL_LENGTH('dbo.monitoria_catalogo', 'id_item_canal') IS NULL" in instrucao
        assert "DROP" not in instrucao.upper()


def test_aba_tipos_de_atendimentos_fica_apos_conectores_externos():
    fonte = (REPO_ROOT / "apps" / "frontend" / "fonte" / "features" / "administracao" / "index.js").read_text(encoding="utf-8")
    assert fonte.index("label: 'Conectores Externos'") < fonte.index("label: 'Tipos de atendimentos'") < fonte.index("key: 'risco'")


def test_notificacoes_casam_por_username_e_por_email():
    """As notificações da Monitoria são gravadas pelo e-mail: a consulta precisa aceitar também o e-mail."""
    repo = (REPO_ROOT / "apps" / "backend" / "rh_api" / "repositories" / "onboarding.py").read_text(encoding="utf-8")
    assert repo.count("destinatario_usuario IN (?, ?)") >= 5
    rota = (REPO_ROOT / "apps" / "backend" / "rh_api" / "routers" / "notifications.py").read_text(encoding="utf-8")
    assert "email=user.email" in rota

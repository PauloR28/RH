"""V063 (situação do formulário): gerada do mesmo DDL do bootstrap, aditiva e reversível."""

from __future__ import annotations

from pathlib import Path

from rh_api.repositories.monitoria import MonitoriaRepositoryMixin
from rh_api.repositories.monitoria_schema import (
    render_migration_situacao_formularios_sql,
    render_rollback_situacao_formularios_sql,
    schema_situacao_formularios_statements,
)

MIGRACOES = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_v063_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = MIGRACOES / "V063__monitoria_situacao_formularios.sql"
    assert arquivo.read_text(encoding="utf-8") == render_migration_situacao_formularios_sql()
    rollback = MIGRACOES / "V063__monitoria_situacao_formularios.rollback.sql"
    assert rollback.read_text(encoding="utf-8") == render_rollback_situacao_formularios_sql()


def test_migration_v063_e_aditiva_e_nao_toca_monitorias():
    sql = "\n".join(schema_situacao_formularios_statements()).upper()
    assert "DROP " not in sql and "DELETE " not in sql and "UPDATE " not in sql
    assert "DBO.MONITORIAS " not in sql


def test_situacao_derivada_do_formulario():
    situacao = MonitoriaRepositoryMixin._mon_situacao_formulario
    assert situacao(True, False) == "ativo"
    assert situacao(False, False) == "desativado"
    assert situacao(False, True) == "arquivado"
    assert situacao(True, True) == "arquivado"

"""V044 (formulários duplicáveis e exclusão lógica): gerada do mesmo DDL do bootstrap."""

from __future__ import annotations

from pathlib import Path

from rh_api.repositories.monitoria_schema import (
    SQL_MONITORIA_NAO_EXCLUIDA,
    render_migration_formularios_exclusao_sql,
    schema_formularios_exclusao_statements,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_migration_v044_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V044__monitoria_formularios_exclusao.sql"
    assert arquivo.read_text(encoding="utf-8") == render_migration_formularios_exclusao_sql()


def test_migration_v044_e_aditiva_e_nao_toca_tabelas_imutaveis():
    sql = "\n".join(schema_formularios_exclusao_statements())
    assert "DROP " not in sql.upper() and "DELETE " not in sql.upper() and "UPDATE " not in sql.upper()
    assert "dbo.monitorias " not in sql  # a tabela imutável não é alterada
    assert "monitoria_exclusoes" in SQL_MONITORIA_NAO_EXCLUIDA

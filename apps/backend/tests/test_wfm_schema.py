from __future__ import annotations

from pathlib import Path

from rh_api.repositories.wfm_schema import TABELAS_IMUTAVEIS, render_migration_sql, schema_statements

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_migration_v046_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V046__wfm_turnos_plantoes.sql"
    assert arquivo.read_text(encoding="utf-8") == render_migration_sql()


def test_migration_e_aditiva():
    sql = "\n".join(schema_statements()).upper()
    assert "DROP " not in sql and "DELETE FROM" not in sql and "ALTER TABLE" not in sql and "TRUNCATE" not in sql


def test_toda_tabela_carrega_operacao_e_imutaveis_tem_trigger():
    sql = "\n".join(schema_statements())
    for bloco in sql.split("CREATE TABLE dbo.")[1:]:
        assert "operacao NVARCHAR(60) NOT NULL" in bloco.split(");")[0]
    for tabela in TABELAS_IMUTAVEIS:
        assert f"TR_{tabela}_imutavel" in sql


def test_atestado_nao_guarda_arquivo_nem_cid():
    sql = "\n".join(schema_statements()).lower()
    bloco = sql.split("create table dbo.wfm_atestados")[1].split(");")[0]
    assert "cid" not in bloco.replace("validado", "") and "arquivo" not in bloco and "anexo" not in bloco

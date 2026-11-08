"""V067 (contato do cliente, DEC-095): DDL idêntico ao bootstrap, aditivo, e contato validado no servidor."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from rh_api.repositories.monitoria import _contato_cliente
from rh_api.repositories.monitoria_schema import (
    ensure_monitoria_schema,
    render_migration_contato_cliente_sql,
    render_rollback_contato_cliente_sql,
    schema_contato_cliente_statements,
)

MIGRACOES = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_v067_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRACOES / "V067__monitoria_contato_cliente.sql").read_text(encoding="utf-8") == render_migration_contato_cliente_sql()
    assert (MIGRACOES / "V067__monitoria_contato_cliente.rollback.sql").read_text(encoding="utf-8") == render_rollback_contato_cliente_sql()


def test_migration_v067_e_aditiva_idempotente_e_esta_no_bootstrap():
    sql = "\n".join(schema_contato_cliente_statements()).upper()
    assert "COL_LENGTH" in sql and "CONTATO_CLIENTE" in sql and "DROP " not in sql and "UPDATE " not in sql

    class Cursor:
        def __init__(self):
            self.sqls = []

        def execute(self, sql, *args):
            self.sqls.append(sql)

    cur = Cursor()
    ensure_monitoria_schema(cur)
    assert any("contato_cliente" in s for s in cur.sqls)


@pytest.mark.parametrize("entrada,saida", [
    ("11987654321", "(11) 98765-4321"),
    ("(11) 3456-7890", "(11) 3456-7890"),
    ("011 98765-4321", "(11) 98765-4321"),
    ("Ana.Lima@Exemplo.com.br", "ana.lima@exemplo.com.br"),
])
def test_contato_valido_e_normalizado(entrada, saida):
    assert _contato_cliente(entrada) == saida


@pytest.mark.parametrize("valor", ["", "   ", "98765-4321", "123456789012", "ana@", "ana@exemplo", "a b@exemplo.com"])
def test_contato_obrigatorio_e_invalido_explica_o_motivo(valor):
    with pytest.raises(HTTPException) as erro:
        _contato_cliente(valor)
    assert erro.value.status_code == 422
    assert "contato do cliente" in erro.value.detail.lower()

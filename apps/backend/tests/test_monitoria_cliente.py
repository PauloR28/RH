"""V065 (nome e CPF do cliente na monitoria): DDL idêntico ao bootstrap, aditivo, e CPF validado no servidor."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException
from rh_api.repositories.monitoria import _cpf_formatado
from rh_api.repositories.monitoria_schema import (
    render_migration_cliente_sql,
    render_rollback_cliente_sql,
    schema_cliente_statements,
)

MIGRACOES = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_v065_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRACOES / "V065__monitoria_cliente.sql").read_text(encoding="utf-8") == render_migration_cliente_sql()
    assert (MIGRACOES / "V065__monitoria_cliente.rollback.sql").read_text(encoding="utf-8") == render_rollback_cliente_sql()


def test_migration_v065_e_aditiva_e_idempotente():
    sql = "\n".join(schema_cliente_statements()).upper()
    assert "COL_LENGTH" in sql and "DROP " not in sql and "UPDATE " not in sql


def test_cpf_valido_e_formatado():
    assert _cpf_formatado("529.982.247-25") == "529.982.247-25"
    assert _cpf_formatado("52998224725") == "529.982.247-25"
    assert _cpf_formatado("") is None
    assert _cpf_formatado(None) is None


@pytest.mark.parametrize("valor", ["123", "111.111.111-11", "123.456.789-00", "529.982.247-26"])
def test_cpf_invalido_explica_o_motivo(valor):
    with pytest.raises(HTTPException) as erro:
        _cpf_formatado(valor)
    assert erro.value.status_code == 422
    assert "CPF do cliente inválido" in erro.value.detail

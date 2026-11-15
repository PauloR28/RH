"""Central de Acessos, Etapa 3: Unidade = Operação ou Setor, com tipo e um único módulo."""

from __future__ import annotations

from pathlib import Path

import pytest

from rh_api.repositories import unidades_schema as us
from rh_api.services import acesso_cache as cache

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_e_rollback_sao_gerados_do_mesmo_ddl():
    assert (MIGRATIONS / "V070__unidades_tipo_modulo.sql").read_text(encoding="utf-8") == us.render_migration_sql()
    assert (MIGRATIONS / "V070__unidades_tipo_modulo.rollback.sql").read_text(encoding="utf-8") == us.render_rollback_sql()


def test_migration_e_aditiva_e_protege_as_regras():
    sql = us.render_migration_sql()
    assert "DROP" not in sql and "DELETE" not in sql
    assert "modulo <> ''core''" in sql  # unidade nunca pertence ao core
    assert "tipo IN (''operacao'', ''setor'')" in sql
    assert "NOT NULL CONSTRAINT DF_operacoes_modulo DEFAULT 'operacao'" in sql  # um módulo, obrigatório
    # Toda instrução é condicional (idempotente).
    assert all(instrucao.startswith("IF ") for instrucao in us.schema_statements())


def _foto(*unidades):
    return cache.FotoAcessos(unidades={u.chave: u for u in unidades}, ok=True)


@pytest.fixture
def unidades():
    cache.definir_carregador(lambda: _foto(
        cache.Unidade("CRF", "CRF / Flamengo", "operacao", "operacao", True),
        cache.Unidade("BRAVA", "Brava", "operacao", "operacao", False),
        cache.Unidade("TI", "Tecnologia (TI)", "setor", "tecnologia", True),
        cache.Unidade("REC", "Recrutamento", "setor", "rh", True),
    ))
    yield
    cache.definir_carregador(None)


def test_cada_unidade_tem_um_modulo(unidades):
    assert cache.modulo_da_unidade("TI") == "tecnologia"
    assert cache.modulo_da_unidade("CRF") == "operacao"
    assert cache.modulo_da_unidade("NAO_EXISTE") is None


def test_vale_para_mostra_so_as_unidades_do_modulo(unidades):
    assert [u.chave for u in cache.unidades_do_modulo("operacao")] == ["CRF"]
    assert [u.chave for u in cache.unidades_do_modulo("operacao", so_ativas=False)] == ["BRAVA", "CRF"]
    assert [u.chave for u in cache.unidades_do_modulo("rh")] == ["REC"]
    assert cache.unidades_do_modulo("modulo_novo") == []

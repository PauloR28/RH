"""Módulos por operação (lista 10/11, item 16): migration V069 e regra do menu da Operação."""

from pathlib import Path

import pytest

from rh_api import modulos_catalogo as cat
from rh_api.repositories.monitoria_schema import render_migration_modulos_operacao_sql
from rh_api.services import acesso

MIGRACOES = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_v069_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRACOES / "V069__modulos_por_operacao.sql").read_text(encoding="utf-8") == render_migration_modulos_operacao_sql()


def test_diario_e_treinamentos_entram_na_operacao_ligados_por_padrao():
    assert {"diario", "treinamentos"} <= set(cat.FUNCOES_POR_MODULO[cat.MODULO_OPERACAO])
    assert {"diario", "treinamentos"} <= cat.FUNCOES_PADRAO_ATIVAS[cat.MODULO_OPERACAO]
    assert "diario" not in cat.FUNCOES_POR_MODULO[cat.MODULO_RH]


@pytest.fixture
def estado_com_operacoes():
    acesso.definir_carregador(lambda: acesso.EstadoModulos(
        desligadas_operacao={"CRF": frozenset({"diario"}), "CLARO": frozenset({"diario", "monitoria"})},
    ))
    yield
    acesso.definir_carregador(None)


def test_funcao_some_so_quando_desligada_em_todas_as_operacoes_da_pessoa(estado_com_operacoes):
    op = cat.MODULO_OPERACAO
    assert "diario" not in acesso.funcoes_do_usuario(op, ["CRF"])
    assert "diario" not in acesso.funcoes_do_usuario(op, ["CRF", "CLARO"])
    assert "monitoria" in acesso.funcoes_do_usuario(op, ["CRF", "CLARO"])
    assert "monitoria" not in acesso.funcoes_do_usuario(op, ["CLARO"])
    assert "diario" in acesso.funcoes_do_usuario(op, ["CRF", "OUTRA"])


def test_sem_operacao_vale_a_tela_modulos(estado_com_operacoes):
    op = cat.MODULO_OPERACAO
    assert acesso.funcoes_do_usuario(op, []) == acesso.funcoes_ativas(op)
    assert acesso.funcoes_do_usuario(cat.MODULO_RH, ["CRF"]) == acesso.funcoes_ativas(cat.MODULO_RH)

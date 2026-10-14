"""Funções por módulo (V062): schema, padrão (= menu de antes), leitura em /core/acesso e validações de escrita."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from rh_api import modulos_catalogo as cat
from rh_api.repositories import modulos_funcoes_schema as mf
from rh_api.services import acesso, modulos_admin

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migration_v062_e_gerada_do_mesmo_ddl_do_bootstrap():
    assert (MIGRATIONS / "V062__modulos_funcoes.sql").read_text(encoding="utf-8") == mf.render_migration_sql()
    assert (MIGRATIONS / "V062__modulos_funcoes.rollback.sql").read_text(encoding="utf-8") == mf.render_rollback_sql()


def test_migration_v062_e_aditiva_ascii_e_idempotente():
    sql = mf.render_migration_sql()
    assert all(ord(c) < 128 for c in sql)
    assert "DELETE" not in sql.upper() and "UPDATE" not in sql.upper()  # o seed nunca sobrescreve escolha feita
    for instrucao in mf.schema_statements():
        assert instrucao.lstrip().startswith("IF "), instrucao[:60]
    assert len(mf.schema_statements()) == 1 + sum(len(f) for f in cat.FUNCOES_POR_MODULO.values())


def test_padrao_reproduz_o_menu_de_antes():
    # MODULO_DO_GRUPO do frontend: RH = cx-curriculos/processos/provas/gestao/drive; Operação = monitoria/wfm
    assert cat.FUNCOES_PADRAO_ATIVAS[cat.MODULO_RH] == {"cx-curriculos", "processos", "provas", "gestao", "drive"}
    assert cat.FUNCOES_PADRAO_ATIVAS[cat.MODULO_OPERACAO] == {"monitoria", "wfm"}
    assert cat.FUNCOES_PADRAO_ATIVAS[cat.MODULO_TECNOLOGIA] == {"suporte", "wfm"}
    for modulo, ligadas in cat.FUNCOES_PADRAO_ATIVAS.items():
        assert ligadas <= set(cat.FUNCOES_POR_MODULO[modulo])
    assert set(cat.FUNCOES) == {f for funcoes in cat.FUNCOES_POR_MODULO.values() for f in funcoes}


@pytest.fixture
def estado_falso():
    def instalar(funcoes):
        acesso.definir_carregador(lambda: acesso.EstadoModulos(funcoes={m: frozenset(f) for m, f in funcoes.items()}))
    yield instalar
    acesso.definir_carregador(None)


def test_core_acesso_devolve_as_funcoes_de_cada_modulo(estado_falso):
    estado_falso({"rh": {"processos", "monitoria"}, "operacao": {"wfm"}, "tecnologia": set()})
    retorno = acesso.descrever(set())
    assert retorno["funcoes"]["rh"] == ["processos", "monitoria"]  # ordem do catálogo, não do banco
    assert retorno["funcoes"]["operacao"] == ["wfm"] and retorno["funcoes"]["tecnologia"] == []


def test_listagem_marca_ativas_e_mantem_modulos_protegidos(estado_falso):
    estado_falso({"rh": {"monitoria"}, "operacao": set(), "tecnologia": {"suporte"}})
    por_modulo = {m["modulo"]: m for m in modulos_admin.listar_funcoes()}
    assert [f["chave"] for f in por_modulo["rh"]["funcoes"] if f["ativo"]] == ["monitoria"]
    assert por_modulo["tecnologia"]["protegido"] is True
    assert {f["chave"] for f in por_modulo["tecnologia"]["funcoes"]} == {"suporte", "wfm"}


def test_definir_funcao_recusa_funcao_fora_do_modulo():
    with pytest.raises(HTTPException) as erro:
        modulos_admin.definir_funcao("tecnologia", "monitoria", True, autor="x")  # Monitoria não existe no menu de Tecnologia
    assert erro.value.status_code == 404
    with pytest.raises(HTTPException):
        modulos_admin.definir_funcao("modulo_inexistente", "wfm", True, autor="x")

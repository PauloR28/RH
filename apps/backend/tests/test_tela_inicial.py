"""Tela inicial configurável por perfil: normalização da configuração
(unitário) e gravação por perfil (integração; pulada sem banco)."""

from __future__ import annotations

import pytest

from rh_api.services.tela_inicial import (
    BLOCOS_TELA_INICIAL,
    PERFIS_INICIO_POR_SESSOES,
    config_padrao,
    normalizar_config,
)

IDS = [bloco["id"] for bloco in BLOCOS_TELA_INICIAL]


def test_padrao_mostra_todos_exceto_suas_areas():
    padrao = config_padrao()
    assert [b["id"] for b in padrao["blocos"]] == IDS
    assert {b["id"] for b in padrao["blocos"] if not b["visivel"]} == {"sessoes"}


def test_normalizar_mantem_ordem_descarta_invalidos_e_completa():
    config = normalizar_config({"blocos": [
        {"id": "mural", "visivel": False},
        {"id": "desconhecido", "visivel": True},
        {"id": "mural", "visivel": True},
        {"id": "atalhos"},
    ]})
    ids = [b["id"] for b in config["blocos"]]
    assert ids[:2] == ["mural", "atalhos"]
    assert sorted(ids) == sorted(IDS)
    assert config["blocos"][0] == {"id": "mural", "visivel": False}


def test_config_invalida_volta_ao_padrao():
    assert normalizar_config(None) == config_padrao()
    assert normalizar_config({"blocos": "x"}) == config_padrao()


def test_perfis_de_sessoes():
    assert PERFIS_INICIO_POR_SESSOES == {"supervisor", "qualidade", "operador", "candidato"}


def test_gravar_e_ler_por_perfil():
    from _integracao_dev import repositorio_dev

    repo = repositorio_dev()
    try:
        salvo = repo.save_tela_inicial_perfil("dp", {"blocos": [{"id": "caixa_cv", "visivel": False}]}, actor="teste")
        assert salvo["modo"] == "completa"
        assert salvo["blocos"][0] == {"id": "caixa_cv", "visivel": False}
        assert repo.get_tela_inicial_perfil("dp")["blocos"][0]["id"] == "caixa_cv"
        assert repo.get_tela_inicial_perfil("operador")["modo"] == "sessoes"
        assert "dp" in repo.list_tela_inicial_perfis()["perfis"]
    finally:
        conn = repo._connect()
        try:
            conn.cursor().execute("DELETE FROM dbo.perfis_tela_inicial WHERE id_perfil = 'dp'")
            conn.commit()
        finally:
            conn.close()

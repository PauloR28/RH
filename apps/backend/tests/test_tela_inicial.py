"""Tela inicial configurável por perfil: normalização da configuração
(unitário) e gravação por perfil (integração; pulada sem banco)."""

from __future__ import annotations

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


def test_atalhos_ocultos_so_ids_validos_sem_repetir():
    config = normalizar_config({"blocos": [], "atalhos_ocultos": ["wfm", "WFM", "minha-escala", "x y", "", None, 3]})
    assert config["atalhos_ocultos"] == ["wfm", "minha-escala", "3"]
    assert normalizar_config({"blocos": [], "atalhos_ocultos": "wfm"})["atalhos_ocultos"] == []
    assert config_padrao()["atalhos_ocultos"] == []


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


# ── Etapa 8: Início por módulo ──
from rh_api.services.tela_inicial import BLOCOS_POR_MODULO, MODULOS_INICIO, configs_por_modulo, gravar_modulo  # noqa: E402


def test_cada_modulo_tem_seus_blocos():
    assert MODULOS_INICIO == ("rh", "operacao", "tecnologia")
    assert [b["id"] for b in BLOCOS_POR_MODULO["operacao"]] == ["atalhos", "escala_hoje", "precisa_de_voce", "suas_operacoes"]
    assert all(b["visivel"] for b in config_padrao("operacao")["blocos"])
    # Bloco de outro módulo não entra.
    ids = [b["id"] for b in normalizar_config({"blocos": [{"id": "caixa_cv"}, {"id": "escala_hoje", "visivel": False}]}, "operacao")["blocos"]]
    assert ids == ["escala_hoje", "atalhos", "precisa_de_voce", "suas_operacoes"]


def test_formato_antigo_vira_rh_e_os_outros_ficam_no_padrao():
    antigo = {"blocos": [{"id": "mural", "visivel": False}], "atalhos_ocultos": ["wfm"]}
    por_modulo = configs_por_modulo(antigo)
    assert por_modulo["rh"]["blocos"][0] == {"id": "mural", "visivel": False}
    assert por_modulo["rh"]["atalhos_ocultos"] == ["wfm"]
    assert por_modulo["operacao"] == config_padrao("operacao")
    assert configs_por_modulo(None)["rh"] == config_padrao()


def test_gravar_um_modulo_nao_mexe_nos_outros():
    antigo = {"blocos": [{"id": "mural", "visivel": False}], "atalhos_ocultos": ["wfm"]}
    op = normalizar_config({"blocos": [{"id": "suas_operacoes", "visivel": False}], "atalhos_ocultos": ["diario"]}, "operacao")
    novo = gravar_modulo(antigo, "operacao", op)
    assert novo["blocos"] == antigo["blocos"] and novo["atalhos_ocultos"] == ["wfm"]
    por_modulo = configs_por_modulo(novo)
    assert por_modulo["operacao"]["blocos"][0] == {"id": "suas_operacoes", "visivel": False}
    assert por_modulo["operacao"]["atalhos_ocultos"] == ["diario"]
    assert por_modulo["tecnologia"] == config_padrao("tecnologia")
    # Só Operação salva: RH segue no padrão.
    assert configs_por_modulo(gravar_modulo({}, "operacao", op))["rh"] == config_padrao()

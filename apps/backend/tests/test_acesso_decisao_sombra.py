"""Central de Acessos, Etapa 1: regra única (acesso.decidir) em modo sombra."""

from __future__ import annotations

import logging

import pytest

from rh_api import modulos_catalogo as cat
from rh_api.services import acesso, acesso_decisao as dec


@pytest.fixture(autouse=True)
def tudo_ativo(monkeypatch):
    monkeypatch.delenv("RH_ACESSO_SOMBRA", raising=False)
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    dec.zerar_sombra()
    yield
    acesso.definir_carregador(None)


def test_perfil_decide_quando_tudo_esta_ligado():
    assert dec.decidir({"sessao.monitoria.acessar"}, "sessao.monitoria.acessar") == dec.Decisao(True, "perfil", "Permitido pelo perfil.")
    assert dec.decidir(set(), "sessao.monitoria.acessar").camada == "perfil"
    assert not dec.decidir(set(), "sessao.monitoria.acessar").pode


def test_modulo_desligado_fecha_a_porta_mesmo_com_permissao():
    ativos = frozenset({cat.MODULO_CORE, cat.MODULO_OPERACAO, cat.MODULO_TECNOLOGIA})
    acesso.definir_carregador(lambda: acesso.EstadoModulos(ativos=ativos))
    d = dec.decidir({"sessao.gestao.acessar"}, "sessao.gestao.acessar")
    assert not d.pode and d.camada == "modulo"


def test_unidade_so_fecha_para_usuario_restrito():
    perms = {"sessao.monitoria.acessar"}
    assert not dec.decidir(perms, "sessao.monitoria.acessar", unidade=7, unidades_do_usuario={3}, restrito=True).pode
    assert dec.decidir(perms, "sessao.monitoria.acessar", unidade=3, unidades_do_usuario={3}, restrito=True).pode
    assert dec.decidir(perms, "sessao.monitoria.acessar", unidade=7, unidades_do_usuario={3}, restrito=False).pode


@pytest.mark.parametrize("exigir_todas", [False, True])
def test_mesma_semantica_de_require_permissions(exigir_todas):
    perms = {"a.ver"}
    esperado = (all if exigir_todas else any)(p in perms for p in ("a.ver", "b.ver"))
    assert dec.decidir_rota(perms, ("a.ver", "b.ver"), exigir_todas=exigir_todas) is esperado
    assert dec.decidir_rota(perms, ()) is True


def test_sombra_conta_e_avisa_divergencia(caplog):
    with caplog.at_level(logging.WARNING):
        assert dec.comparar_em_sombra({"a.ver"}, ("a.ver",), exigir_todas=False, resposta_atual=True) is True
        dec.comparar_em_sombra({"a.ver"}, ("a.ver",), exigir_todas=False, resposta_atual=False, rota="GET /x")
    assert dec.situacao_sombra() == {"ligada": True, "comparacoes": 2, "divergencias": 1}
    assert "acesso_sombra_divergencia rota=GET /x" in caplog.text


def test_sombra_desligada_nao_faz_nada(monkeypatch):
    monkeypatch.setenv("RH_ACESSO_SOMBRA", "0")
    assert dec.comparar_em_sombra({"a.ver"}, ("a.ver",), exigir_todas=False, resposta_atual=False) is None
    assert dec.situacao_sombra()["comparacoes"] == 0


def test_sombra_nunca_levanta_erro(monkeypatch):
    monkeypatch.setattr(dec, "decidir_rota", lambda *a, **k: 1 / 0)
    assert dec.comparar_em_sombra({"a.ver"}, ("a.ver",), exigir_todas=False, resposta_atual=True) is None

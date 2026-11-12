"""Módulo desativado desliga TODAS as funções dele (menu, Início, atalhos, URL), mesmo exibidas em outro módulo."""

from __future__ import annotations

import pytest

from rh_api import modulos_catalogo as cat
from rh_api.services import acesso


@pytest.fixture
def rh_desligado():
    funcoes = {cat.MODULO_RH: frozenset(cat.FUNCOES_PADRAO_ATIVAS[cat.MODULO_RH]),
               # Operação exibindo funções do RH (tela Módulos): continuam sendo do RH.
               cat.MODULO_OPERACAO: frozenset({"monitoria", "wfm", "cx-curriculos", "processos", "provas", "gestao", "drive"}),
               cat.MODULO_TECNOLOGIA: frozenset(cat.FUNCOES_PADRAO_ATIVAS[cat.MODULO_TECNOLOGIA])}
    ativos = frozenset({cat.MODULO_CORE, cat.MODULO_OPERACAO, cat.MODULO_TECNOLOGIA})
    acesso.definir_carregador(lambda: acesso.EstadoModulos(ativos=ativos, funcoes=funcoes))
    yield
    acesso.definir_carregador(None)


def test_funcoes_do_rh_somem_de_outro_modulo(rh_desligado):
    assert acesso.funcoes_ativas(cat.MODULO_OPERACAO) == ["monitoria", "wfm"]
    assert acesso.funcoes_ativas(cat.MODULO_RH) == []


def test_chaves_de_sessao_do_rh_deixam_de_valer(rh_desligado):
    efetivas = acesso.filtrar_permissoes({"sessao.gestao.acessar", "sessao.drive.acessar", "sessao.curriculos.acessar",
                                          "sessao.monitoria.acessar", "sessao.treinamentos.acessar", "mural.visualizar"})
    assert efetivas == {"sessao.monitoria.acessar", "sessao.treinamentos.acessar", "mural.visualizar"}


def test_tudo_ativo_nao_muda_nada():
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    try:
        chaves = {"sessao.gestao.acessar", "sessao.drive.acessar", "sessao.monitoria.acessar"}
        assert acesso.filtrar_permissoes(chaves) == chaves
    finally:
        acesso.definir_carregador(None)

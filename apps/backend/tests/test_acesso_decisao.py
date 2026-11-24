"""Central de Acessos: regra única (acesso.decidir). O modo sombra saiu na Etapa 10 (nov/2026)."""

from __future__ import annotations

import pytest

from rh_api import modulos_catalogo as cat
from rh_api.services import acesso, acesso_cache
from rh_api.services import acesso_decisao as dec


@pytest.fixture(autouse=True)
def tudo_ativo(monkeypatch):
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    acesso_cache.definir_carregador(lambda: acesso_cache.FotoAcessos(ok=True))
    yield
    acesso.definir_carregador(None)
    acesso_cache.definir_carregador(None)


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
    assert not dec.decidir(perms, "sessao.monitoria.acessar", unidade="B", unidades_do_usuario={"A"}, restrito=True).pode
    assert dec.decidir(perms, "sessao.monitoria.acessar", unidade="A", unidades_do_usuario={"A"}, restrito=True).pode
    assert dec.decidir(perms, "sessao.monitoria.acessar", unidade="B", unidades_do_usuario={"A"}, restrito=False).pode


@pytest.mark.parametrize("exigir_todas", [False, True])
def test_mesma_semantica_de_require_permissions(exigir_todas):
    perms = {"a.ver"}
    esperado = (all if exigir_todas else any)(p in perms for p in ("a.ver", "b.ver"))
    assert dec.decidir_rota(perms, ("a.ver", "b.ver"), exigir_todas=exigir_todas) is esperado
    assert dec.decidir_rota(perms, ()) is True


# ---------------------------------------------------------------- Etapa 4: camada função
def _cenario(desligadas=None, funcoes_operacao=None):
    funcoes = dict(cat.FUNCOES_PADRAO_ATIVAS)
    if funcoes_operacao is not None:
        funcoes[cat.MODULO_OPERACAO] = frozenset(funcoes_operacao)
    acesso.definir_carregador(lambda: acesso.EstadoModulos(funcoes=funcoes, desligadas_operacao=desligadas or {}))
    acesso_cache.definir_carregador(lambda: acesso_cache.FotoAcessos(ok=True, unidades={
        "CRF": acesso_cache.Unidade("CRF", "CRF", "operacao", cat.MODULO_OPERACAO, True),
        "BRAVA": acesso_cache.Unidade("BRAVA", "Brava", "operacao", cat.MODULO_OPERACAO, True),
        "TI": acesso_cache.Unidade("TI", "TI", "setor", cat.MODULO_TECNOLOGIA, True),
    }))


def test_mapa_permissao_funcao():
    assert cat.funcao_da_permissao("wfm.escala.criar") == "wfm"
    assert cat.funcao_da_permissao("sessao.monitoria.acessar") == "monitoria"
    assert cat.funcao_da_permissao("diario.intercorrencias") == "diario"
    assert cat.funcao_da_permissao("candidatos.visualizar") is None  # compartilhada: camada não se aplica


def test_funcao_desligada_na_unidade_fecha_mesmo_com_permissao():
    _cenario(desligadas={"CRF": frozenset({"diario"})})
    perms = {"diario.intercorrencias"}
    d = dec.decidir(perms, "diario.intercorrencias", unidade="CRF")
    assert not d.pode and d.camada == "funcao"
    assert dec.decidir(perms, "diario.intercorrencias", unidade="BRAVA").pode


def test_funcao_desligada_no_modulo_da_unidade_fecha():
    _cenario(funcoes_operacao={"wfm"})  # Operação sem Monitoria
    assert not dec.decidir({"monitoria.realizar"}, "monitoria.realizar", unidade="CRF").pode
    # Etapa 4 (17/nov/2026): Monitoria desligada em todos os módulos onde existe fecha para todos, inclusive na TI.
    assert not dec.decidir({"monitoria.realizar"}, "monitoria.realizar", unidade="TI").pode


def test_funcao_ligada_em_outro_modulo_segue_a_regra_da_unidade():
    _cenario(funcoes_operacao={"monitoria"})  # WFM desligado na Operação, mas ligado na Tecnologia
    assert not dec.decidir({"wfm.escala.criar"}, "wfm.escala.criar", unidade="CRF").pode
    assert dec.decidir({"wfm.escala.criar"}, "wfm.escala.criar").pode  # sem unidade: ainda ligado em algum módulo


def test_sem_unidade_fecha_so_se_desligada_em_todas_as_unidades_da_pessoa():
    _cenario(desligadas={"CRF": frozenset({"diario"})})
    perms = {"diario.intercorrencias"}
    assert dec.decidir(perms, "diario.intercorrencias", unidades_do_usuario={"CRF", "BRAVA"}).pode
    assert not dec.decidir(perms, "diario.intercorrencias", unidades_do_usuario={"CRF"}).pode
    assert dec.decidir(perms, "diario.intercorrencias").pode  # pessoa sem unidade: vale o global


def test_desligado_vence_excecao_e_perfil():
    _cenario(desligadas={"CRF": frozenset({"wfm"})})
    # Mesmo com a permissão no perfil, a camada de fora fecha (decisão de 12/nov: desligado vence).
    assert dec.decidir({"wfm.escala.aprovar"}, "wfm.escala.aprovar", unidade="CRF").camada == "funcao"


def test_permissao_do_rh_nao_e_julgada_pelas_funcoes_da_operacao_da_pessoa():
    # Bug 16/nov/2026 (produção): Gestora vinculada à CRF (Operação, onde Processos fica desligado) perdia as sessões do RH.
    _cenario(funcoes_operacao={"wfm", "monitoria"})
    perms = {"sessao.processos.acessar"}
    assert dec.decidir(perms, "sessao.processos.acessar", unidades_do_usuario={"CRF"}).pode
    assert dec.permissoes_efetivas(perms, perfil="gestor", id_usuario=7, unidades_do_usuario={"CRF"}) == frozenset(perms)

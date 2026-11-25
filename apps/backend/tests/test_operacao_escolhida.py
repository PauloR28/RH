"""Seletor de operação do topo (25/nov/2026): o servidor mostra só a operação escolhida e nunca abre nada."""

from dataclasses import replace

from rh_api import alcance as al
from rh_api import rbac as r
from rh_api.auth import AuthenticatedUser, OperacaoEscolhida
from rh_api.services import acesso_cache
from rh_api.services import monitoria_scope as ms
from rh_api.services import operacao_escolhida as oe
from rh_api.services import wfm_scope as ws

UNIDADES = [
    acesso_cache.Unidade("CRF", "CRF / Flamengo", "operacao", "operacao", True),
    acesso_cache.Unidade("DAVITA", "Davita", "operacao", "operacao", True),
    acesso_cache.Unidade("TI", "TI", "setor", "tecnologia", True),
]


def _usuario(perfil, operacoes=()):
    return AuthenticatedUser(username="x", perfil=perfil, operacoes=frozenset(operacoes), id_usuario=7)


def _sem_banco(monkeypatch):
    al.definir_carregador(lambda: {})
    monkeypatch.setattr(acesso_cache, "unidades_do_modulo", lambda m, **_: [u for u in UNIDADES if u.modulo == m])


def test_global_ve_todas_as_operacoes_e_escolhe_uma(monkeypatch):
    _sem_banco(monkeypatch)
    adm = _usuario(r.ROLE_ADMIN)
    assert [o["chave"] for o in oe.operacoes_escolhiveis(adm)] == ["CRF", "DAVITA"]
    escolhido = oe.aplicar(adm, "DAVITA", "operacao")
    assert ws.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"DAVITA"}
    assert ms.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"DAVITA"}
    assert escolhido.allows_operacao("DAVITA") and not escolhido.allows_operacao("CRF")
    # De volta à lista: ainda oferece as duas.
    assert len(oe.operacoes_escolhiveis(escolhido)) == 2


def test_restrito_so_escolhe_os_proprios_vinculos(monkeypatch):
    _sem_banco(monkeypatch)
    sup = _usuario(r.ROLE_SUPERVISOR, {"CRF"})
    assert [o["chave"] for o in oe.operacoes_escolhiveis(sup)] == ["CRF"]
    assert oe.aplicar(sup, "DAVITA", "operacao") is sup  # uma operação só: sem seletor, nada muda
    sup2 = _usuario(r.ROLE_SUPERVISOR, {"CRF", "DAVITA"})
    assert oe.aplicar(sup2, "OUTRA", "operacao") is sup2  # fora do alcance: ignorado
    assert oe.aplicar(sup2, "DAVITA", "operacao").operacoes == {"DAVITA"}


def test_nunca_abre_area_restrita(monkeypatch):
    _sem_banco(monkeypatch)
    # Control Desk: Monitoria global, WFM só nos vínculos. Escolher outra operação não abre o WFM dela.
    cd = _usuario(r.ROLE_CONTROL_DESK, {"CRF"})
    escolhido = oe.aplicar(cd, "DAVITA", "operacao")
    assert ms.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"DAVITA"}
    assert ws.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == frozenset()
    assert not escolhido.allows_operacao("DAVITA")


def test_sem_cabecalho_vale_a_primeira_e_fora_da_operacao_nada_muda(monkeypatch):
    _sem_banco(monkeypatch)
    adm = _usuario(r.ROLE_ADMIN)
    assert oe.aplicar(adm, "", "operacao").operacoes == {"CRF"}  # sem escolha: a primeira, igual ao topo
    assert oe.aplicar(adm, "CRF", "rh") is adm
    assert oe.aplicar(adm, "TI", "operacao") is adm
    assert ws.operacoes_permitidas(adm.perfil, adm.operacoes) is None


def test_operacao_escolhida_guarda_os_vinculos():
    ops = OperacaoEscolhida({"CRF"}, {"CRF", "DAVITA"})
    u = replace(_usuario(r.ROLE_SUPERVISOR, {"CRF", "DAVITA"}), operacoes=ops)
    assert u.operacoes == {"CRF"} and u.operacoes.originais == {"CRF", "DAVITA"}

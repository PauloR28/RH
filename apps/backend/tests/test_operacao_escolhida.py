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
_ATUAL = {"ops": frozenset()}


def _usuario(perfil, operacoes=()):
    _ATUAL["ops"] = frozenset(operacoes)
    oe.limpar_cache()  # mesmo id_usuario nos testes
    return AuthenticatedUser(username="x", perfil=perfil, operacoes=frozenset(operacoes), id_usuario=7)


def _sem_banco(monkeypatch, vinculos=None):
    """Vínculos "do banco": por padrão, os mesmos do token do último usuário criado."""
    al.definir_carregador(lambda: {})
    oe.limpar_cache()
    monkeypatch.setattr(acesso_cache, "unidades_do_modulo", lambda m, **_: [u for u in UNIDADES if u.modulo == m])
    monkeypatch.setattr(oe, "_leitor", lambda _id: frozenset(vinculos) if vinculos is not None else _ATUAL["ops"])


def test_global_sem_operacao_liberada_ve_todas_e_escolhe_uma(monkeypatch):
    _sem_banco(monkeypatch)
    adm = _usuario(r.ROLE_ADMIN)
    assert [o["chave"] for o in oe.operacoes_escolhiveis(adm)] == ["CRF", "DAVITA"]
    escolhido = oe.aplicar(adm, "DAVITA", "operacao")
    assert ws.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"DAVITA"}
    assert ms.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"DAVITA"}
    assert escolhido.allows_operacao("DAVITA") and not escolhido.allows_operacao("CRF")
    assert len(oe.operacoes_escolhiveis(escolhido)) == 2


def test_restrito_so_escolhe_os_proprios_vinculos(monkeypatch):
    _sem_banco(monkeypatch)
    sup = _usuario(r.ROLE_SUPERVISOR, {"CRF"})
    assert [o["chave"] for o in oe.operacoes_escolhiveis(sup)] == ["CRF"]
    assert oe.aplicar(sup, "DAVITA", "operacao").operacoes == {"CRF"}  # forçada fora do permitido: não abre
    sup2 = _usuario(r.ROLE_SUPERVISOR, {"CRF", "DAVITA"})
    assert oe.aplicar(sup2, "OUTRA", "operacao").operacoes == {"CRF"}
    assert oe.aplicar(sup2, "DAVITA", "operacao").operacoes == {"DAVITA"}


def test_perfil_global_com_operacoes_liberadas_ve_so_elas(monkeypatch):
    # Correção 25/11: Control Desk (Monitoria global) e Gestor com operações liberadas viam todas no seletor.
    for perfil in (r.ROLE_CONTROL_DESK, r.ROLE_MANAGER, r.ROLE_ADMIN):
        _sem_banco(monkeypatch)
        u = _usuario(perfil, {"CRF"})
        assert [o["chave"] for o in oe.operacoes_escolhiveis(u)] == ["CRF"], perfil
        escolhido = oe.aplicar(u, "DAVITA", "operacao")  # forçada
        assert escolhido.operacoes == {"CRF"}
        assert ms.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"CRF"}
        assert ws.operacoes_permitidas(escolhido.perfil, escolhido.operacoes) == {"CRF"}
        assert not escolhido.allows_operacao("DAVITA")


def test_vinculos_do_banco_valem_sem_novo_login(monkeypatch):
    _sem_banco(monkeypatch, vinculos={"crf", "DAVITA"})
    cd = _usuario(r.ROLE_CONTROL_DESK, {"CRF"})  # token antigo
    assert [o["chave"] for o in oe.operacoes_escolhiveis(cd)] == ["CRF", "DAVITA"]
    escolhido = oe.aplicar(cd, "CRF", "operacao")
    assert escolhido.allows_operacao("CRF") and not escolhido.allows_operacao("DAVITA")


def test_sem_cabecalho_vale_a_primeira_e_fora_da_operacao_nada_muda(monkeypatch):
    _sem_banco(monkeypatch)
    adm = _usuario(r.ROLE_ADMIN)
    assert oe.aplicar(adm, "", "operacao").operacoes == {"CRF"}  # sem escolha: a primeira, igual ao topo
    assert oe.aplicar(adm, "TI", "operacao").operacoes == {"CRF"}  # TI não é da Operação: vale a primeira
    assert oe.aplicar(adm, "CRF", "rh") is adm
    assert ws.operacoes_permitidas(adm.perfil, adm.operacoes) is None


def test_sem_operacao_a_escolher_nada_muda(monkeypatch):
    _sem_banco(monkeypatch)
    sup = _usuario(r.ROLE_SUPERVISOR)
    assert oe.operacoes_escolhiveis(sup) == []
    assert oe.aplicar(sup, "CRF", "operacao") is sup


def test_operacao_escolhida_guarda_os_vinculos():
    ops = OperacaoEscolhida({"CRF"}, {"CRF", "DAVITA"})
    u = replace(_usuario(r.ROLE_SUPERVISOR, {"CRF", "DAVITA"}), operacoes=ops)
    assert u.operacoes == {"CRF"} and u.operacoes.originais == {"CRF", "DAVITA"}

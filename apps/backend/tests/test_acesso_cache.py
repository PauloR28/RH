"""Central de Acessos, Etapa 2: cache de acessos e permissões atuais do perfil sem relogin."""

from __future__ import annotations

from dataclasses import replace

import pytest

from rh_api import dependencies
from rh_api.auth import AuthenticatedUser
from rh_api.services import acesso, acesso_cache as cache


def _foto(perms=None, mp=None, mu=None, ok=True):
    return cache.FotoAcessos(permissoes=perms or {}, modulos_perfil=mp or {}, modulos_usuario=mu or {}, ok=ok)


@pytest.fixture(autouse=True)
def limpar():
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    yield
    cache.definir_carregador(None)
    acesso.definir_carregador(None)


def test_uma_leitura_serve_muitos_pedidos():
    cache.definir_carregador(lambda: _foto({"supervisor": frozenset({"a.ver"})}, mp={"supervisor": frozenset({"operacao"})}))
    for _ in range(50):
        assert cache.permissoes_atuais("supervisor") == {"a.ver"}
        assert acesso.modulos_liberados(10, "supervisor") == {"operacao"}
    assert cache.leituras() == 1


def test_invalidar_faz_a_mudanca_valer_no_proximo_pedido():
    estado = {"perms": frozenset({"a.ver"})}
    cache.definir_carregador(lambda: _foto({"supervisor": estado["perms"]}))
    assert cache.permissoes_atuais("supervisor") == {"a.ver"}
    estado["perms"] = frozenset({"a.ver", "a.aprovar"})
    assert cache.permissoes_atuais("supervisor") == {"a.ver"}  # ainda no cache
    cache.invalidar()
    assert cache.permissoes_atuais("supervisor") == {"a.ver", "a.aprovar"}


def test_perfil_desconhecido_ou_falha_mantem_o_token():
    cache.definir_carregador(lambda: _foto({"supervisor": frozenset({"a.ver"})}))
    assert cache.permissoes_atuais("perfil_sem_linhas") is None
    assert cache.permissoes_atuais(None) is None

    def quebra():
        raise RuntimeError("banco fora")

    cache.definir_carregador(quebra)
    assert cache.permissoes_atuais("supervisor") is None
    assert acesso.modulos_liberados(10, "supervisor") == frozenset()


def test_modulos_liberados_soma_perfil_e_usuario_e_ignora_invalidos():
    cache.definir_carregador(lambda: _foto(mp={"rh": frozenset({"rh", "xyz"})}, mu={7: frozenset({"operacao"})}))
    assert acesso.modulos_liberados(7, "rh") == {"rh", "operacao"}
    assert acesso.modulos_liberados(8, "rh") == {"rh"}


def test_get_current_user_troca_permissoes_do_token_pelas_atuais(monkeypatch):
    token_user = AuthenticatedUser(username="ana", id_usuario=5, perfil="supervisor", permissions=frozenset({"velha.ver"}))
    monkeypatch.setattr(dependencies, "validate_access_token", lambda _t: token_user)
    monkeypatch.setattr(dependencies, "_refresh_monitoria_scope", lambda u, _r: u)
    cache.definir_carregador(lambda: _foto({"supervisor": frozenset({"nova.ver"})}))

    class Cred:
        scheme = "Bearer"
        credentials = "x"

    assert dependencies.get_current_user(Cred(), None).permissions == {"nova.ver"}
    # Sem id de usuário (usuário técnico) ou sem cache: vale o token.
    monkeypatch.setattr(dependencies, "validate_access_token", lambda _t: replace(token_user, id_usuario=None))
    assert dependencies.get_current_user(Cred(), None).permissions == {"velha.ver"}

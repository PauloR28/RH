"""Módulos por pessoa e por perfil (16/nov/2026): camadas da decisão e o 'tirar' que vence as permissões."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from rh_api.services import acesso, modulos_pessoa
from rh_api.services import acesso_cache as cache

GESTOR_PERMS = frozenset({"painel.visualizar"})


def _exc(tipo, alvo, modulo, efeito):
    return cache.Excecao(tipo, alvo if tipo == "perfil" else None, alvo if tipo == "usuario" else None, None, f"modulo.{modulo}.abrir", efeito)


def _foto(excecoes=(), mp=None, mu=None, perfis=None):
    return cache.FotoAcessos(permissoes={"gestor": GESTOR_PERMS, "administrador": frozenset({"configuracoes.visualizar"})},
                             modulos_perfil=mp or {}, modulos_usuario=mu or {}, excecoes=tuple(excecoes),
                             perfil_do_usuario=perfis or {7: "gestor"}, ok=True)


@pytest.fixture(autouse=True)
def limpar():
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    yield
    cache.definir_carregador(None)
    acesso.definir_carregador(None)


def test_pessoa_vence_perfil_e_perfil_vence_v060():
    cache.definir_carregador(lambda: _foto(
        [_exc("perfil", "gestor", "rh", "retirar"), _exc("usuario", 7, "rh", "conceder"), _exc("usuario", 7, "operacao", "retirar")],
        mp={"gestor": frozenset({"rh"})}))
    assert cache.decisao_modulos(7, "gestor") == {"rh": True, "operacao": False}
    assert cache.decisao_modulos(8, "gestor") == {"rh": False}  # outra pessoa do perfil: vale o perfil
    assert cache.modulos_liberados(7, "gestor") == {"rh"}
    assert cache.modulos_retirados(7, "gestor") == {"operacao"}


def test_modulo_tirado_some_mesmo_aberto_pelas_permissoes(monkeypatch):
    monkeypatch.setattr(acesso, "modulo_aberto_por", lambda chave: "operacao" if chave == "painel.visualizar" else None)
    assert "operacao" in acesso.modulos_visiveis(GESTOR_PERMS)
    assert "operacao" not in acesso.modulos_visiveis(GESTOR_PERMS, retirados={"operacao"})


def test_estado_usuario_mostra_de_onde_vem(monkeypatch):
    monkeypatch.setattr(acesso, "modulo_aberto_por", lambda chave: "operacao" if chave == "painel.visualizar" else None)
    cache.definir_carregador(lambda: _foto([_exc("usuario", 7, "rh", "conceder")]))
    estado = {m["chave"]: m for m in modulos_pessoa.estado_usuario(7, "gestor")["modulos"]}
    assert (estado["operacao"]["valor"], estado["operacao"]["origem"]) == (True, "perfil")
    assert (estado["rh"]["valor"], estado["rh"]["origem"]) == (True, "pessoa")
    assert (estado["tecnologia"]["valor"], estado["tecnologia"]["origem"]) == (False, "")


def test_nao_tira_tecnologia_de_quem_administra():
    cache.definir_carregador(lambda: _foto(perfis={1: "administrador"}))
    with pytest.raises(HTTPException) as erro:
        modulos_pessoa.salvar_perfil("administrador", {"tecnologia": False}, autor="t")
    assert erro.value.status_code == 409


def test_modulo_invalido_recusado():
    with pytest.raises(HTTPException):
        modulos_pessoa._validar({"core": True})

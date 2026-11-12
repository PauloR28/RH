"""Central de Acessos, Etapa 5: exceções num lugar só e a regra única decidindo (com a chave ligada)."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from rh_api import dependencies
from rh_api import modulos_catalogo as cat
from rh_api.auth import AuthenticatedUser
from rh_api.repositories import acesso_excecoes_schema as xs
from rh_api.services import acesso, acesso_cache as cache, acesso_decisao as dec

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"
E = cache.Excecao


def test_migration_e_rollback_sao_gerados_do_mesmo_ddl():
    assert (MIGRATIONS / "V071__acesso_excecoes.sql").read_text(encoding="utf-8") == xs.render_migration_sql()
    assert (MIGRATIONS / "V071__acesso_excecoes.rollback.sql").read_text(encoding="utf-8") == xs.render_rollback_sql()
    assert "DELETE" not in xs.render_migration_sql() and "DROP" not in xs.render_migration_sql()


def _foto(excecoes=(), perfis=None, perfil_do_usuario=None, desligadas=None):
    acesso.definir_carregador(lambda: acesso.EstadoModulos(desligadas_operacao=desligadas or {}))
    cache.definir_carregador(lambda: cache.FotoAcessos(
        ok=True,
        permissoes=perfis or {},
        excecoes=tuple(excecoes),
        perfil_do_usuario=perfil_do_usuario or {},
        unidades={u: cache.Unidade(u, u, "operacao", cat.MODULO_OPERACAO, True) for u in ("CRF", "BRAVA")},
    ))


@pytest.fixture(autouse=True)
def limpar(monkeypatch):
    monkeypatch.delenv("RH_ACESSO_REGRA_UNICA", raising=False)
    yield
    acesso.definir_carregador(None)
    cache.definir_carregador(None)


def test_excecao_da_pessoa_vence_a_do_perfil():
    _foto([E("perfil", "supervisor", None, None, "wfm.escala.aprovar", "retirar"),
           E("usuario", None, 5, None, "wfm.escala.aprovar", "conceder")])
    d = dec.decidir(set(), "wfm.escala.aprovar", perfil="supervisor", id_usuario=5)
    assert d.pode and "pessoa" in d.motivo
    assert not dec.decidir({"wfm.escala.aprovar"}, "wfm.escala.aprovar", perfil="supervisor", id_usuario=6).pode


def test_no_mesmo_nivel_retirar_vence():
    _foto([E("usuario", None, 5, None, "a.ver", "conceder"), E("usuario", None, 5, "CRF", "a.ver", "retirar")])
    assert not dec.decidir({"a.ver"}, "a.ver", id_usuario=5, unidade="CRF").pode
    assert dec.decidir({"a.ver"}, "a.ver", id_usuario=5, unidade="BRAVA").pode


def test_excecao_por_unidade_sem_unidade_no_pedido_vale_em_alguma():
    _foto([E("perfil", "supervisor", None, "CRF", "monitoria.anular", "conceder")])
    assert dec.decidir(set(), "monitoria.anular", perfil="supervisor", unidades_do_usuario={"CRF", "BRAVA"}).pode
    assert not dec.decidir(set(), "monitoria.anular", perfil="supervisor", unidades_do_usuario={"BRAVA"}).pode


def test_excecao_nao_reabre_funcao_desligada():
    _foto([E("usuario", None, 5, None, "diario.intercorrencias", "conceder")], desligadas={"CRF": frozenset({"diario"})})
    d = dec.decidir(set(), "diario.intercorrencias", id_usuario=5, unidade="CRF")
    assert not d.pode and d.camada == "funcao"


def test_permissoes_efetivas_somam_concedidas_e_tiram_retiradas():
    _foto([E("usuario", None, 5, None, "monitoria.anular", "conceder"), E("perfil", "supervisor", None, None, "wfm.relatorios", "retirar")])
    efetivas = dec.permissoes_efetivas({"wfm.relatorios", "wfm.escala.visualizar"}, perfil="supervisor", id_usuario=5, unidades_do_usuario=frozenset())
    assert efetivas == {"wfm.escala.visualizar", "monitoria.anular"}


def test_modulo_liberado_por_excecao():
    _foto([E("perfil", "rh", None, None, "modulo.operacao.abrir", "conceder")])
    assert acesso.modulos_liberados(9, "rh") == {"operacao"}


class _Cred:
    scheme = "Bearer"
    credentials = "x"


def _usuario(monkeypatch, **kw):
    user = AuthenticatedUser(username="ana", id_usuario=5, perfil="supervisor", permissions=frozenset({"wfm.relatorios"}), **kw)
    monkeypatch.setattr(dependencies, "validate_access_token", lambda _t: user)
    monkeypatch.setattr(dependencies, "_refresh_monitoria_scope", lambda u, _r: u)
    return user


def test_chave_desligada_nao_muda_nada(monkeypatch):
    _usuario(monkeypatch)
    _foto([E("perfil", "supervisor", None, None, "wfm.relatorios", "retirar")], perfis={"supervisor": frozenset({"wfm.relatorios"})})
    assert dependencies.get_current_user(_Cred(), None).permissions == {"wfm.relatorios"}


def test_chave_ligada_a_regra_unica_decide(monkeypatch):
    monkeypatch.setenv("RH_ACESSO_REGRA_UNICA", "1")
    _usuario(monkeypatch)
    _foto([E("perfil", "supervisor", None, None, "wfm.relatorios", "retirar")], perfis={"supervisor": frozenset({"wfm.relatorios"})})
    assert dependencies.get_current_user(_Cred(), None).permissions == frozenset()


def test_troca_de_perfil_vale_sem_relogin(monkeypatch):
    _usuario(monkeypatch)
    _foto(perfis={"supervisor": frozenset({"a.ver"}), "gestor": frozenset({"a.ver", "a.aprovar"})}, perfil_do_usuario={5: "gestor"})
    user = dependencies.get_current_user(_Cred(), None)
    assert user.perfil == "gestor" and user.permissions == {"a.ver", "a.aprovar"}

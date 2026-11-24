"""Etapa 9: perfis no banco. Perfil criado pela tela funciona como um perfil do código (regras sobre a pessoa),
perfil do código pode ser apagado (ativo = 0) e o id nunca muda."""

from __future__ import annotations

import pytest

from rh_api import alcance as al
from rh_api import rbac as r

BANCO = {
    "coordenador": {"nome": "Coordenador", "descricao": "", "ativo": True, "sistema": False, "funciona_como": "supervisor"},
    "estagiario": {"nome": "Estagiário", "descricao": "", "ativo": False, "sistema": True, "funciona_como": ""},
    "sem_base": {"nome": "Sem base", "descricao": "", "ativo": True, "sistema": False, "funciona_como": "inexistente"},
    "rh": {"nome": "Recursos Humanos", "descricao": "", "ativo": True, "sistema": True, "funciona_como": ""},
}


@pytest.fixture(autouse=True)
def banco():
    r.definir_carregador_perfis(lambda: BANCO)
    al.invalidar()
    yield
    r.definir_carregador_perfis(lambda: {})
    al.invalidar()


def test_papel_do_perfil_criado_e_dos_do_codigo():
    assert r.papel("coordenador") == r.ROLE_SUPERVISOR
    assert r.papel("Supervisor") == r.ROLE_SUPERVISOR
    assert r.papel("sem_base") == "sem_base"  # funciona_como inválido: não vira perfil
    assert "coordenador" in r.perfis_com_papel(r.ROLE_SUPERVISOR)
    assert r.perfis_com_papel(r.ROLE_OPERATOR) == (r.ROLE_OPERATOR,)


def test_definicao_permissoes_e_alcance_seguem_a_base():
    d = r.get_role_definition("coordenador")
    assert d.id == "coordenador" and d.name == "Coordenador"
    assert r.get_role_permissions("coordenador") == r.get_role_permissions(r.ROLE_SUPERVISOR)
    assert al.alcance("coordenador").wfm == al.alcance(r.ROLE_SUPERVISOR).wfm


def test_apagado_some_das_listas_e_nome_trocado_vale():
    assert r.perfil_removido("estagiario") and not r.perfil_existe("estagiario")
    ids = {p.id for p in r.perfis_ativos()}
    assert "estagiario" not in ids and "coordenador" in ids and "sem_base" not in ids
    assert r.get_role_definition("rh").name == "Recursos Humanos"
    assert r.get_role_definition("rh").id == "rh"


def test_quem_gerencia_supervisor_gerencia_o_coordenador():
    from rh_api.services.monitoria_scope import pode_gerenciar_perfil

    assert pode_gerenciar_perfil(r.ROLE_MANAGER, "coordenador") == pode_gerenciar_perfil(r.ROLE_MANAGER, r.ROLE_SUPERVISOR)


def test_novo_id_evita_apelidos_e_repetidos():
    from rh_api.repositories.perfis_admin import _novo_id

    assert _novo_id("Coordenador", set()) == "coordenador"
    assert _novo_id("Coordenador", {"coordenador"}) == "coordenador_2"
    assert _novo_id("Admin", set()) != "admin"  # "admin" já quer dizer Administrador
    assert _novo_id("Supervisor", set()) == "supervisor_2"


def test_migration_v075_coincide_com_o_schema():
    from pathlib import Path

    from rh_api.repositories import perfis_schema as s
    pasta = Path(__file__).resolve().parents[3] / "infra/sql/migrations"
    assert (pasta / "V075__perfis_funciona_como.sql").read_text(encoding="utf-8") == s.render_migration_sql()
    assert (pasta / "V075__perfis_funciona_como.rollback.sql").read_text(encoding="utf-8") == s.render_rollback_sql()

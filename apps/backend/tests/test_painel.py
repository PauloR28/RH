"""Painel (V072, 14/nov/2026): migração = bootstrap, permissões, catálogo de métricas, períodos e quem vê."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from rh_api import acesso_catalogo as cat
from rh_api.modulos_catalogo import MODULO_CORE, MODULO_TECNOLOGIA, modulo_dono_padrao
from rh_api.rbac import PERMISSION_DEFINITIONS, ROLE_ADMIN, ROLE_ANALISTA_TI, ROLE_MANAGER, ROLE_OPERATOR, ROLE_SUPERVISOR, SCREEN_PERMISSIONS, get_role_permissions
from rh_api.repositories.painel_schema import render_migration_sql, render_rollback_sql
from rh_api.services import painel_regras as r

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"


def test_migracao_igual_ao_bootstrap():
    assert (MIGRATIONS / "V072__painel.sql").read_text(encoding="utf-8") == render_migration_sql()
    assert (MIGRATIONS / "V072__painel.rollback.sql").read_text(encoding="utf-8") == render_rollback_sql()


def test_permissoes_e_donos():
    for chave in ("sessao.painel.acessar", "painel.visualizar", "painel.configurar"):
        assert chave in PERMISSION_DEFINITIONS
        assert cat.funcao_de(chave).id == "indicadores"
    assert PERMISSION_DEFINITIONS["painel.configurar"].critical
    assert modulo_dono_padrao("painel.visualizar", "Painel") == MODULO_CORE
    assert modulo_dono_padrao("painel.configurar", "Painel") == MODULO_TECNOLOGIA
    assert SCREEN_PERMISSIONS["screen-painel"] == "painel.visualizar"
    assert SCREEN_PERMISSIONS["screen-settings-paineis"] == "painel.configurar"


def test_valores_iniciais_dos_perfis():
    gestor = get_role_permissions(ROLE_MANAGER)
    assert {"sessao.painel.acessar", "painel.visualizar"} <= gestor and "painel.configurar" not in gestor
    ti = get_role_permissions(ROLE_ANALISTA_TI)
    assert "painel.configurar" in ti and "painel.visualizar" not in ti  # a TI monta, não assiste
    assert {"painel.visualizar", "painel.configurar"} <= get_role_permissions(ROLE_ADMIN)
    for perfil in (ROLE_SUPERVISOR, ROLE_OPERATOR):
        assert not any(p.startswith("painel.") for p in get_role_permissions(perfil))


@pytest.mark.parametrize(
    ("periodo", "esperado"),
    [
        ("hoje", (date(2026, 11, 14), date(2026, 11, 14))),
        ("semana", (date(2026, 11, 9), date(2026, 11, 14))),
        ("mes", (date(2026, 11, 1), date(2026, 11, 14))),
        ("passado", (date(2026, 10, 1), date(2026, 10, 31))),
    ],
)
def test_periodos(periodo, esperado):
    assert r.intervalo_do_periodo(periodo, date(2026, 11, 14)) == esperado


def test_periodo_anterior_tem_a_mesma_duracao():
    assert r.periodo_anterior(date(2026, 11, 1), date(2026, 11, 14)) == (date(2026, 10, 18), date(2026, 10, 31))


def test_metricas_validas_normaliza_e_recusa():
    saida = r.metricas_validas("operacao", [{"metrica": "operadores"}, {"metrica": "frequencia", "forma": "tabela"}])
    assert saida == [{"metrica": "operadores", "forma": "tabela", "ordem": 1}, {"metrica": "frequencia", "forma": "tabela", "ordem": 2}]
    with pytest.raises(ValueError):
        r.metricas_validas("operacao", [{"metrica": "rh_entrevistas"}])  # métrica de outro módulo
    with pytest.raises(ValueError):
        r.metricas_validas("operacao", [{"metrica": "presenca"}, {"metrica": "presenca"}])
    with pytest.raises(ValueError):
        r.metricas_validas("operacao", [{"metrica": "presenca", "forma": "pizza"}])


def test_quem_ve_o_painel():
    base = {"perfis_do_painel": {"gestor"}, "permissoes": {"painel.visualizar"}, "ativo": True, "eh_admin": False}
    assert r.pode_ver_painel(perfil="gestor", **base)
    assert not r.pode_ver_painel(perfil="supervisor", **base)
    assert not r.pode_ver_painel(perfil="gestor", **{**base, "permissoes": set()})
    assert not r.pode_ver_painel(perfil="gestor", **{**base, "ativo": False})
    assert r.pode_ver_painel(perfil="administrador", **{**base, "eh_admin": True})


def test_metrica_exige_permissao_de_base():
    assert r.tem_base(r.METRICAS["monitorias"], {"monitoria.dashboard"})
    assert not r.tem_base(r.METRICAS["diario"], {"wfm.relatorios"})

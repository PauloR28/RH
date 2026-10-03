"""Modularização, Etapa 3: migrations V055-V057 (geradas do mesmo DDL do bootstrap, aditivas, com rollback) e trava do Administrador."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from rh_api.rbac import PERMISSION_DEFINITIONS
from rh_api.repositories import modulos_schema as ms
from rh_api.repositories.security import _garantir_fronteira_administrador

MIGRATIONS = Path(__file__).resolve().parents[3] / "infra" / "sql" / "migrations"

CASOS = (
    ("V055__modulos_sistema", ms.render_migration_modulos_sql, ms.render_rollback_modulos_sql),
    ("V056__modulo_dono_permissoes", ms.render_migration_modulo_dono_sql, ms.render_rollback_modulo_dono_sql),
    ("V057__perfis_ti_administracao", ms.render_migration_perfis_ti_sql, ms.render_rollback_perfis_ti_sql),
)


@pytest.mark.parametrize("nome,frente,volta", CASOS)
def test_migration_e_rollback_sao_gerados_do_mesmo_ddl(nome, frente, volta):
    assert (MIGRATIONS / f"{nome}.sql").read_text(encoding="utf-8") == frente()
    assert (MIGRATIONS / f"{nome}.rollback.sql").read_text(encoding="utf-8") == volta()


@pytest.mark.parametrize("nome,frente,volta", CASOS)
def test_migration_para_frente_e_aditiva(nome, frente, volta):
    sql = frente().upper()
    assert "DROP " not in sql and "DELETE " not in sql and "TRUNCATE" not in sql and "RENAME" not in sql
    assert "IF " in sql  # idempotente


def test_v056_semeia_todas_as_permissoes_so_onde_o_dono_esta_vazio():
    sql = ms.render_migration_modulo_dono_sql()
    assert sql.count("modulo_dono IS NULL") >= 4  # nunca sobrescreve reatribuição feita em Tecnologia
    for chave in PERMISSION_DEFINITIONS:
        assert f"''{chave}''" in sql, chave


def test_v057_so_concede_core_e_tecnologia_e_registra_no_log():
    from rh_api.modulos_catalogo import MODULO_CORE, MODULO_TECNOLOGIA, modulo_dono_padrao

    concedidas = ms._grants_ti()
    assert {p for p, _ in concedidas} == set(ms.PERFIS_TI_IDS)
    for _perfil, chave in concedidas:
        assert modulo_dono_padrao(chave, PERMISSION_DEFINITIONS[chave].module) in (MODULO_CORE, MODULO_TECNOLOGIA), chave
        assert not chave.startswith("wfm.")  # o WFM dos perfis de TI não é tocado
    sql = ms.render_migration_perfis_ti_sql()
    assert "modularizacao_grants_log" in sql and "NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes e" in sql
    assert "wfm.escala.criar" not in sql  # só o Analista cria escala


def test_rollback_v057_remove_somente_o_que_o_log_registra():
    sql = ms.render_rollback_perfis_ti_sql()
    assert "modularizacao_grants_log l" in sql and "l.migration = 'V057'" in sql


# ------------------------------------------------------------------ trava: só o Administrador mexe no perfil Administrador
def test_ti_nao_atribui_nem_altera_administrador():
    from rh_api.auth import AuthenticatedUser

    ti = AuthenticatedUser(username="ti", perfil="analista_ti")
    with pytest.raises(HTTPException) as exc:
        _garantir_fronteira_administrador(ti, "administrador")
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException):
        _garantir_fronteira_administrador(ti, "tecnico_pleno", "Administrador")
    _garantir_fronteira_administrador(ti, "supervisor", "gestor")  # TI administra os demais perfis


def test_administrador_e_chamadas_internas_nao_tem_trava():
    from rh_api.auth import AuthenticatedUser

    _garantir_fronteira_administrador(AuthenticatedUser(username="a", perfil="administrador"), "administrador")
    _garantir_fronteira_administrador(None, "administrador")
    _garantir_fronteira_administrador({"perfil": "administrador"}, "administrador")
    with pytest.raises(HTTPException):
        _garantir_fronteira_administrador({"perfil": "gestor"}, "administrador")

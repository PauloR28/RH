"""Equipes na Tecnologia (24/nov/2026, V076): migration, permissões, rotas e validações que não dependem do banco."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.rbac import (  # noqa: E402
    PERMISSION_DEFINITIONS,
    ROLE_ADMIN,
    ROLE_CONTROL_DESK,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_QUALIDADE,
    ROLE_SUPERVISOR,
    get_role_permissions,
)

PASTA = API_DIR.parents[1] / "infra" / "sql" / "migrations"


def test_migration_v076_coincide_com_o_codigo():
    from rh_api.repositories import equipes_admin_schema as s

    assert (PASTA / "V076__equipes_admin.sql").read_text(encoding="utf-8") == s.render_migration_sql()
    assert (PASTA / "V076__equipes_admin.rollback.sql").read_text(encoding="utf-8") == s.render_rollback_sql()


def test_migration_e_aditiva_e_so_ascii():
    from rh_api.repositories import equipes_admin_schema as s

    sql = s.render_migration_sql()
    assert sql.isascii()
    assert "DROP " not in sql.upper().replace("DROP COLUMN", "")
    assert "id_supervisor" in sql and "id_apoio" in sql


def test_permissoes_novas_no_catalogo():
    for chave in ("equipes.visualizar", "equipes.administrar", "equipes.mover", "equipes.exportar"):
        assert chave in PERMISSION_DEFINITIONS


@pytest.mark.parametrize(
    ("perfil", "esperadas"),
    [
        (ROLE_ADMIN, {"equipes.visualizar", "equipes.administrar", "equipes.mover", "equipes.exportar"}),
        (ROLE_CONTROL_DESK, {"equipes.visualizar", "equipes.administrar", "equipes.mover", "equipes.exportar"}),
        (ROLE_SUPERVISOR, {"equipes.visualizar", "equipes.mover", "equipes.exportar"}),
        (ROLE_MANAGER, {"equipes.visualizar", "equipes.exportar"}),
        (ROLE_QUALIDADE, {"equipes.visualizar"}),
        (ROLE_OPERATOR, set()),
    ],
)
def test_valores_iniciais_por_perfil(perfil, esperadas):
    novas = {"equipes.visualizar", "equipes.administrar", "equipes.mover", "equipes.exportar"}
    assert get_role_permissions(perfil) & novas == esperadas


def test_rotas_registradas():
    from rh_api.main import app

    caminhos = {(m, r.path) for r in app.routes for m in getattr(r, "methods", set())}
    for item in [("GET", "/equipes-admin"), ("POST", "/equipes-admin"), ("PUT", "/equipes-admin/{id_equipe}"),
                 ("GET", "/equipes-admin/exportar"), ("GET", "/equipes-admin/{id_equipe}/membros"),
                 ("DELETE", "/equipes-admin/{id_equipe}"), ("POST", "/equipes-admin/mover/previa"), ("POST", "/equipes-admin/mover")]:
        assert item in caminhos


def _repo():
    from rh_api.repositories.equipes_admin import EquipesAdminRepositoryMixin

    class Repo(EquipesAdminRepositoryMixin):
        def _connect(self):  # nenhuma validação abaixo pode chegar ao banco
            raise AssertionError("não devia abrir conexão")

    return Repo()


def _user(perfil=ROLE_ADMIN):
    return SimpleNamespace(perfil=perfil, operacoes=["crf"], id_usuario=1, nome="Teste", username="teste", has_permission=lambda _c: True)


@pytest.mark.parametrize(
    ("dados", "trecho"),
    [({"nome": ""}, "nome da equipe"), ({"nome": "x" * 81}, "nome da equipe"), ({"nome": "Verde", "id_supervisor": 5, "id_apoio": 5}, "apoio")],
)
def test_salvar_valida_antes_do_banco(dados, trecho):
    with pytest.raises(HTTPException) as erro:
        _repo().eqa_salvar(_user(), dados)
    assert erro.value.status_code == 422
    assert trecho in erro.value.detail


def test_exportar_csv_uma_linha_por_operador_com_bom(monkeypatch):
    repo = _repo()
    equipes = [
        {"id_equipe": 1, "operacao_nome": "CRF", "nome": "Verde", "ativo": True, "supervisor_nome": "Rafael Costa", "apoio_nome": "", "turnos": ["MAN", "INT"]},
        {"id_equipe": 2, "operacao_nome": "CRF", "nome": "Azul", "ativo": False, "supervisor_nome": "", "apoio_nome": "", "turnos": []},
    ]
    monkeypatch.setattr(repo, "eqa_listar", lambda _u, _o="": {"equipes": equipes})

    class Cursor:
        def execute(self, *_a):
            self.description = [("id_equipe",), ("id_usuario",), ("nome",), ("sobrenome",), ("email",), ("perfil_id",)]

        def fetchall(self):
            return [(1, 10, "Ana", "Lima", "ana@x", ROLE_OPERATOR), (1, 11, "Bruno", "Sá", "b@x", ROLE_OPERATOR), (1, 12, "Rafael", "Costa", "r@x", ROLE_SUPERVISOR)]

    class Conn:
        def cursor(self):
            return Cursor()

        def close(self):
            pass

    monkeypatch.setattr(repo, "_connect", lambda: Conn())
    csv = repo.eqa_exportar_csv(_user())
    assert csv.startswith("﻿")
    linhas = csv.lstrip("﻿").strip().splitlines()
    assert linhas[0].startswith("Operação;Equipe;Situação")
    assert len(linhas) == 4  # cabeçalho + 2 operadores da Verde + Azul vazia (supervisor não entra como operador)
    assert "Ana Lima" in linhas[1] and "MAN · INT" in linhas[1]
    assert "Desativada" in linhas[3]

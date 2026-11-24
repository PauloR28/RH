"""Equipes na Tecnologia (24/nov/2026, V076): migration, permissões, rotas e validações que não dependem do banco."""

from __future__ import annotations

import sys
from datetime import date
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


def test_tabelas_usadas_existem_no_banco():
    """Bug de 24/11: o código usava dbo.monitoria_planos, mas a tabela é dbo.monitoria_planos_acao.
    Sem SQL Server nos testes, conferimos cada tabela citada contra os CREATE TABLE do projeto."""
    import re
    from pathlib import Path

    raiz = Path(__file__).resolve().parents[3]
    fonte = (raiz / "apps/backend/rh_api/repositories/equipes_admin.py").read_text(encoding="utf-8")
    ddl = "\n".join(
        p.read_text(encoding="utf-8", errors="ignore")
        for p in [*(raiz / "infra/sql/migrations").glob("V*.sql"), *(raiz / "apps/backend/rh_api/repositories").glob("*.py")]
        if "rollback" not in p.name
    )
    citadas = set(re.findall(r"dbo\.([a-z_]+)", fonte))
    faltando = sorted(t for t in citadas if t != "usuarios" and not re.search(rf"CREATE TABLE (?:dbo\.)?\[?{t}\]?\s*\(", ddl))
    assert not faltando, f"Tabelas que não existem: {faltando}"


class _Cursor:
    """Cursor de mentira: guarda o SQL e devolve respostas simples (sem banco)."""

    def __init__(self):
        self.sqls = []
        self._ultimo = ""

    def execute(self, sql, params=()):
        self.sqls.append((sql, params))
        self._ultimo = sql
        return self

    def fetchall(self):
        if "FROM dbo.wfm_escala_itens WHERE id_operador IN" in self._ultimo and "id_turno IN" not in self._ultimo:
            return [(101, "crf", 10, date(2030, 1, 2), 4), (102, "crf", 10, date(2030, 1, 3), 4)]
        return []

    def fetchone(self):
        if "OUTPUT INSERTED.id_turno" in self._ultimo:
            return (77,)
        if "SELECT operacao, codigo, nome FROM dbo.wfm_turnos" in self._ultimo:
            return ("crf", "MANHA", "Manhã")
        if "SELECT 1 FROM dbo.wfm_turnos" in self._ultimo:
            return None
        if "SELECT operacao, id_supervisor FROM dbo.wfm_turnos" in self._ultimo:
            return ("crf", 20)
        return (0,)


def _repo_mover(turnos):
    from rh_api.repositories.equipes_admin import EquipesAdminRepositoryMixin

    cursor = _Cursor()
    chamadas = []

    class Conn:
        def cursor(self):
            return cursor

        def commit(self):
            chamadas.append("commit")

        def rollback(self):
            chamadas.append("rollback")

        def close(self):
            pass

    class Repo(EquipesAdminRepositoryMixin):
        def _connect(self):
            return Conn()

        def _eqa_validar_movimento(self, cursor, user, ids, id_destino):
            return ({"id_equipe": 2, "nome": "Equipe Diogo", "operacao": "crf", "id_supervisor": 21, "supervisor_nome": "Diogo"},
                    [{"id_usuario": 10, "nome": "Ana", "sobrenome": "", "id_equipe": 1}])

        def _eqa_contagens(self, cursor, ids):
            return {}

        def _eqa_turnos_a_trocar(self, cursor, ids, destino):
            return turnos

        def wfm_audit(self, *a, **k):
            chamadas.append(("audit", k.get("acao")))

        def mon_log(self, *a, **k):
            chamadas.append(("log", k.get("acao")))

        def _wfm_invalidar_trocas(self, cursor, user, operacao, id_op, dia):
            chamadas.append(("invalidar", id_op, dia))

    return Repo(), cursor, chamadas


_TURNO = {"id_turno": 4, "rotulo": "MANHÃ 08:00–14:20 · Humberto", "dias": 2, "pessoas": 1, "ficam": 0, "id_dono": 20,
          "id_destino_auto": None, "opcoes": [{"id_turno": 9, "rotulo": "INT"}]}


def test_mover_levar_passa_o_turno_e_nao_mexe_na_escala(monkeypatch):
    monkeypatch.setattr("rh_api.repositories.equipes_admin.ensure_equipes_admin_schema", lambda c: None)
    repo, cursor, chamadas = _repo_mover([dict(_TURNO)])
    r = repo.eqa_mover(_user(), [10], 2, modo_escala="levar")
    assert r["dias_escala_trocados"] == 0 and "commit" in chamadas
    assert any("UPDATE dbo.wfm_turnos SET id_supervisor" in s and p[0] == 21 for s, p in cursor.sqls)
    assert not any("UPDATE dbo.wfm_escala_itens" in s or "DELETE FROM dbo.wfm_escala_itens" in s for s, _ in cursor.sqls)


def test_mover_levar_bloqueia_turno_de_quem_fica(monkeypatch):
    monkeypatch.setattr("rh_api.repositories.equipes_admin.ensure_equipes_admin_schema", lambda c: None)
    repo, cursor, chamadas = _repo_mover([{**_TURNO, "ficam": 3}])
    with pytest.raises(HTTPException) as erro:
        repo.eqa_mover(_user(), [10], 2, modo_escala="levar")
    assert erro.value.status_code == 409 and "rollback" in chamadas and "commit" not in chamadas
    assert not any("UPDATE dbo.usuarios" in s for s, _ in cursor.sqls)  # nada mudou antes do erro


def test_mover_manter_nao_mexe_em_turno_nem_escala(monkeypatch):
    monkeypatch.setattr("rh_api.repositories.equipes_admin.ensure_equipes_admin_schema", lambda c: None)
    repo, cursor, _ = _repo_mover([dict(_TURNO)])
    repo.eqa_mover(_user(), [10], 2, modo_escala="manter")
    assert not any("dbo.wfm_turnos" in s and "UPDATE" in s for s, _ in cursor.sqls)
    assert not any("wfm_escala_itens" in s and ("UPDATE" in s or "DELETE" in s) for s, _ in cursor.sqls)


def test_mover_outro_novo_copia_turno_e_personalizacoes(monkeypatch):
    monkeypatch.setattr("rh_api.repositories.equipes_admin.ensure_equipes_admin_schema", lambda c: None)
    repo, cursor, chamadas = _repo_mover([dict(_TURNO)])
    repo.eqa_mover(_user(), [10], 2, {4: "novo"}, modo_escala="outro")
    insert = next(p for s, p in cursor.sqls if "INSERT INTO dbo.wfm_turnos" in s)
    assert insert[0] == "MANHA-2" and insert[3] == 21
    assert any("INSERT INTO dbo.wfm_turno_personalizacoes" in s and p[0] == 77 for s, p in cursor.sqls)
    assert ("audit", "turno_copiar") in chamadas


def test_mover_outro_exige_turno(monkeypatch):
    monkeypatch.setattr("rh_api.repositories.equipes_admin.ensure_equipes_admin_schema", lambda c: None)
    repo, _, _ = _repo_mover([dict(_TURNO)])
    with pytest.raises(HTTPException) as erro:
        repo.eqa_mover(_user(), [10], 2, {}, modo_escala="outro")
    assert erro.value.status_code == 422


def test_mover_refazer_apaga_dias_futuros_e_invalida_trocas(monkeypatch):
    monkeypatch.setattr("rh_api.repositories.equipes_admin.ensure_equipes_admin_schema", lambda c: None)
    repo, cursor, chamadas = _repo_mover([dict(_TURNO)])
    r = repo.eqa_mover(_user(), [10], 2, modo_escala="refazer")
    assert r["dias_escala_apagados"] == 2
    assert sum("DELETE FROM dbo.wfm_escala_itens" in s for s, _ in cursor.sqls) == 2
    assert [c for c in chamadas if isinstance(c, tuple) and c[0] == "invalidar"] == [("invalidar", 10, date(2030, 1, 2)), ("invalidar", 10, date(2030, 1, 3))]


def test_mover_modo_invalido():
    with pytest.raises(HTTPException):
        _repo().eqa_mover(_user(), [10], 2, modo_escala="qualquer")


def test_schema_mover_aceita_modos_e_turno_novo():
    from rh_api.schemas.equipes import EquipeMoverRequest

    r = EquipeMoverRequest(ids_operadores=[1], id_equipe_destino=2, modo_escala="outro", turnos={"4": "novo", "5": "9"}, excluir_origem=True)
    assert r.turnos == {4: "novo", 5: 9} and r.excluir_origem

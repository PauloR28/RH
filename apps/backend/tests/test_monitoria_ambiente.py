"""Monitoria — canais por usuário e "Configurar ambiente" da operação (Correções.txt, 21/set/2026).

Integração contra o banco de DESENVOLVIMENTO (pulada sem banco / fora de dev). Os dados
de teste usam o prefixo `mon_teste_` e são removidos ao final."""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.auth import AuthenticatedUser
from rh_api.rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR, get_role_permissions
from rh_api.repositories.monitoria_schema import render_migration_ambiente_sql

PREFIXO = "mon_teste_"
REPO_ROOT = Path(__file__).resolve().parents[3]


def test_migration_v039_e_gerada_do_mesmo_ddl_do_bootstrap():
    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V039__monitoria_ambiente_canais.sql"
    assert arquivo.exists()
    assert arquivo.read_text(encoding="utf-8") == render_migration_ambiente_sql()


@pytest.fixture(scope="module")
def repo():
    try:
        from dotenv import load_dotenv

        load_dotenv(API_DIR.parents[1] / ".env")
    except Exception:
        pass
    ambiente = (os.getenv("RH_ENVIRONMENT") or os.getenv("ENVIRONMENT") or "dev").lower()
    if ambiente not in {"dev", "development", "local"}:
        pytest.skip("Testes de integração só rodam em ambiente de desenvolvimento.")
    try:
        from rh_api.config import get_settings
        from rh_api.repositories import DatabaseRepository

        r = DatabaseRepository(get_settings())
        conn = r._connect()
        conn.cursor().execute("SELECT COUNT(*) FROM dbo.operacoes_ambiente")
        conn.close()
    except Exception as exc:
        pytest.skip(f"Banco de desenvolvimento indisponível: {exc}")
    yield r
    conn = r._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE ?", (f"{PREFIXO}%",))
        for (id_usuario,) in cursor.fetchall():
            cursor.execute("DELETE FROM dbo.usuarios_canais WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (id_usuario, id_usuario))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
        cursor.execute("DELETE FROM dbo.operacoes_ambiente WHERE operacao LIKE ?", (f"{PREFIXO.upper()}%",))
        cursor.execute("DELETE FROM dbo.operacoes WHERE chave LIKE ?", (f"{PREFIXO.upper()}%",))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture()
def admin():
    return AuthenticatedUser(
        username="adm-teste", id_usuario=1, nome="Adm Teste", perfil=ROLE_ADMIN,
        permissions=frozenset(get_role_permissions(ROLE_ADMIN)),
    )


def _email() -> str:
    return f"{PREFIXO}{uuid.uuid4().hex[:10]}@example.com"


def _usuario(repo, admin, perfil, operacoes, **extra):
    return repo.mon_create_usuario(admin, {"nome": "Teste", "email": _email(), "perfil": perfil, "operacoes": operacoes, **extra})["id_usuario"]


def _nova_operacao(repo) -> str:
    chave = f"{PREFIXO.upper()}{uuid.uuid4().hex[:4].upper()}"
    repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": "Op Ambiente", "ativo": True})
    return chave


def test_canais_do_usuario_pertencem_a_operacao_dele(repo, admin):
    canal_crf = repo.mon_list_catalogo("canal", "CRF")[0]["id_item"]
    canal_outra = repo.mon_list_catalogo("canal", "DAVITA")[0]["id_item"]
    id_sup = _usuario(repo, admin, ROLE_SUPERVISOR, ["CRF"])
    id_op = _usuario(repo, admin, ROLE_OPERATOR, ["CRF"], supervisores=[id_sup], canais=[canal_crf])
    assert [c["id_item"] for c in repo.mon_get_vinculos(id_op)["canais"]] == [canal_crf]
    with pytest.raises(HTTPException) as erro:
        repo.mon_set_vinculos(admin, id_op, {"canais": [canal_outra]})
    assert erro.value.status_code == 422
    repo.mon_set_vinculos(admin, id_op, {"turno": "Tarde"})  # sem "canais" no payload: preserva
    assert [c["id_item"] for c in repo.mon_get_vinculos(id_op)["canais"]] == [canal_crf]
    repo.mon_set_vinculos(admin, id_op, {"canais": []})
    assert repo.mon_get_vinculos(id_op)["canais"] == []


def test_ambiente_vincula_supervisor_e_qualidade_e_conta_automaticamente(repo, admin):
    chave = _nova_operacao(repo)
    id_sup = _usuario(repo, admin, ROLE_SUPERVISOR, ["CRF"])
    id_qual = _usuario(repo, admin, ROLE_QUALIDADE, ["CRF"])

    with pytest.raises(HTTPException) as erro:  # Qualidade só com a flag ligada
        repo.mon_set_ambiente(admin, chave, {"qualidade": [id_qual]})
    assert erro.value.status_code == 422

    ambiente = repo.mon_set_ambiente(admin, chave, {"possui_qualidade": True, "supervisores": [id_sup], "qualidade": [id_qual]})
    assert ambiente["possui_qualidade"] is True
    assert ambiente["total_supervisores"] == 1 and ambiente["total_qualidade"] == 1
    assert chave in repo.mon_get_vinculos(id_sup)["operacoes"] and "CRF" in repo.mon_get_vinculos(id_sup)["operacoes"]

    ambiente = repo.mon_set_ambiente(admin, chave, {"possui_qualidade": False, "qualidade": []})
    assert ambiente["possui_qualidade"] is False and ambiente["total_qualidade"] == 0
    assert chave not in repo.mon_get_vinculos(id_qual)["operacoes"]


def test_ambiente_nao_remove_supervisor_que_ainda_supervisiona_operadores(repo, admin):
    chave = _nova_operacao(repo)
    id_sup = _usuario(repo, admin, ROLE_SUPERVISOR, [chave])
    _usuario(repo, admin, ROLE_OPERATOR, [chave], supervisores=[id_sup])
    with pytest.raises(HTTPException) as erro:
        repo.mon_set_ambiente(admin, chave, {"supervisores": []})
    assert erro.value.status_code == 422
    assert "Transferir supervisão" in erro.value.detail


def test_ambiente_atribui_intranet_a_uma_unica_operacao(repo, admin):
    chave = _nova_operacao(repo)
    outra = _nova_operacao(repo)
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO dbo.ambientes_sharepoint (nome, site_url) OUTPUT INSERTED.id_ambiente VALUES (?, ?)",
            (f"{PREFIXO}intranet", "https://exemplo.sharepoint.com/sites/teste"),
        )
        id_ambiente = int(cursor.fetchone()[0])
        conn.commit()
    finally:
        conn.close()
    try:
        ambiente = repo.mon_set_ambiente(admin, chave, {"intranets": [id_ambiente]})
        assert [i["id_ambiente"] for i in ambiente["intranets"] if i["vinculada"]] == [id_ambiente]
        mover = repo.mon_set_ambiente(admin, outra, {"intranets": [id_ambiente]})  # move para a outra operação
        assert [i["id_ambiente"] for i in mover["intranets"] if i["vinculada"]] == [id_ambiente]
        assert not [i for i in repo.mon_get_ambiente(admin, chave)["intranets"] if i["vinculada"]]
        repo.mon_set_ambiente(admin, outra, {"intranets": []})
        assert not [i for i in repo.mon_get_ambiente(admin, outra)["intranets"] if i["vinculada"]]
    finally:
        conn = repo._connect()
        try:
            conn.cursor().execute("DELETE FROM dbo.ambientes_sharepoint WHERE id_ambiente = ?", (id_ambiente,))
            conn.commit()
        finally:
            conn.close()

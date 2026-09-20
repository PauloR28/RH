"""Vertente Monitoria — testes de INTEGRAÇÃO contra o banco de DESENVOLVIMENTO.

Pulados automaticamente quando não há banco acessível (CI sem SQL Server) —
nunca rodam contra produção: exigem RH_ENVIRONMENT=dev (ou ausente). Os dados
de teste usam o prefixo `mon_teste_` e são removidos ao final; tabelas
imutáveis (monitorias, logs) mantêm seus registros por desenho."""

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
from rh_api.rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPERVISOR, get_role_permissions

PREFIXO = "mon_teste_"


def _carregar_env():
    try:
        from dotenv import load_dotenv

        load_dotenv(API_DIR.parents[1] / ".env")
    except Exception:
        pass


@pytest.fixture(scope="module")
def repo():
    _carregar_env()
    ambiente = (os.getenv("RH_ENVIRONMENT") or os.getenv("ENVIRONMENT") or "dev").lower()
    if ambiente not in {"dev", "development", "local"}:
        pytest.skip("Testes de integração só rodam em ambiente de desenvolvimento.")
    try:
        from rh_api.config import get_settings
        from rh_api.repositories import DatabaseRepository

        r = DatabaseRepository(get_settings())
        conn = r._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM dbo.monitoria_matrizes")
        conn.close()
    except Exception as exc:  # sem banco / schema ainda não criado
        pytest.skip(f"Banco de desenvolvimento indisponível: {exc}")
    yield r
    conn = r._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE ?", (f"{PREFIXO}%",))
        ids = [row[0] for row in cursor.fetchall()]
        for id_usuario in ids:
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (id_usuario, id_usuario))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
        cursor.execute("DELETE FROM dbo.equipes_operacao WHERE nome LIKE ?", (f"{PREFIXO}%",))
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


def _criar_supervisor(repo, admin, operacoes):
    return repo.mon_create_usuario(
        admin,
        {"nome": "Sup Teste", "email": _email(), "perfil": ROLE_SUPERVISOR, "operacoes": operacoes},
    )["id_usuario"]


def test_supervisor_respeita_limite_de_3_operacoes(repo, admin):
    with pytest.raises(HTTPException) as erro:
        _criar_supervisor(repo, admin, ["CRF", "DAVITA", "NEWE", "BRAVA"])
    assert erro.value.status_code == 422


def test_operador_exige_uma_operacao_e_supervisor_da_mesma_operacao(repo, admin):
    id_sup = _criar_supervisor(repo, admin, ["CRF"])
    with pytest.raises(HTTPException):  # duas operações
        repo.mon_create_usuario(
            admin,
            {"nome": "Op Teste", "email": _email(), "perfil": ROLE_OPERATOR, "operacoes": ["CRF", "NEWE"], "supervisores": [id_sup]},
        )
    with pytest.raises(HTTPException):  # supervisor de outra operação
        repo.mon_create_usuario(
            admin,
            {"nome": "Op Teste", "email": _email(), "perfil": ROLE_OPERATOR, "operacoes": ["DAVITA"], "supervisores": [id_sup]},
        )
    criado = repo.mon_create_usuario(
        admin,
        {"nome": "Op Teste", "email": _email(), "perfil": ROLE_OPERATOR, "operacoes": ["CRF"], "supervisores": [id_sup], "turno": "Tarde"},
    )
    vinculos = repo.mon_get_vinculos(criado["id_usuario"])
    assert vinculos["operacoes"] == ["CRF"]
    assert vinculos["turno"] == "Tarde"
    assert [s["id_usuario"] for s in vinculos["supervisores"]] == [id_sup]


def test_criacao_com_falha_nao_deixa_usuario_orfao(repo, admin):
    email = _email()
    with pytest.raises(HTTPException):
        repo.mon_create_usuario(
            admin,
            {"nome": "Op Falha", "email": email, "perfil": ROLE_OPERATOR, "operacoes": ["CRF"], "supervisores": [999999]},
        )
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM dbo.usuarios WHERE email = ?", (email,))
        assert cursor.fetchone()[0] == 0
    finally:
        conn.close()


def test_supervisor_nao_gerencia_fora_da_hierarquia_nem_de_outra_operacao(repo, admin):
    id_sup = _criar_supervisor(repo, admin, ["CRF"])
    ator = AuthenticatedUser(
        username="sup", id_usuario=id_sup, nome="Sup", perfil=ROLE_SUPERVISOR, operacoes=frozenset({"CRF"}),
        permissions=frozenset(get_role_permissions(ROLE_SUPERVISOR)),
    )
    with pytest.raises(HTTPException) as erro:  # não pode criar outro supervisor
        repo.mon_create_usuario(ator, {"nome": "X", "email": _email(), "perfil": ROLE_SUPERVISOR, "operacoes": ["CRF"]})
    assert erro.value.status_code == 403
    with pytest.raises(HTTPException) as erro:  # operador em operação fora do escopo
        repo.mon_create_usuario(
            ator,
            {"nome": "X", "email": _email(), "perfil": ROLE_OPERATOR, "operacoes": ["DAVITA"], "supervisores": [id_sup]},
        )
    assert erro.value.status_code in (403, 422)


def test_transferir_supervisao_move_operadores_e_desvincula(repo, admin):
    id_a = _criar_supervisor(repo, admin, ["CRF"])
    id_b = _criar_supervisor(repo, admin, ["CRF"])
    id_op = repo.mon_create_usuario(
        admin, {"nome": "Op", "email": _email(), "perfil": ROLE_OPERATOR, "operacoes": ["CRF"], "supervisores": [id_a]}
    )["id_usuario"]
    resultado = repo.mon_transferir_supervisao(admin, operacao="CRF", id_de=id_a, id_para=id_b, justificativa="férias")
    assert resultado["operadores_transferidos"] == 1
    assert [s["id_usuario"] for s in repo.mon_get_vinculos(id_op)["supervisores"]] == [id_b]
    assert repo.mon_get_vinculos(id_a)["operacoes"] == []  # perdeu acesso à operação


def test_equipe_nome_unico_por_operacao_e_operacao_inativa_bloqueia(repo, admin):
    nome = f"{PREFIXO}{uuid.uuid4().hex[:6]}"
    repo.mon_save_equipe(admin, {"operacao": "CRF", "nome": nome})
    with pytest.raises(HTTPException) as erro:
        repo.mon_save_equipe(admin, {"operacao": "CRF", "nome": nome.upper()})
    assert erro.value.status_code == 409

    chave = f"{PREFIXO.upper()}{uuid.uuid4().hex[:4].upper()}"
    repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": "Op Teste", "ativo": False})
    with pytest.raises(HTTPException) as erro:
        repo.mon_save_equipe(admin, {"operacao": chave, "nome": "qualquer"})
    assert erro.value.status_code == 409


def test_operacao_inativa_so_aceita_reativacao(repo, admin):
    chave = f"{PREFIXO.upper()}{uuid.uuid4().hex[:4].upper()}"
    id_item = repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": "Op Inativa", "ativo": True})["id_item"]
    repo.deactivate_configuration_item("operacoes", id_item)
    with pytest.raises(HTTPException) as erro:  # editar nome com a operação inativa
        repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": "Outro nome", "ativo": False}, id_item=id_item)
    assert erro.value.status_code == 409
    # reativar com outros campos alterados: só o status muda
    repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": "Outro nome", "ativo": True}, id_item=id_item)
    itens = {i["chave"]: i for i in repo.list_catalog_items_by_type("operacoes", apenas_ativos=False)}
    assert itens[chave]["nome"] == "Op Inativa"
    assert itens[chave]["chave"] == chave


def test_usuario_local_criado_pela_monitoria_fica_travado_ate_trocar_a_senha(repo, admin):
    from fastapi.testclient import TestClient

    from rh_api.main import app

    id_sup = _criar_supervisor(repo, admin, ["CRF"])
    email = _email()
    criado = repo.mon_create_usuario(
        admin,
        {"nome": "Op Local", "email": email, "perfil": ROLE_OPERATOR, "operacoes": ["CRF"], "supervisores": [id_sup],
         "provedor_autenticacao": "local", "senha": "Inicial@2026"},
    )
    cliente = TestClient(app)
    login = cliente.post("/auth/login", json={"usuario": email, "senha": "Inicial@2026"})
    assert login.status_code == 200, login.text
    corpo = login.json()
    assert corpo["deve_trocar_senha"] is True
    cab = {"Authorization": f"Bearer {corpo['access_token']}"}
    bloqueada = cliente.get("/monitoria/contexto", headers=cab)
    assert bloqueada.status_code == 403 and "TROCA_SENHA_OBRIGATORIA" in bloqueada.text

    troca = cliente.post("/auth/me/senha-inicial", json={"senha_atual": "Inicial@2026", "nova_senha": "Nova@Senha2026"}, headers=cab)
    assert troca.status_code == 200, troca.text
    assert troca.json()["deve_trocar_senha"] is False
    liberado = cliente.get("/monitoria/contexto", headers={"Authorization": f"Bearer {troca.json()['access_token']}"})
    assert liberado.status_code == 200
    assert criado["id_usuario"]


def test_operador_sem_vinculo_continua_bloqueado_na_web(repo, admin):
    from fastapi.testclient import TestClient

    from rh_api.main import app

    email = _email()
    repo.create_system_user(
        {"nome": "Op Sem Vinculo", "email": email, "login": email, "perfil": ROLE_OPERATOR, "provedor_autenticacao": "local", "senha": "Senha@12345"},
        actor=admin,
    )
    resposta = TestClient(app).post("/auth/login", json={"usuario": email, "senha": "Senha@12345"})
    assert resposta.status_code == 403

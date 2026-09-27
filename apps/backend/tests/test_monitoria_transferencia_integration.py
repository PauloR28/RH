"""QA T2-TRC-02/03: transferência de Operador e Supervisor entre operações
(integração contra o banco de desenvolvimento; pulado sem banco)."""

from __future__ import annotations

import uuid

import pytest
from _integracao_dev import repositorio_dev
from fastapi import HTTPException
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPERVISOR, get_role_permissions

PREFIXO = "transf_teste_"
OP_A, OP_B = "TESTE_TRF_A", "TESTE_TRF_B"


@pytest.fixture(scope="module")
def repo():
    r = repositorio_dev()
    yield r
    conn = r._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE ?", (f"{PREFIXO}%",))
        for (id_usuario,) in cursor.fetchall():
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (id_usuario, id_usuario))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
        cursor.execute("UPDATE dbo.operacoes SET ativo = 0 WHERE chave IN (?, ?)", (OP_A, OP_B))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="module")
def admin():
    return AuthenticatedUser(
        username="Adm", id_usuario=1, nome="Adm", perfil=ROLE_ADMIN, operacoes=frozenset(),
        permissions=frozenset(get_role_permissions(ROLE_ADMIN)),
    )


@pytest.fixture()
def cenario(repo, admin):
    for chave in (OP_A, OP_B):
        conn = repo._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM dbo.operacoes WHERE chave = ?", (chave,))
            existe = cursor.fetchone()
            cursor.execute("UPDATE dbo.operacoes SET ativo = 1 WHERE chave = ?", (chave,))
            conn.commit()
        finally:
            conn.close()
        if not existe:
            repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": f"Operação {chave}", "ativo": True})

    def usuario(perfil, **extra):
        email = f"{PREFIXO}{uuid.uuid4().hex[:10]}@example.com"
        return repo.mon_create_usuario(admin, {"nome": f"{PREFIXO}{perfil}", "email": email, "perfil": perfil, **extra})["id_usuario"]

    sup_a = usuario(ROLE_SUPERVISOR, operacoes=[OP_A])
    sup_a2 = usuario(ROLE_SUPERVISOR, operacoes=[OP_A])
    sup_b = usuario(ROLE_SUPERVISOR, operacoes=[OP_B])
    op = usuario(ROLE_OPERATOR, operacoes=[OP_A], supervisores=[sup_a])
    return {"sup_a": sup_a, "sup_a2": sup_a2, "sup_b": sup_b, "op": op}


def test_operador_muda_de_operacao_com_novo_supervisor(repo, admin, cenario):
    with pytest.raises(HTTPException) as erro:
        repo.mon_transferir_operacao(admin, cenario["op"], origem=OP_A, destino=OP_B, supervisores=[cenario["sup_a"]])
    assert "destino" in erro.value.detail  # supervisor precisa ser da operação de destino

    resultado = repo.mon_transferir_operacao(admin, cenario["op"], origem=OP_A, destino=OP_B, supervisores=[cenario["sup_b"]])
    vinculos = resultado["vinculos"]
    assert vinculos["operacoes"] == [OP_B]
    assert [s["id_usuario"] for s in vinculos["supervisores"]] == [cenario["sup_b"]]


def test_supervisor_muda_de_operacao_e_equipe_fica_com_substituto(repo, admin, cenario):
    with pytest.raises(HTTPException) as erro:
        repo.mon_transferir_operacao(admin, cenario["sup_a"], origem=OP_A, destino=OP_B)
    assert "Escolha quem assume" in erro.value.detail

    resultado = repo.mon_transferir_operacao(
        admin, cenario["sup_a"], origem=OP_A, destino=OP_B, id_substituto=cenario["sup_a2"], justificativa="Mudou de operação"
    )
    assert resultado["vinculos"]["operacoes"] == [OP_B]
    assert resultado["operadores_reatribuidos"] == 1
    assert repo.mon_operadores_supervisionados(cenario["sup_a2"]) == {cenario["op"]}
    assert repo.mon_operadores_supervisionados(cenario["sup_a"]) == set()


def test_transferencia_invalida(repo, admin, cenario):
    with pytest.raises(HTTPException):
        repo.mon_transferir_operacao(admin, cenario["op"], origem=OP_B, destino=OP_A, supervisores=[cenario["sup_a"]])
    with pytest.raises(HTTPException):
        repo.mon_transferir_operacao(admin, cenario["op"], origem=OP_A, destino=OP_A, supervisores=[cenario["sup_a"]])

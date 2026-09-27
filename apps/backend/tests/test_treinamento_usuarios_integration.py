"""QA T2-TRE-01: treinamento atribuído a usuários do sistema e a operações
inteiras (integração contra o banco de desenvolvimento; pulado sem banco)."""

from __future__ import annotations

import uuid

import pytest
from _integracao_dev import repositorio_dev
from fastapi import HTTPException
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPERVISOR, get_role_permissions

PREFIXO = "trein_teste_"
OP = "TESTE_TREIN"


def _email() -> str:
    return f"{PREFIXO}{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(scope="module")
def repo():
    r = repositorio_dev()
    yield r
    conn = r._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE ?", (f"{PREFIXO}%",))
        ids = [row[0] for row in cursor.fetchall()]
        for id_usuario in ids:
            cursor.execute(
                "DELETE FROM dbo.onboarding_candidatos_itens WHERE onboarding_candidato_id IN "
                "(SELECT id_onboarding FROM dbo.onboarding_candidatos WHERE id_usuario = ?)",
                (id_usuario,),
            )
            cursor.execute("DELETE FROM dbo.onboarding_candidatos WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (id_usuario, id_usuario))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
        cursor.execute("DELETE FROM dbo.trilhas_onboarding_itens WHERE trilha_id IN (SELECT id_trilha FROM dbo.trilhas_onboarding WHERE nome LIKE ?)", (f"{PREFIXO}%",))
        cursor.execute("DELETE FROM dbo.trilhas_onboarding WHERE nome LIKE ?", (f"{PREFIXO}%",))
        cursor.execute("UPDATE dbo.operacoes SET ativo = 0 WHERE chave = ?", (OP,))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="module")
def cenario(repo):
    admin = AuthenticatedUser(
        username="Adm", id_usuario=1, nome="Adm", perfil=ROLE_ADMIN, operacoes=frozenset(),
        permissions=frozenset(get_role_permissions(ROLE_ADMIN)),
    )
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_item FROM dbo.operacoes WHERE chave = ?", (OP,))
        existe = cursor.fetchone()
        if existe:
            cursor.execute("UPDATE dbo.operacoes SET ativo = 1 WHERE chave = ?", (OP,))
            conn.commit()
    finally:
        conn.close()
    if not existe:
        repo.upsert_configuration_item("operacoes", {"chave": OP, "nome": "Operação Teste Treinamento", "ativo": True})

    def usuario(perfil, **extra):
        email = _email()
        id_usuario = repo.mon_create_usuario(admin, {"nome": f"{PREFIXO}{perfil}", "email": email, "perfil": perfil, **extra})["id_usuario"]
        return id_usuario, email

    sup, sup_email = usuario(ROLE_SUPERVISOR, operacoes=[OP])
    op1, op1_email = usuario(ROLE_OPERATOR, operacoes=[OP], supervisores=[sup])
    op2, op2_email = usuario(ROLE_OPERATOR, operacoes=[OP], supervisores=[sup])
    trilha = repo.create_onboarding_trilha(
        {
            "nome": f"{PREFIXO}Treinamento",
            "categoria": "Operações",
            "itens": [{"titulo": "Módulo 1", "tipo_conteudo": "texto", "texto_principal": "Olá"}],
        },
        actor="teste",
    )
    return {"sup": (sup, sup_email), "op1": (op1, op1_email), "op2": (op2, op2_email), "trilha": int(trilha["id_trilha"])}


def test_busca_traz_usuarios_do_sistema(repo, cenario):
    resultado = repo.search_participantes_treinamento(PREFIXO)
    ids = {u["id_usuario"] for u in resultado["usuarios"]}
    assert {cenario["op1"][0], cenario["op2"][0], cenario["sup"][0]} <= ids


def test_operacoes_listam_total_de_usuarios(repo, cenario):
    operacoes = {o["chave"]: o for o in repo.list_operacoes_para_treinamento()}
    assert operacoes[OP]["total_usuarios"] >= 3


def test_atribuir_por_operacao_e_meus_treinamentos(repo, cenario):
    resultado = repo.atribuir_treinamento_usuarios(cenario["trilha"], operacoes=[OP], actor="teste")
    assert resultado["atribuicoes_criadas"] >= 3
    # Repetir não duplica: quem já tem em aberto vira falha.
    repetido = repo.atribuir_treinamento_usuarios(cenario["trilha"], ids_usuarios=[cenario["op1"][0]], actor="teste")
    assert repetido["atribuicoes_criadas"] == 0 and len(repetido["falhas"]) == 1

    meus = repo.get_my_trainings(cenario["op1"][1])
    assert [t["trilha_id"] for t in meus] == [cenario["trilha"]]
    modulo = meus[0]["modulos"][0]
    progresso = repo.complete_my_training_item(cenario["op1"][1], modulo["id_onboarding_item"], actor="op1")
    assert progresso["itens_concluidos"] == 1

    # Outro operador não pode concluir o módulo do op1.
    with pytest.raises(HTTPException) as erro:
        repo.complete_my_training_item(cenario["op2"][1], modulo["id_onboarding_item"], actor="op2")
    assert erro.value.status_code == 403


def test_gestao_lista_atribuicao_de_usuario_com_nome(repo, cenario):
    atribuicoes = [a for a in repo.list_onboarding_assignments() if a.get("id_usuario") == cenario["op2"][0]]
    assert atribuicoes and atribuicoes[0]["nome_candidato"] == f"{PREFIXO}{ROLE_OPERATOR}"
    assert atribuicoes[0]["vaga"] == "Colaborador"
    atualizado = repo.update_onboarding_assignment(atribuicoes[0]["id_onboarding"], {"status": "em_andamento"})
    assert atualizado["candidato"]["id_usuario"] == cenario["op2"][0]
    relatorio = [r for r in repo.report_presenca_colaborador() if r.get("id_usuario") == cenario["op2"][0]]
    assert relatorio and relatorio[0]["total_treinamentos"] == 1

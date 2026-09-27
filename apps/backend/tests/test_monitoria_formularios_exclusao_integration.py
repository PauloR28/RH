"""Formulários duplicáveis/versões (G1/G2) e exclusão lógica de monitoria (G3)
(integração contra o banco de desenvolvimento; pulados sem banco)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from test_monitoria_fluxo_integration import (  # noqa: F401  (fixtures reaproveitadas)
    OP,
    _criar,
    _sem_emails,
    admin,
    cenario,
    repo,
)


def _config_com_peso_trocado(config: dict) -> dict:
    nova = {**config, "blocos": [dict(b, criterios=[dict(c) for c in b["criterios"]]) for b in config["blocos"]]}
    bloco = nova["blocos"][0]
    bloco["nome"] = f"{bloco['nome']} (revisado)"
    return nova


def test_duplicar_editar_copia_ativar_e_restaurar(repo, admin, cenario):  # noqa: F811 (fixtures importadas)
    ativo = repo.mon_get_matriz(admin, OP)["versao_ativa"]
    antes = {f["id_matriz"] for f in repo.mon_list_formularios(admin, OP)}

    copia = repo.mon_duplicar_formulario(admin, OP, id_versao=ativo["id_versao"], nome="Cópia de teste")
    formularios = {f["id_matriz"]: f for f in repo.mon_list_formularios(admin, OP)}
    assert copia["id_matriz"] not in antes and formularios[copia["id_matriz"]]["ativo"] is False
    assert formularios[copia["id_matriz"]]["origem"].endswith(f"v{ativo['numero']}")

    # Editar a cópia cria versão na cópia; o formulário ativo da operação não muda.
    config = repo.mon_get_versao(admin, copia["id_versao"])["config"]
    nova = repo.mon_save_versao(admin, OP, _config_com_peso_trocado(config), "ajuste", id_matriz=copia["id_matriz"])
    assert nova["numero"] == 2
    assert repo.mon_get_matriz(admin, OP)["versao_ativa"]["id_versao"] == ativo["id_versao"]
    versoes = repo.mon_list_versoes(admin, OP, copia["id_matriz"])
    assert [v["numero"] for v in versoes] == [2, 1]

    # Restaurar a v1 cria a v3 com o conteúdo da v1.
    restaurada = repo.mon_restaurar_versao(admin, versoes[1]["id_versao"])
    assert restaurada["numero"] == 3
    assert repo.mon_get_versao(admin, restaurada["id_versao"])["config"] == config

    # Ativar a cópia: novas monitorias usam o formulário copiado.
    repo.mon_ativar_formulario(admin, OP, copia["id_matriz"])
    try:
        assert repo.mon_get_matriz(admin, OP)["versao_ativa"]["id_matriz"] == copia["id_matriz"]
        r = _criar(repo, cenario)
        detalhe = repo.mon_detalhe(admin, r["codigo"])
        assert detalhe["id_monitoria"] == r["id_monitoria"]
    finally:
        repo.mon_ativar_formulario(admin, OP, ativo["id_matriz"])


def test_exclusao_logica_somente_admin_esconde_e_restaura(repo, admin, cenario):  # noqa: F811 (fixtures importadas)
    r = _criar(repo, cenario)
    qual = cenario["qual"]
    with pytest.raises(HTTPException) as erro:
        repo.mon_excluir_monitoria(qual, r["codigo"], motivo="Teste de exclusão", confirmacao=r["codigo"])
    assert erro.value.status_code == 403
    with pytest.raises(HTTPException):
        repo.mon_excluir_monitoria(admin, r["codigo"], motivo="Teste de exclusão", confirmacao="00000000")

    repo.mon_excluir_monitoria(admin, r["codigo"], motivo="Monitoria lançada por engano", confirmacao=r["codigo"])
    # Some da lista, do detalhe (para quem não é Admin) e das ações de fluxo.
    lista = repo.mon_listar(qual, {}, pagina=1, por_pagina=200)
    assert r["id_monitoria"] not in {i["id_monitoria"] for i in lista["itens"]}
    with pytest.raises(HTTPException) as erro:
        repo.mon_detalhe(qual, r["codigo"])
    assert erro.value.status_code == 404
    assert repo.mon_detalhe(admin, r["codigo"])["excluida"]["motivo"] == "Monitoria lançada por engano"
    with pytest.raises(HTTPException):
        repo.mon_aplicar_feedback(qual, r["codigo"], {"observacao": "x"})
    assert r["id_monitoria"] in {i["id_monitoria"] for i in repo.mon_list_excluidas(admin)}

    repo.mon_restaurar_monitoria(admin, r["id_monitoria"], motivo="Engano desfeito")
    assert repo.mon_detalhe(qual, r["codigo"])["excluida"] is None

    # O registro permanente fica em monitoria_logs.
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT acao FROM dbo.monitoria_logs WHERE entidade = 'monitoria' AND entidade_id = ? AND acao IN ('excluir_monitoria', 'restaurar_monitoria')",
            (str(r["id_monitoria"]),),
        )
        assert sorted(row[0] for row in cursor.fetchall()) == ["excluir_monitoria", "restaurar_monitoria"]
    finally:
        conn.close()

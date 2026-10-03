"""Modularização, Etapa 4: a configuração do WFM no banco de DESENVOLVIMENTO (semeio, alteração, persistência).
Remove a linha ao final: o ambiente volta ao estado em que estava."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.services import acesso


@pytest.fixture()
def linha(monkeypatch):
    repo = repositorio_dev()

    def sql(texto, *params):
        conn = repo._connect()
        try:
            cur = conn.cursor()
            cur.execute(texto, params)
            achados = cur.fetchall() if cur.description else None
            conn.commit()
            return achados
        finally:
            conn.close()

    original = sql("SELECT valor, categoria FROM dbo.parametros_sistema WHERE chave = ?", acesso.PARAM_WFM_PARTICIPANTES)
    sql("DELETE FROM dbo.parametros_sistema WHERE chave = ?", acesso.PARAM_WFM_PARTICIPANTES)
    acesso.invalidar_cache_wfm()
    acesso._wfm_log_emitido = False
    yield sql
    sql("DELETE FROM dbo.parametros_sistema WHERE chave = ?", acesso.PARAM_WFM_PARTICIPANTES)
    if original:
        sql(
            "INSERT INTO dbo.parametros_sistema (chave, valor, categoria, mascarado, atualizado_por) VALUES (?, ?, ?, 0, 'teste')",
            acesso.PARAM_WFM_PARTICIPANTES, original[0][0], original[0][1],
        )
    acesso.invalidar_cache_wfm()
    acesso._wfm_log_emitido = False


@pytest.mark.parametrize("env,esperado", [("1", "1"), ("", "0"), ("0", "0")])
def test_linha_nasce_com_o_valor_atual_do_ambiente(linha, monkeypatch, env, esperado):
    monkeypatch.setenv(acesso.VAR_AMBIENTE_WFM, env)
    acesso.wfm_participantes_liberado()
    registro = linha("SELECT valor, categoria FROM dbo.parametros_sistema WHERE chave = ?", acesso.PARAM_WFM_PARTICIPANTES)
    assert registro and registro[0][0] == esperado and registro[0][1] == "sistema_interno"


def test_sem_variavel_e_sem_linha_comeca_fechado_e_o_botao_persiste(linha, monkeypatch):
    monkeypatch.delenv(acesso.VAR_AMBIENTE_WFM, raising=False)
    assert acesso.wfm_participantes_liberado() is False
    assert linha("SELECT valor FROM dbo.parametros_sistema WHERE chave = ?", acesso.PARAM_WFM_PARTICIPANTES)[0][0] == "0"
    resultado = acesso.definir_wfm_participantes(True, autor="teste")
    assert resultado == {"valor_anterior": False, "valor": True}
    assert acesso.wfm_participantes_liberado() is True
    assert tuple(linha("SELECT valor, atualizado_por FROM dbo.parametros_sistema WHERE chave = ?", acesso.PARAM_WFM_PARTICIPANTES)[0]) == ("1", "teste")
    acesso.definir_wfm_participantes(False, autor="teste")
    assert acesso.wfm_participantes_liberado() is False


def test_botao_recusa_com_variavel_definida(linha, monkeypatch):
    monkeypatch.setenv(acesso.VAR_AMBIENTE_WFM, "1")
    with pytest.raises(HTTPException) as erro:
        acesso.definir_wfm_participantes(False, autor="teste")
    assert erro.value.status_code == 409


def test_a_tela_de_parametros_nao_lista_a_configuracao(linha, monkeypatch):
    monkeypatch.delenv(acesso.VAR_AMBIENTE_WFM, raising=False)
    acesso.wfm_participantes_liberado()
    repo = repositorio_dev()
    listados = repo.list_parametros_sistema() if hasattr(repo, "list_parametros_sistema") else None
    if listados is None:
        pytest.skip("listagem de parâmetros não encontrada neste repositório")
    chaves = {p.get("chave") for p in (listados.get("itens") if isinstance(listados, dict) else listados)}
    assert acesso.PARAM_WFM_PARTICIPANTES not in chaves

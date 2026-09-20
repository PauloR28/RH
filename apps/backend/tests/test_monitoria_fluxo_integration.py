"""Vertente Monitoria — realização, imutabilidade, fluxo, SLA e isolamento
(integração contra o banco de DESENVOLVIMENTO; pulados sem banco).

Usa a operação de teste TESTE_AUTO (criada aqui, desativada no final). As
tabelas imutáveis mantêm suas linhas por desenho — só existem em dev."""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pyodbc
import pytest
from fastapi import HTTPException

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.auth import AuthenticatedUser
from rh_api.rbac import (
    ROLE_ADMIN,
    ROLE_OPERATOR,
    ROLE_QUALIDADE,
    ROLE_SUPERVISOR,
    get_role_permissions,
)
from rh_api.services.monitoria_engine import config_padrao

PREFIXO = "mon_teste_"
OP = "TESTE_AUTO"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _carregar_env():
    try:
        from dotenv import load_dotenv

        load_dotenv(API_DIR.parents[1] / ".env")
    except Exception:
        pass


def _email() -> str:
    return f"{PREFIXO}{uuid.uuid4().hex[:10]}@example.com"


def _ator(perfil, id_usuario, operacoes=(), nome="Ator"):
    return AuthenticatedUser(
        username=nome, id_usuario=id_usuario, nome=nome, perfil=perfil, operacoes=frozenset(operacoes),
        permissions=frozenset(get_role_permissions(perfil)),
    )


@pytest.fixture(autouse=True)
def _sem_emails(monkeypatch):
    from rh_api.repositories import DatabaseRepository

    monkeypatch.setattr(DatabaseRepository, "_mon_enviar_emails", lambda *a, **k: None)


@pytest.fixture(scope="module")
def repo():
    _carregar_env()
    if (os.getenv("RH_ENVIRONMENT") or os.getenv("ENVIRONMENT") or "dev").lower() not in {"dev", "development", "local"}:
        pytest.skip("Testes de integração só rodam em ambiente de desenvolvimento.")
    try:
        from rh_api.config import get_settings
        from rh_api.repositories import DatabaseRepository

        r = DatabaseRepository(get_settings())
        conn = r._connect()
        conn.cursor().execute("SELECT COUNT(*) FROM dbo.monitoria_matrizes")
        conn.close()
    except Exception as exc:
        pytest.skip(f"Banco de desenvolvimento indisponível: {exc}")
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
        cursor.execute("DELETE FROM dbo.notificacoes WHERE destinatario_usuario LIKE ?", (f"{PREFIXO}%",))
        cursor.execute("UPDATE dbo.operacoes SET ativo = 0 WHERE chave = ?", (OP,))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="module")
def admin():
    return _ator(ROLE_ADMIN, 1, nome="Adm Teste")


@pytest.fixture(scope="module")
def cenario(repo, admin):
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_item FROM dbo.operacoes WHERE chave = ?", (OP,))
        row = cursor.fetchone()
        if row:
            cursor.execute("UPDATE dbo.operacoes SET ativo = 1 WHERE chave = ?", (OP,))
            conn.commit()
    finally:
        conn.close()
    if not row:
        repo.upsert_configuration_item("operacoes", {"chave": OP, "nome": "Operação de Teste Automatizado", "ativo": True})
    for tipo, valor in (("canal", "Telefone"), ("tipo_atendimento", "Dúvida")):
        if valor not in {i["valor"] for i in repo.mon_list_catalogo(tipo, OP)}:
            repo.mon_save_catalogo(admin, {"tipo": tipo, "operacao": OP, "valor": valor})

    def usuario(perfil, **extra):
        return repo.mon_create_usuario(admin, {"nome": perfil.title(), "email": _email(), "perfil": perfil, **extra})["id_usuario"]

    sup1 = usuario(ROLE_SUPERVISOR, operacoes=[OP])
    sup2 = usuario(ROLE_SUPERVISOR, operacoes=[OP])
    qual = usuario(ROLE_QUALIDADE, operacoes=[OP])
    op1 = usuario(ROLE_OPERATOR, operacoes=[OP], supervisores=[sup1])
    op2 = usuario(ROLE_OPERATOR, operacoes=[OP], supervisores=[sup2])
    sup_crf = usuario(ROLE_SUPERVISOR, operacoes=["CRF"])
    return {
        "sup1": _ator(ROLE_SUPERVISOR, sup1, [OP], "Sup1"),
        "sup2": _ator(ROLE_SUPERVISOR, sup2, [OP], "Sup2"),
        "qual": _ator(ROLE_QUALIDADE, qual, [OP], "Qual"),
        "op1": _ator(ROLE_OPERATOR, op1, [OP], "Op1"),
        "op2": _ator(ROLE_OPERATOR, op2, [OP], "Op2"),
        "sup_crf": _ator(ROLE_SUPERVISOR, sup_crf, ["CRF"], "SupCRF"),
    }


def _respostas(valor="SIM", **excecoes):
    config = config_padrao()
    resp = {c["id"]: valor for b in config["blocos"] for c in b["criterios"]}
    resp.update(excecoes)
    return resp


def _pilares():
    return {"conhecimento": {"Agilidade": 8, "Segurança": 9, "Complexidade": 7},
            "encantamento": {"Empatia": 10, "Conformidade": 9, "Experiência": 8}}


def _dados(cenario, **extra):
    base = {
        "operacao": OP, "id_operador": cenario["op1"].id_usuario, "canal": "Telefone", "tipo_atendimento": "Dúvida",
        "data_contato": "2026-09-19", "respostas": _respostas(), "pilares": _pilares(),
        "observacao": "Obs", "sugestao_feedback": "Elogiar a saudação",
    }
    base.update(extra)
    return base


def _criar(repo, cenario, ator=None, **extra):
    return repo.mon_criar_monitoria(ator or cenario["qual"], _dados(cenario, **extra))


def _sql(repo, sql, params=()):
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Realização
# ---------------------------------------------------------------------------
def test_realizar_monitoria_gera_id_de_8_digitos_snapshot_e_fluxo_inicial(repo, cenario):
    versao_ativa = repo.mon_get_matriz(cenario["qual"], OP)["versao_ativa"]["numero"]
    r = _criar(repo, cenario)
    assert len(r["codigo"]) == 8 and r["codigo"].isdigit()
    assert r["nota"] == 100.0 and r["nivel"] == "Excelência" and r["blocos_avaliados"] == 8
    detalhe = repo.mon_detalhe(cenario["qual"], r["codigo"])
    assert detalhe["status"] == "FEEDBACK_PENDENTE" and detalhe["numero_versao"] == versao_ativa
    assert [e["para"] for e in detalhe["eventos"]] == ["REALIZADA", "FEEDBACK_PENDENTE"]
    assert detalhe["pilar_conhecimento"] == 8.0 and detalhe["pilar_encantamento"] == 9.0
    assert len(detalhe["config"]["blocos"]) == 8  # snapshot completo da matriz
    assert detalhe["sla"]["tipo"] == "FEEDBACK" and detalhe["sla"]["restante_h"] > 70


def test_ids_de_monitoria_sao_unicos(repo, cenario):
    codigos = {_criar(repo, cenario)["codigo"] for _ in range(3)}
    assert len(codigos) == 3


def test_validacoes_de_realizacao(repo, cenario):
    incompleto = _respostas()
    del incompleto["b1c1"]
    with pytest.raises(HTTPException) as e:
        _criar(repo, cenario, respostas=incompleto)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):  # NCG exige motivo
        _criar(repo, cenario, respostas=_respostas(b1c1="NCG"))
    with pytest.raises(HTTPException):  # canal fora do catálogo
        _criar(repo, cenario, canal="Pombo-correio")
    with pytest.raises(HTTPException):  # pilar fora da escala
        _criar(repo, cenario, pilares={"conhecimento": {"Agilidade": 11, "Segurança": 9, "Complexidade": 7}, "encantamento": _pilares()["encantamento"]})
    with pytest.raises(HTTPException) as e:  # data futura
        _criar(repo, cenario, data_contato="2999-01-01")
    assert e.value.status_code == 422


def test_ncg_zera_a_nota_mas_segue_o_fluxo(repo, cenario):
    r = _criar(repo, cenario, respostas=_respostas(b4c1="NCG"), motivo_ncg="Ofensa ao cliente")
    assert r["nota"] == 0.0 and r["possui_ncg"] is True and r["anulada"] is False
    assert repo.mon_detalhe(cenario["qual"], r["codigo"])["status"] == "FEEDBACK_PENDENTE"


def test_menos_de_3_blocos_anula_com_justificativa_obrigatoria(repo, cenario):
    resp = _respostas(**{f"b{i}c1": "NA" for i in range(1, 7)})
    with pytest.raises(HTTPException) as e:
        _criar(repo, cenario, respostas=resp)
    assert "justificativa" in e.value.detail.lower()
    r = _criar(repo, cenario, respostas=resp, justificativa_anulacao="Atendimento sem dados suficientes")
    assert r["anulada"] is True
    detalhe = repo.mon_detalhe(cenario["qual"], r["codigo"])
    assert [e["para"] for e in detalhe["eventos"]] == ["REALIZADA", "ANULADA", "FINALIZADA"]
    assert detalhe["sla"] is None and detalhe["resultado"] == "ANULADA"


def test_regras_de_quem_pode_realizar(repo, cenario):
    with pytest.raises(HTTPException) as e:  # supervisor de outro operador
        _criar(repo, cenario, ator=cenario["sup2"])
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):  # supervisor de outra operação
        _criar(repo, cenario, ator=cenario["sup_crf"])
    assert _criar(repo, cenario, ator=cenario["sup1"])["codigo"]  # supervisor responsável pode


# ---------------------------------------------------------------------------
# Imutabilidade (3 camadas: modelo sem update, trigger, versionamento)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("tabela", ["monitorias", "monitoria_respostas", "monitoria_pilares", "monitoria_eventos", "monitoria_logs"])
def test_trigger_bloqueia_update_e_delete_direto(repo, cenario, tabela):
    _criar(repo, cenario)
    coluna = {"monitorias": "nota", "monitoria_respostas": "resposta", "monitoria_pilares": "nota",
              "monitoria_eventos": "observacao", "monitoria_logs": "acao"}[tabela]
    valor = "'X'" if coluna in ("resposta", "observacao", "acao") else "0"
    for sql in (f"UPDATE dbo.{tabela} SET {coluna} = {valor}", f"DELETE FROM dbo.{tabela}"):
        with pytest.raises(pyodbc.Error) as erro:
            _sql(repo, sql)
        assert "imutavel" in str(erro.value).lower()


def test_editar_a_matriz_nao_altera_monitorias_antigas(repo, cenario, admin):
    antiga = _criar(repo, cenario)
    versao_antiga = antiga_detalhe = repo.mon_detalhe(cenario["qual"], antiga["codigo"])
    config = repo.mon_get_matriz(admin, OP)["versao_ativa"]["config"]
    peso_atual = config["blocos"][3]["criterios"][0]["peso"]
    config["blocos"][3]["criterios"][0]["peso"] = 5   # Solução: 5 + 10 ≠ 20 → deve BLOQUEAR
    with pytest.raises(HTTPException) as erro:
        repo.mon_save_versao(admin, OP, config)
    assert erro.value.status_code == 422
    # alterna a distribuição (10/10 <-> 15/5) para o teste ser repetível
    novo_peso = 15 if peso_atual == 10 else 10
    config["blocos"][3]["criterios"][0]["peso"] = novo_peso
    config["blocos"][3]["criterios"][1]["peso"] = 20 - novo_peso
    salvo = repo.mon_save_versao(admin, OP, config, "Peso da solução redistribuído")
    assert salvo["numero"] == antiga_detalhe["numero_versao"] + 1
    nova = _criar(repo, cenario, respostas=_respostas(b4c1="NAO"))
    assert nova["nota"] == 100.0 - novo_peso  # a nova matriz vale para as novas monitorias
    depois = repo.mon_detalhe(cenario["qual"], antiga["codigo"])
    assert depois["numero_versao"] == versao_antiga["numero_versao"] and depois["nota"] == 100.0  # jamais recalculada
    assert depois["config"] == versao_antiga["config"]
    versoes = repo.mon_list_versoes(admin, OP)
    assert versoes[0]["ativa"] and not versoes[1]["ativa"]
    arquivada = repo.mon_get_versao(admin, versoes[1]["id_versao"])  # arquivada, consultável, somente leitura
    assert arquivada["config"]["blocos"][3]["criterios"][0]["peso"] == peso_atual
    with pytest.raises(HTTPException) as erro:  # sem mudanças
        repo.mon_save_versao(admin, OP, repo.mon_get_matriz(admin, OP)["versao_ativa"]["config"])
    assert erro.value.status_code == 409


# ---------------------------------------------------------------------------
# Fluxo completo
# ---------------------------------------------------------------------------
def test_operador_so_ve_depois_do_feedback_e_so_a_propria(repo, cenario):
    r = _criar(repo, cenario)
    assert repo.mon_listar(cenario["op1"])["total"] == 0 or all(i["codigo"] != r["codigo"] for i in repo.mon_listar(cenario["op1"])["itens"])
    with pytest.raises(HTTPException) as e:
        repo.mon_detalhe(cenario["op1"], r["codigo"])
    assert e.value.status_code == 404
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "Feedback dado"})
    assert repo.mon_detalhe(cenario["op1"], r["codigo"])["status"] == "AGUARDANDO_CONFIRMACAO"
    with pytest.raises(HTTPException) as e:  # outro operador nunca vê
        repo.mon_detalhe(cenario["op2"], r["codigo"])
    assert e.value.status_code == 404


def test_feedback_apenas_supervisor_responsavel_ou_qualidade(repo, cenario):
    r = _criar(repo, cenario)
    with pytest.raises(HTTPException) as e:
        repo.mon_aplicar_feedback(cenario["sup2"], r["codigo"], {"observacao": "x"})
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        repo.mon_aplicar_feedback(cenario["sup_crf"], r["codigo"], {"observacao": "x"})
    assert e.value.status_code == 404  # outra operação: nem revela que existe
    with pytest.raises(HTTPException):
        repo.mon_aplicar_feedback(cenario["qual"], r["codigo"], {"observacao": ""})  # observação obrigatória
    repo.mon_aplicar_feedback(cenario["qual"], r["codigo"], {"observacao": "Feito pela qualidade"})
    with pytest.raises(HTTPException) as e:  # não se aplica duas vezes
        repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "de novo"})
    assert e.value.status_code == 409


def test_confirmacao_pelo_operador_finaliza_como_confirmada(repo, cenario):
    r = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "ok"})
    with pytest.raises(HTTPException):
        repo.mon_confirmar(cenario["op2"], r["codigo"])
    repo.mon_confirmar(cenario["op1"], r["codigo"])
    d = repo.mon_detalhe(cenario["op1"], r["codigo"])
    assert d["status"] == "FINALIZADA" and d["resultado"] == "CONFIRMADA" and d["nota"] == 100.0
    with pytest.raises(HTTPException) as e:  # finalizada = somente leitura
        repo.mon_contestar(cenario["op1"], r["codigo"], {"criterios": ["b1c1"], "motivo": "m", "justificativa": "j"})
    assert e.value.status_code == 409


def test_contestacao_reanalise_manter_nao_altera_a_monitoria(repo, cenario):
    r = _criar(repo, cenario, respostas=_respostas(b2c1="NAO"))
    original = repo.mon_detalhe(cenario["qual"], r["codigo"])
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "ok"})
    with pytest.raises(HTTPException):  # critério inexistente na monitoria
        repo.mon_contestar(cenario["op1"], r["codigo"], {"criterios": ["zzz"], "motivo": "m", "justificativa": "j"})
    with pytest.raises(HTTPException):  # motivo/justificativa obrigatórios
        repo.mon_contestar(cenario["op1"], r["codigo"], {"criterios": ["b2c1"], "motivo": "", "justificativa": ""})
    repo.mon_contestar(cenario["op1"], r["codigo"], {"criterios": ["b2c1"], "motivo": "Discordo", "justificativa": "Eu não interrompi"})
    repo.mon_replicar(cenario["op1"], r["codigo"], "Complemento da minha justificativa")
    repo.mon_anexar_evidencia(cenario["op1"], r["codigo"], nome="print.png", conteudo=PNG)
    with pytest.raises(HTTPException):  # conteúdo não bate com a extensão
        repo.mon_anexar_evidencia(cenario["op1"], r["codigo"], nome="falso.pdf", conteudo=PNG)
    with pytest.raises(HTTPException) as e:  # reanálise só pelo supervisor responsável
        repo.mon_reanalisar(cenario["sup2"], r["codigo"], {"resultado": "MANTER", "observacao": "x"})
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):  # observação obrigatória
        repo.mon_reanalisar(cenario["sup1"], r["codigo"], {"resultado": "MANTER", "observacao": ""})
    repo.mon_reanalisar(cenario["sup1"], r["codigo"], {"resultado": "MANTER", "observacao": "Avaliação correta"})
    final = repo.mon_detalhe(cenario["sup1"], r["codigo"])
    assert final["status"] == "FINALIZADA" and final["resultado"] == "CONFIRMADA"
    assert final["contestacoes"][0]["reanalise"]["resultado"] == "CONFIRMADA"
    assert len(final["contestacoes"][0]["replicas"]) == 1 and len(final["contestacoes"][0]["anexos"]) == 1
    # a monitoria original permanece idêntica em todos os aspectos
    for campo in ("nota", "nivel", "respostas", "pilares", "config", "observacao", "sugestao_feedback", "numero_versao", "avaliador_nome"):
        assert final[campo] == original[campo], campo
    assert [e["para"] for e in final["eventos"]] == [
        "REALIZADA", "FEEDBACK_PENDENTE", "FEEDBACK_APLICADO", "AGUARDANDO_CONFIRMACAO", "CONTESTADA", "REANALISE", "CONFIRMADA", "FINALIZADA",
    ]


def test_reanalise_anular_marca_como_anulada_e_fora_dos_indicadores(repo, cenario):
    r = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "ok"})
    repo.mon_contestar(cenario["op1"], r["codigo"], {"criterios": ["b1c1"], "motivo": "m", "justificativa": "j"})
    repo.mon_reanalisar(cenario["sup1"], r["codigo"], {"resultado": "ANULAR", "observacao": "Procede"})
    item = next(i for i in repo.mon_listar(cenario["sup1"], {"codigo": r["codigo"]})["itens"])
    assert item["anulada"] is True and item["valida"] is False and item["status"] == "FINALIZADA"
    assert item["nota"] == 100.0  # a nota original permanece registrada


# ---------------------------------------------------------------------------
# SLA automático (idempotente)
# ---------------------------------------------------------------------------
def test_job_de_sla_confirma_e_anula_automaticamente_e_e_idempotente(repo, cenario):
    a = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], a["codigo"], {"observacao": "ok"})
    b = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], b["codigo"], {"observacao": "ok"})
    repo.mon_contestar(cenario["op1"], b["codigo"], {"criterios": ["b1c1"], "motivo": "m", "justificativa": "j"})
    dentro = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], dentro["codigo"], {"observacao": "ok"})

    for codigo in (a["codigo"], b["codigo"]):
        _sql(repo, "UPDATE dbo.monitoria_estado SET sla_limite = DATEADD(HOUR, -1, GETDATE()) WHERE id_monitoria = (SELECT id_monitoria FROM dbo.monitorias WHERE codigo = ?)", (codigo,))
    resultado = repo.mon_processar_slas()
    assert resultado["confirmadas_automaticamente"] >= 1 and resultado["anuladas_automaticamente"] >= 1

    da = repo.mon_detalhe(cenario["sup1"], a["codigo"])
    assert da["status"] == "FINALIZADA" and da["resultado"] == "CONFIRMADA" and da["eventos"][-1]["automatico"] is True
    db = repo.mon_detalhe(cenario["sup1"], b["codigo"])
    assert db["status"] == "FINALIZADA" and db["resultado"] == "ANULADA"
    assert db["contestacoes"][0]["reanalise"]["automatico"] is True
    assert repo.mon_detalhe(cenario["sup1"], dentro["codigo"])["status"] == "AGUARDANDO_CONFIRMACAO"  # dentro do prazo: intacta

    eventos_antes = len(da["eventos"])
    repo.mon_processar_slas()  # segunda execução: nada muda
    assert len(repo.mon_detalhe(cenario["sup1"], a["codigo"])["eventos"]) == eventos_antes


# ---------------------------------------------------------------------------
# Escopo (deny por padrão) e busca
# ---------------------------------------------------------------------------
def test_supervisor_ve_so_seus_operadores_e_outra_operacao_nao_ve_nada(repo, cenario):
    r = _criar(repo, cenario)
    codigos_sup1 = {i["codigo"] for i in repo.mon_listar(cenario["sup1"], {}, por_pagina=200)["itens"]}
    codigos_sup2 = {i["codigo"] for i in repo.mon_listar(cenario["sup2"], {}, por_pagina=200)["itens"]}
    assert r["codigo"] in codigos_sup1 and r["codigo"] not in codigos_sup2
    assert repo.mon_listar(cenario["sup_crf"], {"codigo": r["codigo"]})["total"] == 0
    with pytest.raises(HTTPException) as e:
        repo.mon_detalhe(cenario["sup2"], r["codigo"])
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        repo.mon_detalhe(cenario["sup_crf"], r["codigo"])
    # Qualidade da operação vê toda a operação; sem vínculo de operação => nada (deny)
    assert r["codigo"] in {i["codigo"] for i in repo.mon_listar(cenario["qual"], {}, por_pagina=200)["itens"]}
    sem_vinculo = _ator(ROLE_QUALIDADE, 999999, [], "SemVinculo")
    assert repo.mon_listar(sem_vinculo)["total"] == 0


def test_busca_por_id_operador_data_e_avaliador(repo, cenario):
    r = _criar(repo, cenario)
    q = cenario["qual"]
    assert repo.mon_listar(q, {"codigo": r["codigo"]})["total"] == 1
    assert repo.mon_listar(q, {"id_operador": cenario["op1"].id_usuario, "id_avaliador": q.id_usuario, "data_inicio": "2000-01-01"})["total"] >= 1
    assert repo.mon_listar(q, {"operador": "Zzzz inexistente"})["total"] == 0


def test_log_registra_a_realizacao_com_ip_e_notificacao_de_feedback_pendente(repo, cenario):
    r = repo.mon_criar_monitoria(cenario["qual"], _dados(cenario), ip="10.1.2.3")
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT TOP 1 ip, resultado, perfil FROM dbo.monitoria_logs WHERE acao = 'realizar_monitoria' AND entidade_id = ? ORDER BY id_log DESC", (str(r["id_monitoria"]),))
        ip, resultado, perfil = cursor.fetchone()
        assert (ip, resultado, perfil) == ("10.1.2.3", "SUCESSO", ROLE_QUALIDADE)
        cursor.execute("SELECT COUNT(*) FROM dbo.notificacoes WHERE categoria = 'monitoria_feedback_pendente' AND entidade_id = ?", (str(r["id_monitoria"]),))
        assert cursor.fetchone()[0] >= 2  # supervisor responsável + qualidade da operação
    finally:
        conn.close()

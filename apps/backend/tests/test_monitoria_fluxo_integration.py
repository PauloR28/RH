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
def test_operador_ve_a_propria_monitoria_assim_que_feita_mas_so_contesta_apos_o_feedback(repo, cenario):
    r = _criar(repo, cenario)
    # Correções.txt 21/set: aparece em "Minhas monitorias" logo após ser feita (Feedback pendente).
    itens = repo.mon_listar(cenario["op1"])["itens"]
    assert any(i["codigo"] == r["codigo"] and i["status"] == "FEEDBACK_PENDENTE" for i in itens)
    assert repo.mon_detalhe(cenario["op1"], r["codigo"])["status"] == "FEEDBACK_PENDENTE"
    # ...mas contestar/confirmar continuam bloqueados até o feedback ser aplicado.
    with pytest.raises(HTTPException) as e:
        repo.mon_confirmar(cenario["op1"], r["codigo"])
    assert e.value.status_code == 409
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "Feedback dado"})
    assert repo.mon_detalhe(cenario["op1"], r["codigo"])["status"] == "AGUARDANDO_CONFIRMACAO"
    with pytest.raises(HTTPException) as e:  # outro operador nunca vê
        repo.mon_detalhe(cenario["op2"], r["codigo"])
    assert e.value.status_code == 404
    assert all(i["codigo"] != r["codigo"] for i in repo.mon_listar(cenario["op2"])["itens"])


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


# ---------------------------------------------------------------------------
# C4 — Dashboard, relatórios, exportação, e-mail, logs, planos, guia, identidade
# ---------------------------------------------------------------------------
def _garantir_dados(repo, cenario):
    """Garante monitorias válidas de op1 e uma com NCG."""
    for _ in range(3):
        _criar(repo, cenario)
    _criar(repo, cenario, respostas=_respostas(b4c1="NCG"), motivo_ncg="Ofensa")


def test_dashboard_operador_ve_so_o_proprio_e_apenas_a_media_da_operacao(repo, cenario):
    _garantir_dados(repo, cenario)
    r = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "ok"})
    outra = repo.mon_criar_monitoria(cenario["qual"], _dados(cenario, id_operador=cenario["op2"].id_usuario))
    repo.mon_aplicar_feedback(cenario["sup2"], outra["codigo"], {"observacao": "ok"})

    d = repo.mon_dashboard(cenario["op1"], {})
    assert d["papel"] == "operador" and d["top"] == [] and d["por_operador"] == [] and d["por_equipe"] == []
    assert d["media_operacao"] is not None and d["escala"]["nota_operador"] == d["resumo"]["nota_media"]
    assert d["resumo"]["quantidade_realizadas"] >= 1
    assert all(o["chave"] == OP for o in d["por_operacao"])
    ids_visiveis = {i["id_operador"] for i in repo.mon_listar(cenario["op1"], {}, por_pagina=200)["itens"]}
    assert ids_visiveis <= {cenario["op1"].id_usuario}  # nunca dados individuais de outro operador


def test_dashboard_supervisor_detalha_so_a_propria_equipe_e_consolida_a_operacao(repo, cenario):
    _garantir_dados(repo, cenario)
    repo.mon_criar_monitoria(cenario["qual"], _dados(cenario, id_operador=cenario["op2"].id_usuario))
    d1 = repo.mon_dashboard(cenario["sup1"], {"operacao": OP})
    d2 = repo.mon_dashboard(cenario["sup2"], {"operacao": OP})
    assert {o["chave"] for o in d1["por_operador"]} == {cenario["op1"].id_usuario}
    assert {o["chave"] for o in d2["por_operador"]} == {cenario["op2"].id_usuario}
    assert d1["visao_operacao"]["quantidade_realizadas"] > d1["resumo"]["quantidade_realizadas"]
    assert d1["top"] and {"nota_media", "quantidade_validas", "posicao"} <= set(d1["top"][0])
    assert repo.mon_dashboard(cenario["sup_crf"], {"operacao": OP})["resumo"]["quantidade_realizadas"] == 0


def test_control_desk_ve_todas_as_operacoes_com_tag(repo, cenario):
    _garantir_dados(repo, cenario)
    cd = _ator("control_desk", 987654, [], "CD")
    d = repo.mon_dashboard(cd, {})
    assert any(o["chave"] == OP for o in d["por_operacao"])
    assert repo.mon_listar(cd, {"operacao": OP})["total"] > 0


def test_top_n_aceita_3_5_10_15_e_ignora_outros(repo, cenario):
    _garantir_dados(repo, cenario)
    assert repo.mon_dashboard(cenario["qual"], {}, top=3)["top_n"] == 3
    assert repo.mon_dashboard(cenario["qual"], {}, top=7)["top_n"] == 5
    assert repo.mon_dashboard(cenario["qual"], {}, top=15)["top_n"] == 15


def test_relatorio_exportacao_usa_o_mesmo_motor_do_dashboard(repo, cenario):
    _garantir_dados(repo, cenario)
    q = cenario["qual"]
    filtros = {"operacao": OP}
    dash = repo.mon_dashboard(q, filtros)
    rel = repo.mon_relatorio(q, "monitorias", filtros)
    assert len(rel["linhas"]) == dash["resumo"]["quantidade_realizadas"]
    assert rel["colunas"][:3] == ["ID_MONITORIA", "DATA_MONITORIA", "DATA_CONTATO"] and "ANULADA" in rel["colunas"] and "PL_AÇÃO" in rel["colunas"]
    qual = repo.mon_relatorio(q, "qualidade", filtros)
    assert qual["colunas"][:2] == ["PERIODO_INICIAL", "PERIODO_FINAL"] and "QNT_MONITORIAS" in qual["colunas"]
    assert sum(l[6] for l in qual["linhas"]) == dash["resumo"]["quantidade_realizadas"]
    conteudo, nome, mime = repo.mon_exportar(q, "monitorias", "xlsx", filtros, ip="10.0.0.9")
    assert conteudo[:2] == b"PK" and nome.endswith(".xlsx") and "spreadsheetml" in mime
    csv_bytes, _, _ = repo.mon_exportar(q, "monitorias", "csv", filtros)
    assert csv_bytes.decode("utf-8-sig").count("\r\n") == len(rel["linhas"]) + 1
    with pytest.raises(HTTPException):
        repo.mon_exportar(q, "monitorias", "pdf", filtros)
    logs = repo.mon_logs(_ator(ROLE_ADMIN, 1), {"acao": "exportar_relatorio"}, por_pagina=5)
    assert logs["itens"]


def test_exportar_monitoria_individual_respeita_escopo(repo, cenario):
    r = _criar(repo, cenario)
    conteudo, nome, _ = repo.mon_exportar_monitorias(cenario["qual"], [r["id_monitoria"]])
    assert nome == f"monitoria_{r['codigo']}.xlsx" and conteudo[:2] == b"PK"
    with pytest.raises(HTTPException) as e:
        repo.mon_exportar_monitorias(cenario["sup_crf"], [r["id_monitoria"]])
    assert e.value.status_code == 404


def test_compartilhar_por_email_so_com_quem_pode_ver_e_com_log(repo, cenario, admin, monkeypatch):
    from rh_api.services import email_send_service as svc

    enviados = []
    monkeypatch.setattr(svc.EmailSendService, "configured", property(lambda self: True))
    monkeypatch.setattr(svc.EmailSendService, "send_mail", lambda self, **kw: enviados.append(kw) or {})
    r = _criar(repo, cenario)
    with pytest.raises(HTTPException) as e:  # operador 2 não pode ver a monitoria do operador 1
        repo.mon_compartilhar(cenario["qual"], [r["id_monitoria"]], [cenario["op2"].id_usuario])
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:  # supervisor de outra equipe também não
        repo.mon_compartilhar(cenario["qual"], [r["id_monitoria"]], [cenario["sup2"].id_usuario])
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:  # quem envia só compartilha o que pode ver
        repo.mon_compartilhar(cenario["sup_crf"], [r["id_monitoria"]], [cenario["sup1"].id_usuario])
    assert e.value.status_code == 404
    res = repo.mon_compartilhar(cenario["qual"], [r["id_monitoria"]], [cenario["sup1"].id_usuario], "Veja", ip="10.9.9.9")
    assert res["enviados"] == 1 and enviados[0]["anexos"][0]["nome"] == "monitorias.xlsx"
    logs = repo.mon_logs(admin, {"acao": "compartilhar_email"}, por_pagina=3)["itens"]
    assert logs and "destinatarios" in logs[0]["detalhes"]


def test_compartilhar_sem_email_configurado_devolve_503(repo, cenario, monkeypatch):
    from rh_api.services import email_send_service as svc

    monkeypatch.setattr(svc.EmailSendService, "configured", property(lambda self: False))
    r = _criar(repo, cenario)
    with pytest.raises(HTTPException) as e:
        repo.mon_compartilhar(cenario["qual"], [r["id_monitoria"]], [cenario["sup1"].id_usuario])
    assert e.value.status_code == 503


def test_logs_supervisor_so_ve_o_escopo_da_propria_operacao(repo, cenario, admin):
    _criar(repo, cenario)
    do_sup = repo.mon_logs(cenario["sup1"], {}, por_pagina=100)
    assert do_sup["itens"] and all(i["operacao"] == OP for i in do_sup["itens"])
    assert all(i["operacao"] != OP for i in repo.mon_logs(cenario["sup_crf"], {}, por_pagina=100)["itens"])
    assert repo.mon_logs(_ator(ROLE_QUALIDADE, 5, [], "SemVinculo"), {})["total"] == 0
    assert repo.mon_logs(admin, {"operacao": OP}, por_pagina=1)["total"] > 0


def test_plano_de_acao_ciclo_completo_e_escopo(repo, cenario):
    from datetime import date, timedelta

    r = _criar(repo, cenario, respostas=_respostas(b4c1="NAO"))
    prazo = (date.today() + timedelta(days=10)).isoformat()
    with pytest.raises(HTTPException):
        repo.mon_plano_criar(cenario["sup1"], {"id_monitoria": r["id_monitoria"], "problema": "P", "objetivo": "O", "acao": "A", "prazo": "2000-01-01"})
    criado = repo.mon_plano_criar(cenario["sup1"], {"id_monitoria": r["id_monitoria"], "problema": "Solução incorreta", "criterio": "Solução Correta?",
                                                   "objetivo": "Subir a nota", "acao": "Treinar procedimento", "prazo": prazo})
    idp = criado["id_plano"]
    with pytest.raises(HTTPException) as e:  # supervisor de outro operador nem enxerga
        repo.mon_plano_revisar(cenario["sup2"], idp, {"status": "EM_ANDAMENTO"})
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:  # não pula etapas
        repo.mon_plano_revisar(cenario["sup1"], idp, {"status": "CONCLUIDO", "resultado": "x"})
    assert e.value.status_code == 409
    repo.mon_plano_revisar(cenario["sup1"], idp, {"status": "EM_ANDAMENTO"})
    repo.mon_plano_revisar(cenario["sup1"], idp, {"status": "EM_REVISAO", "observacoes": "Revisão semanal"})
    with pytest.raises(HTTPException):  # concluir exige o resultado obtido
        repo.mon_plano_revisar(cenario["sup1"], idp, {"status": "CONCLUIDO"})
    fim = repo.mon_plano_revisar(cenario["sup1"], idp, {"status": "CONCLUIDO", "resultado": "Nota subiu"})
    assert fim["status"] == "CONCLUIDO" and fim["nota_depois"] is not None
    detalhe = repo.mon_plano_detalhe(cenario["sup1"], idp)
    assert detalhe["historico"][0]["evento"] == "criacao" and len(detalhe["historico"]) == 4
    assert detalhe["nota_antes"] is not None
    with pytest.raises(HTTPException) as e:  # concluído não muda mais
        repo.mon_plano_revisar(cenario["sup1"], idp, {"status": "EM_ANDAMENTO"})
    assert e.value.status_code == 409
    # operador vê o próprio plano (só leitura) e não revisa
    assert any(p["id_plano"] == idp for p in repo.mon_plano_listar(cenario["op1"])["itens"])
    assert not any(p["id_plano"] == idp for p in repo.mon_plano_listar(cenario["op2"])["itens"])
    with pytest.raises(HTTPException):
        repo.mon_plano_revisar(cenario["op1"], idp, {"status": "EM_ANDAMENTO"})
    rel = repo.mon_relatorio(cenario["sup1"], "planos", {})
    assert "PROBLEMA" in rel["colunas"] and rel["linhas"]


def test_guia_config_e_zona_de_risco_nao_apagam_historico(repo, cenario, admin):
    assert len(repo.mon_guia_listar()) >= 8
    novo = repo.mon_guia_salvar(admin, {"titulo": "Guia teste", "conteudo": "Texto", "ordem": 99})
    repo.mon_guia_salvar(admin, {"titulo": "Guia teste", "conteudo": "Texto", "ordem": 99, "ativo": False}, novo["id_guia"])
    with pytest.raises(HTTPException):
        repo.mon_config_salvar(admin, {"limiar_alerta_pct": 5})
    assert repo.mon_config_salvar(admin, {"limiar_alerta_pct": 80})["limiar_alerta_pct"] == 80
    repo.mon_config_salvar(admin, {"limiar_alerta_pct": 75})
    assert repo.mon_config_obter()["prazos_oficiais_horas"] == {"FEEDBACK": 72, "CONFIRMACAO": 48, "REANALISE": 72}

    antes = repo.mon_listar(admin, {"operacao": OP})["total"]
    with pytest.raises(HTTPException) as e:  # dupla confirmação: digitar a chave + justificativa
        repo.mon_risco_executar(admin, "restaurar_matriz", OP, "errado", "restaurando")
    assert e.value.status_code == 422
    versao_antes = repo.mon_get_matriz(admin, OP)["versao_ativa"]["numero"]
    try:
        res = repo.mon_risco_executar(admin, "restaurar_matriz", OP, OP, "Voltar ao padrão do RH")
        assert res["nova_versao"] == versao_antes + 1
    except HTTPException as exc:  # já está no padrão: nada a restaurar
        assert exc.status_code == 409
    assert repo.mon_listar(admin, {"operacao": OP})["total"] == antes  # nunca apaga monitorias
    with pytest.raises(HTTPException):
        repo.mon_risco_executar(admin, "apagar_monitorias", OP, OP, "tentativa indevida")


def test_identidade_cor_logo_e_isolamento_do_contexto(repo, cenario, admin):
    with pytest.raises(HTTPException) as e:
        repo.mon_identidade_salvar(admin, OP, "#ffe600")  # sem contraste para botão com texto branco
    assert e.value.status_code == 422
    ok = repo.mon_identidade_salvar(admin, OP, "#7a1f5c")
    assert ok["cor_primaria"] == "#7a1f5c" and ok["tokens"]["brand"] == "#7a1f5c"
    logo = repo.mon_logo_salvar(admin, OP, nome="logo.png", conteudo=PNG)
    assert repo.mon_logo_arquivo(logo["logo_arquivo"])[1] == "image/png"
    with pytest.raises(HTTPException):
        repo.mon_logo_arquivo("naoexiste1.png")
    with pytest.raises(HTTPException):  # arquivo que não é imagem
        repo.mon_logo_salvar(admin, OP, nome="logo.png", conteudo=b"MZ\x90\x00 nao e imagem")
    # a cor/logo da operação só aparecem no contexto de quem pertence a ela
    ctx_op = repo.mon_contexto(cenario["op1"])
    assert [o["chave"] for o in ctx_op["operacoes"]] == [OP] and ctx_op["operacoes"][0]["tokens"]["brand"] == "#7a1f5c"
    ctx_crf = repo.mon_contexto(cenario["sup_crf"])
    assert all(o["chave"] != OP for o in ctx_crf["operacoes"])
    repo.mon_identidade_salvar(admin, OP, "")  # remove a cor de teste


def test_rotas_negam_perfis_sem_permissao_e_operador_nao_exporta(repo, cenario):
    from fastapi.testclient import TestClient

    from rh_api.auth import _build_token
    from rh_api.main import app

    cliente = TestClient(app)

    def cab(user):
        return {"Authorization": f"Bearer {_build_token(user)}"}

    assert cliente.get("/monitoria/relatorios/monitorias", headers=cab(cenario["op1"])).status_code == 403
    assert cliente.get("/monitoria/relatorios/monitorias/exportar", headers=cab(cenario["op1"])).status_code == 403
    assert cliente.get("/monitoria/logs", headers=cab(cenario["qual"])).status_code == 403  # Qualidade não vê logs por padrão
    assert cliente.get("/monitoria/logs", headers=cab(cenario["sup1"])).status_code == 200
    assert cliente.post("/monitoria/monitorias", json=_dados(cenario), headers=cab(cenario["op1"])).status_code == 403
    assert cliente.get("/monitoria/dashboard", headers=cab(cenario["op1"])).status_code == 403  # Operador não tem Dashboard
    assert cliente.get("/monitoria/planos", headers=cab(cenario["op1"])).status_code == 403
    assert cliente.get("/monitoria/monitorias").status_code == 401
    ok = cliente.get("/monitoria/relatorios/monitorias/exportar?formato=csv&operacao=" + OP, headers=cab(cenario["qual"]))
    assert ok.status_code == 200 and ok.headers["content-type"].startswith("text/csv")
    assert cliente.get("/monitoria/logos/..%2F..%2Fetc.png").status_code in (404, 422)


def test_vazamento_por_url_e_api_devolve_404_fora_do_escopo(repo, cenario):
    """M35: acesso direto por URL/API nunca revela dados de outra operação/equipe/operador."""
    from fastapi.testclient import TestClient

    from rh_api.auth import _build_token
    from rh_api.main import app

    r = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "ok"})
    cliente = TestClient(app)

    def cab(user):
        return {"Authorization": f"Bearer {_build_token(user)}"}

    for ator in ("sup2", "sup_crf", "op2"):
        assert cliente.get(f"/monitoria/monitorias/{r['codigo']}", headers=cab(cenario[ator])).status_code == 404, ator
        assert cliente.get(f"/monitoria/monitorias/{r['id_monitoria']}", headers=cab(cenario[ator])).status_code == 404, ator
    ok = cliente.get(f"/monitoria/monitorias/{r['codigo']}", headers=cab(cenario["sup1"]))
    assert ok.status_code == 200 and ok.json()["codigo"] == r["codigo"]
    # exportação, dashboard e listagem também respeitam o escopo
    assert cliente.post("/monitoria/exportar/monitorias", json={"ids": [r["id_monitoria"]]}, headers=cab(cenario["sup_crf"])).status_code == 404
    assert cliente.get(f"/monitoria/monitorias?codigo={r['codigo']}", headers=cab(cenario["sup_crf"])).json()["total"] == 0
    assert cliente.get("/monitoria/dashboard?operacao=" + OP, headers=cab(cenario["sup_crf"])).json()["resumo"]["quantidade_realizadas"] == 0


# ---------------------------------------------------------------------------
# Notificações da contestação (Correções.txt, 21/set/2026) e tipos de atendimento por canal
# ---------------------------------------------------------------------------
def _notificacoes_do(repo, ator, categoria, id_monitoria):
    """Consulta como a rota: pelo username E pelo e-mail (as notificações são gravadas pelo e-mail)."""
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT email FROM dbo.usuarios WHERE id_usuario = ?", (ator.id_usuario,))
        email = cursor.fetchone()[0]
    finally:
        conn.close()
    itens = repo.list_notificacoes(papel=ator.perfil, usuario=ator.username, email=email, apenas_nao_lidas=True)
    return [i for i in itens if i["categoria"] == categoria and i["entidade_id"] == str(id_monitoria)]


def test_contestacao_notifica_supervisor_e_qualidade_e_atualizacoes_notificam_o_operador(repo, cenario):
    r = _criar(repo, cenario)
    repo.mon_aplicar_feedback(cenario["sup1"], r["codigo"], {"observacao": "ok"})
    assert len(_notificacoes_do(repo, cenario["op1"], "monitoria_feedback_aplicado", r["id_monitoria"])) == 1
    repo.mon_contestar(cenario["op1"], r["codigo"], {"criterios": ["b1c1"], "motivo": "m", "justificativa": "j"})
    for destino in ("sup1", "qual"):
        itens = _notificacoes_do(repo, cenario[destino], "monitoria_contestacao", r["id_monitoria"])
        assert len(itens) == 1, destino
        assert "abriu uma contestação na monitoria" in itens[0]["mensagem"] and r["codigo"] in itens[0]["mensagem"]
    assert _notificacoes_do(repo, cenario["sup2"], "monitoria_contestacao", r["id_monitoria"]) == []  # outro supervisor
    repo.mon_replicar(cenario["op1"], r["codigo"], "Segue minha réplica")
    assert len(_notificacoes_do(repo, cenario["sup1"], "monitoria_replica", r["id_monitoria"])) == 1
    repo.mon_reanalisar(cenario["sup1"], r["codigo"], {"resultado": "MANTER", "observacao": "Mantida"})
    assert len(_notificacoes_do(repo, cenario["op1"], "monitoria_reanalise", r["id_monitoria"])) == 1
    # abrir a monitoria marca como lidas as notificações dela (some a bolinha)
    marcadas = repo.marcar_notificacoes_entidade_lidas(entidade="monitoria", entidade_id=str(r["id_monitoria"]), papel="operador",
                                                        usuario=cenario["op1"].username, email=_email_de(repo, cenario["op1"]))
    assert marcadas["atualizadas"] >= 2
    assert _notificacoes_do(repo, cenario["op1"], "monitoria_reanalise", r["id_monitoria"]) == []


def _email_de(repo, ator):
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT email FROM dbo.usuarios WHERE id_usuario = ?", (ator.id_usuario,))
        return cursor.fetchone()[0]
    finally:
        conn.close()


def test_tipos_de_atendimento_pertencem_a_operacao_e_canal(repo, cenario, admin):
    canal = next(i for i in repo.mon_list_catalogo("canal", OP) if i["valor"] == "Telefone")
    outro = repo.mon_save_catalogo(admin, {"tipo": "canal", "operacao": OP, "valor": "Chat teste"})["id_item"]
    with pytest.raises(HTTPException) as e:  # campos obrigatórios
        repo.mon_save_tipo_atendimento(admin, {"operacao": OP, "id_item_canal": 0, "valor": "X"})
    assert e.value.status_code == 422
    novo = repo.mon_save_tipo_atendimento(admin, {"operacao": OP, "id_item_canal": canal["id_item"], "valor": "Cancelamento teste"})["id_item"]
    with pytest.raises(HTTPException) as e:  # duplicidade no mesmo canal
        repo.mon_save_tipo_atendimento(admin, {"operacao": OP, "id_item_canal": canal["id_item"], "valor": "cancelamento TESTE"})
    assert e.value.status_code == 409
    linha = next(i for i in repo.mon_list_tipos_atendimento(admin) if i["id_item"] == novo)
    assert linha["canal"] == "Telefone" and linha["operacao"] == OP and linha["valor"] == "Cancelamento teste"
    # tipo de um canal só vale para monitorias daquele canal
    with pytest.raises(HTTPException) as e:
        repo.mon_criar_monitoria(cenario["qual"], _dados(cenario, canal="Chat teste", tipo_atendimento="Cancelamento teste"))
    assert e.value.status_code == 422
    assert repo.mon_criar_monitoria(cenario["qual"], _dados(cenario, canal="Telefone", tipo_atendimento="Cancelamento teste"))["codigo"]
    # edição e escopo: supervisor de outra operação não enxerga nem altera
    repo.mon_save_tipo_atendimento(admin, {"operacao": OP, "id_item_canal": outro, "valor": "Cancelamento teste"}, novo)
    assert next(i for i in repo.mon_list_tipos_atendimento(admin) if i["id_item"] == novo)["canal"] == "Chat teste"
    assert all(i["id_item"] != novo for i in repo.mon_list_tipos_atendimento(cenario["sup_crf"]))
    with pytest.raises(HTTPException) as e:
        repo.mon_excluir_tipo_atendimento(cenario["sup_crf"], novo)
    assert e.value.status_code == 403
    repo.mon_excluir_tipo_atendimento(admin, novo)
    assert all(i["id_item"] != novo for i in repo.mon_list_tipos_atendimento(admin))

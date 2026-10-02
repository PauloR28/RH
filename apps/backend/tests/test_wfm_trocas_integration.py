"""WFM — trocas de plantão: testes de INTEGRAÇÃO contra o banco de DESENVOLVIMENTO (relógio simulado).

Semana de teste: 2027-03-01 (segunda) a 2027-03-07. Dados `WFMTROCA_xxxx` / `wfm_teste_*`; o histórico
imutável (eventos, versões, auditoria) permanece por desenho."""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_MANAGER, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR, get_role_permissions

MES = "2027-03"
SEGUNDA = datetime(2027, 3, 1, 9, 0)


def _user(perfil, id_usuario, operacoes=(), nome="Teste"):
    return AuthenticatedUser(username=f"wfm_{perfil}_{id_usuario}", id_usuario=id_usuario, nome=nome, perfil=perfil,
                             operacoes=frozenset(operacoes), permissions=frozenset(get_role_permissions(perfil)))


class Ctx:
    pass


def _item(op, dia, turno, versao=None):
    return {"id_operador": op, "data": f"{MES}-{dia:02d}", "id_turno": turno, "versao_linha": versao}


def _erro(fn, *a, **k) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*a, **k)
    return e.value


@pytest.fixture(scope="module")
def ctx():
    repo = repositorio_dev()
    c = Ctx()
    c.repo = repo
    c.relogio = {"agora": SEGUNDA}
    repo._wfm_agora = lambda: c.relogio["agora"]
    c.op = f"WFMTROCA_{uuid.uuid4().hex[:4].upper()}"
    admin = _user(ROLE_ADMIN, 1, nome="Adm")
    repo.upsert_configuration_item("operacoes", {"chave": c.op, "nome": f"Op {c.op}", "ativo": True})

    def mk(nome, perfil, sup=()):
        return repo.mon_create_usuario(admin, {"nome": nome, "email": f"wfm_teste_{uuid.uuid4().hex[:10]}@example.com", "perfil": perfil,
                                               "operacoes": [c.op], "supervisores": list(sup)})["id_usuario"]

    c.id_sup = mk("Sup Troca", ROLE_SUPERVISOR)
    c.id_sup_fora = mk("Sup Fora", ROLE_SUPERVISOR)  # não supervisiona A nem B
    c.id_a, c.id_b, c.id_c, c.id_d = (mk(n, ROLE_OPERATOR, [c.id_sup]) for n in ("Op A", "Op B", "Op C", "Op D aprendiz"))
    c.sup = _user(ROLE_SUPERVISOR, c.id_sup, [c.op], "Sup Troca")
    c.sup_fora = _user(ROLE_SUPERVISOR, c.id_sup_fora, [c.op], "Sup Fora")
    c.cd = _user(ROLE_CONTROL_DESK, 9001, [c.op], "CD")
    c.gestor = _user(ROLE_MANAGER, 9002, [], "Gestor")
    c.qual = _user(ROLE_QUALIDADE, 9004, [c.op], "Qualidade")
    c.admin = admin
    c.a, c.b, c.c, c.d = (_user(ROLE_OPERATOR, i, [c.op], n) for i, n in ((c.id_a, "Op A"), (c.id_b, "Op B"), (c.id_c, "Op C"), (c.id_d, "Op D")))

    contratos = {i["codigo"]: i["id_contrato"] for i in repo.wfm_list_contratos(c.cd, c.op)}
    for i in (c.id_a, c.id_b, c.id_c):
        repo.wfm_set_contrato_operador(c.cd, c.op, i, contratos["CLT8"], date(2027, 1, 1))
    repo.wfm_set_contrato_operador(c.cd, c.op, c.id_d, contratos["APR6"], date(2027, 1, 1))
    for cod, ent, sai in (("M", "08:00", "16:00"), ("T", "14:00", "22:00"), ("P", "08:00", "14:00")):
        repo.wfm_save_turno(c.cd, {"operacao": c.op, "codigo": cod, "nome": cod, "entrada": ent, "saida": sai})
    t = {x["codigo"]: x["id_turno"] for x in repo.wfm_list_turnos(c.cd, c.op)}
    c.M, c.T, c.P = t["M"], t["T"], t["P"]
    repo.wfm_save_skill(c.cd, {"operacao": c.op, "categoria": "IDIOMA", "nome": "Inglês"})
    ingles = repo.wfm_list_skills(c.cd, c.op)[0]["id_skill"]
    for i in (c.id_a, c.id_b, c.id_d):
        repo.wfm_set_skills_operador(c.cd, c.op, i, [ingles])  # C fica sem skill: incompatível
    repo.wfm_salvar_itens(c.cd, c.op, MES, [
        _item(c.id_a, 2, c.T), _item(c.id_a, 4, c.T), _item(c.id_a, 6, c.M),
        _item(c.id_b, 3, c.M), _item(c.id_b, 5, c.M), _item(c.id_b, 6, c.T),
        _item(c.id_c, 3, c.M), _item(c.id_d, 3, c.P),
    ])
    repo.wfm_enviar_aprovacao(c.cd, c.op, MES)
    repo.wfm_aprovar_escala(c.gestor, c.op, MES)  # aprovar já publica
    _antecedencia(c, 0)  # os cenários abaixo usam datas coladas ao "agora" simulado; a regra dos 3 dias é testada à parte
    yield c
    conn = repo._connect()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.wfm_trocas WHERE operacao = ?", (c.op,))
        for tabela in ("wfm_operacao_config", "wfm_escala_itens", "wfm_escalas", "wfm_presencas", "wfm_atestados", "wfm_operador_contratos", "wfm_usuario_skills",
                       "wfm_skills", "wfm_calendario_especial", "wfm_turnos", "wfm_contratos"):
            cur.execute(f"DELETE FROM dbo.{tabela} WHERE operacao = ?", (c.op,))
        cur.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE 'wfm_teste_%'")
        for (uid,) in cur.fetchall():
            cur.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (uid, uid))
            cur.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (uid,))
            cur.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (uid,))
            cur.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (uid,))
        cur.execute("DELETE FROM dbo.operacoes WHERE chave LIKE 'WFMTROCA_%'")
        conn.commit()
    finally:
        conn.close()


def _antecedencia(ctx, dias):
    conn = ctx.repo._connect()
    try:
        cur = conn.cursor()
        cur.execute("IF NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config WHERE operacao = ?) INSERT INTO dbo.wfm_operacao_config (operacao) VALUES (?)", (ctx.op, ctx.op))
        cur.execute("UPDATE dbo.wfm_operacao_config SET troca_antecedencia_dias = ? WHERE operacao = ?", (dias, ctx.op))
        conn.commit()
    finally:
        conn.close()


def _solicitar(ctx, solicitante, id_alvo, da, db=None):
    return ctx.repo.wfm_solicitar_troca(solicitante, ctx.op, id_alvo, f"{MES}-{da:02d}", f"{MES}-{(db or da):02d}")


def test_colegas_excluem_aprendiz_e_a_si_mesmo(ctx):
    ids = {c["id_usuario"] for c in ctx.repo.wfm_list_colegas_troca(ctx.a, ctx.op)}
    assert ids == {ctx.id_b, ctx.id_c}
    assert _erro(ctx.repo.wfm_list_colegas_troca, ctx.sup, ctx.op).status_code == 403


def test_regras_de_elegibilidade(ctx):
    ctx.relogio["agora"] = datetime(2027, 3, 5, 9, 0)  # sexta-feira: troca pode ser pedida em qualquer dia
    assert "segunda a quinta" not in str(_erro(_solicitar, ctx, ctx.a, ctx.id_b, 3).detail)  # (falha por outro motivo: A não trabalha no 03)
    _antecedencia(ctx, 1)
    ctx.relogio["agora"] = datetime(2027, 3, 4, 10, 0)  # turno de A em 04/03 às 14:00 => 4h < 1 dia
    assert "antecedência" in str(_erro(_solicitar, ctx, ctx.a, ctx.id_b, 4, 5).detail)
    _antecedencia(ctx, 3)
    ctx.relogio["agora"] = SEGUNDA  # 3 dias (padrão): turno de B em 03/03 às 08:00 => 2d23h
    assert "3 dia(s)" in str(_erro(_solicitar, ctx, ctx.a, ctx.id_b, 6, 3).detail)
    _antecedencia(ctx, 0)
    ctx.relogio["agora"] = SEGUNDA
    e = _erro(ctx.repo.wfm_solicitar_troca, ctx.a, ctx.op, ctx.id_b, "2027-03-08", "2027-03-08")  # semana seguinte
    assert e.status_code == 422 or e.status_code == 409
    assert "escala" in str(e.detail).lower() or "semana corrente" in str(e.detail)
    assert "aprendiz" in str(_erro(_solicitar, ctx, ctx.a, ctx.id_d, 6).detail).lower()   # jovem aprendiz nunca participa
    assert _erro(_solicitar, ctx, ctx.a, ctx.id_a, 6).status_code == 400                     # consigo mesmo
    assert "trabalhar" in str(_erro(_solicitar, ctx, ctx.a, ctx.id_b, 3).detail)              # A não trabalha no dia 03
    assert _erro(ctx.repo.wfm_solicitar_troca, ctx.sup, ctx.op, ctx.id_b, "2027-03-06", "2027-03-06").status_code == 403  # só Operador pede


def test_skills_incompativeis_bloqueiam(ctx):
    e = _erro(_solicitar, ctx, ctx.a, ctx.id_c, 4, 3)
    assert e.status_code == 422 and "skills" in e.detail["mensagem"].lower()


def test_simulacao_do_motor_bloqueia_troca_que_viola_interjornada(ctx):
    # A cede 04 (T) e assume 03 (M do B): A fica T dia 02 (até 22h) e M dia 03 (08h) => 10h de interjornada.
    r = _solicitar(ctx, ctx.a, ctx.id_b, 4, 3)
    resp = ctx.repo.wfm_responder_troca(ctx.b, r["id_troca"], True)
    assert resp["estado"] == "BLOQUEADA"
    t = next(x for x in ctx.repo.wfm_list_trocas(ctx.a, ctx.op) if x["id_troca"] == r["id_troca"])
    assert t["bloqueios"] and t["bloqueios"][0]["codigo"] == "INTERJORNADA"  # A (parte) vê o motivo
    assert ctx.repo.wfm_list_trocas(ctx.qual, ctx.op) == []                    # Qualidade não vê troca nenhuma


def test_fluxo_completo_solicitar_aceitar_aprovar_e_desfazer(ctx):
    r = _solicitar(ctx, ctx.a, ctx.id_b, 6)  # mesmo dia: A (M) e B (T) trocam de turno
    id_troca = r["id_troca"]
    assert _erro(_solicitar, ctx, ctx.b, ctx.id_a, 6).status_code == 409        # um dia só em uma solicitação ativa
    assert _erro(ctx.repo.wfm_responder_troca, ctx.a, id_troca, True).status_code == 403   # só o colega convidado responde
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.sup, id_troca, True).status_code == 409   # ainda não está na fila
    assert ctx.repo.wfm_responder_troca(ctx.b, id_troca, True)["estado"] == "AGUARDANDO_APROVACAO"
    # nenhuma troca é automática: conflito de interesse e escopo
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.a, id_troca, True).status_code == 403
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.b, id_troca, True).status_code == 403
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.sup_fora, id_troca, True).status_code == 403
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.admin, id_troca, True).status_code == 403
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.sup, id_troca, False).status_code == 422   # reprovar exige justificativa
    v_antes = ctx.repo.wfm_get_escala(ctx.a, ctx.op, MES)["status"]["versao_publicada"]
    ap = ctx.repo.wfm_decidir_troca(ctx.sup, id_troca, True, "ok")
    assert ap["estado"] == "APROVADA" and ap["versao"] == v_antes + 1
    esc_a = {i["data"]: i for i in ctx.repo.wfm_get_escala(ctx.a, ctx.op, MES)["itens"]}["2027-03-06"]
    assert esc_a["id_turno"] == ctx.T and esc_a["entrada"] == "14:00" and esc_a["minutos"] == 480   # A agora faz a tarde
    # desfazer: só decisor, com justificativa, e registra nova versão
    assert _erro(ctx.repo.wfm_desfazer_troca, ctx.sup, id_troca, "").status_code == 422
    assert _erro(ctx.repo.wfm_desfazer_troca, ctx.a, id_troca, "quero voltar").status_code == 403
    des = ctx.repo.wfm_desfazer_troca(ctx.sup, id_troca, "erro do pedido")
    assert des["estado"] == "DESFEITA" and des["versao"] == ap["versao"] + 1
    esc_a = {i["data"]: i for i in ctx.repo.wfm_get_escala(ctx.a, ctx.op, MES)["itens"]}["2027-03-06"]
    assert esc_a["id_turno"] == ctx.M
    aud = ctx.repo.wfm_list_auditoria(ctx.gestor, ctx.op, entidade="troca")
    assert {"solicitar_troca", "aceitar_troca", "aprovar_troca", "desfazer_troca"} <= {a["acao"] for a in aud}


def test_editar_a_escala_depois_do_pedido_invalida_a_troca(ctx):
    r = _solicitar(ctx, ctx.a, ctx.id_b, 6)
    ctx.repo.wfm_responder_troca(ctx.b, r["id_troca"], True)
    linha = next(i for i in ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)["itens"] if i["id_operador"] == ctx.id_a and i["data"].endswith("-06"))
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 6, ctx.T, linha["versao_linha"])])
    t = next(x for x in ctx.repo.wfm_list_trocas(ctx.sup, ctx.op) if x["id_troca"] == r["id_troca"])
    assert t["estado"] == "INVALIDADA" and any("avisados" in e["detalhe"] for e in t["linha_do_tempo"])
    assert _erro(ctx.repo.wfm_decidir_troca, ctx.sup, r["id_troca"], True).status_code == 409
    # restaura a base
    linha = next(i for i in ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)["itens"] if i["id_operador"] == ctx.id_a and i["data"].endswith("-06"))
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 6, ctx.M, linha["versao_linha"])])


def test_recusa_cancelamento_e_expiracao_por_prazo_util(ctx):
    r = _solicitar(ctx, ctx.a, ctx.id_b, 6)
    assert ctx.repo.wfm_responder_troca(ctx.b, r["id_troca"], False)["estado"] == "RECUSADA"
    r = _solicitar(ctx, ctx.a, ctx.id_b, 6)
    assert _erro(ctx.repo.wfm_cancelar_troca, ctx.b, r["id_troca"]).status_code == 403
    ctx.repo.wfm_cancelar_troca(ctx.a, r["id_troca"])
    # expiração: 48h úteis a partir da segunda 09:00 = quarta 09:00; depois disso a lista marca EXPIRADA
    r = _solicitar(ctx, ctx.a, ctx.id_b, 6)
    ctx.relogio["agora"] = datetime(2027, 3, 3, 9, 1)
    t = next(x for x in ctx.repo.wfm_list_trocas(ctx.a, ctx.op) if x["id_troca"] == r["id_troca"])
    assert t["estado"] == "EXPIRADA" and any("avisados" in e["detalhe"] for e in t["linha_do_tempo"])
    assert _erro(ctx.repo.wfm_responder_troca, ctx.b, r["id_troca"], True).status_code == 409
    ctx.relogio["agora"] = SEGUNDA


def test_escopo_de_leitura_das_trocas(ctx):
    r = _solicitar(ctx, ctx.a, ctx.id_b, 6)
    vis = lambda u: {x["id_troca"] for x in ctx.repo.wfm_list_trocas(u, ctx.op)}  # noqa: E731
    assert r["id_troca"] in vis(ctx.a) and r["id_troca"] in vis(ctx.b)
    assert r["id_troca"] not in vis(ctx.c)           # outro operador não vê
    assert r["id_troca"] in vis(ctx.sup) and r["id_troca"] not in vis(ctx.sup_fora)
    assert r["id_troca"] in vis(ctx.gestor) and r["id_troca"] in vis(ctx.cd)
    ctx.repo.wfm_cancelar_troca(ctx.a, r["id_troca"])


def test_exportacao_em_planilha_respeita_o_escopo(ctx):
    import io

    from openpyxl import load_workbook

    conteudo, nome, mime = ctx.repo.wfm_exportar_escala(ctx.gestor, ctx.op, MES, "xlsx")
    assert nome == f"escala_{ctx.op}_{MES}.xlsx" and "spreadsheetml" in mime
    wb = load_workbook(io.BytesIO(conteudo))
    assert wb.sheetnames == ["Escala", "Horários"]
    linhas = list(wb["Escala"].iter_rows(values_only=True))
    assert linhas[0][:2] == ("Operador", "Contrato") and linhas[0][-2:] == ("Dias trabalhados", "Horas no mês")
    assert {l[0] for l in linhas[1:]} == {"Op A", "Op B", "Op C", "Op D aprendiz"}
    a = next(l for l in linhas[1:] if l[0] == "Op A")
    assert a[1] == "CLT8" and a[-2] == 3 and a[-1] == 24.0          # 3 dias x 8h
    # Supervisor exporta só a própria equipe (A, B, C, D são dele; Sup Fora não tem ninguém)
    assert ctx.repo.wfm_exportar_escala(ctx.sup_fora, ctx.op, MES, "csv")[1].endswith(".csv")
    vazia = list(load_workbook(io.BytesIO(ctx.repo.wfm_exportar_escala(ctx.sup_fora, ctx.op, MES)[0]))["Escala"].iter_rows(values_only=True))
    assert len(vazia) == 1                                          # só o cabeçalho
    assert "wfm.escala.visualizar" not in ctx.a.permissions    # a rota de exportação exige essa permissão: o Operador não exporta

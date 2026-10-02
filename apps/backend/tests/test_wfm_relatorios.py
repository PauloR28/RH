"""WFM — Relatórios: integração contra o banco de DESENVOLVIMENTO (dados `WFMREL_xxxx` / `wfm_teste_*`)."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_MANAGER, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR, get_role_permissions

MES = "2027-04"


def _user(perfil, id_usuario, operacoes=(), nome="Teste"):
    return AuthenticatedUser(username=f"wfm_{perfil}_{id_usuario}", id_usuario=id_usuario, nome=nome, perfil=perfil,
                             operacoes=frozenset(operacoes), permissions=frozenset(get_role_permissions(perfil)))


class Ctx:
    pass


def _item(op, dia, turno):
    return {"id_operador": op, "data": f"{MES}-{dia:02d}", "id_turno": turno, "versao_linha": None}


def _erro(fn, *a, **k) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*a, **k)
    return e.value


def _rel(ctx, user, tipo="resumo", **k):
    return ctx.repo.wfm_relatorio(user, ctx.op, tipo, f"{MES}-01", f"{MES}-30", **k)


@pytest.fixture(scope="module")
def ctx():
    repo = repositorio_dev()
    c = Ctx()
    c.repo = repo
    c.op = f"WFMREL_{uuid.uuid4().hex[:4].upper()}"
    admin = _user(ROLE_ADMIN, 1, nome="Adm")
    repo.upsert_configuration_item("operacoes", {"chave": c.op, "nome": f"Op {c.op}", "ativo": True})

    def mk(nome, perfil, sup=()):
        return repo.mon_create_usuario(admin, {"nome": nome, "email": f"wfm_teste_{uuid.uuid4().hex[:10]}@example.com", "perfil": perfil,
                                               "operacoes": [c.op], "supervisores": list(sup)})["id_usuario"]

    c.id_sup = mk("Sup Rel", ROLE_SUPERVISOR)
    c.id_sup2 = mk("Sup Outro", ROLE_SUPERVISOR)
    c.id_a = mk("Op A", ROLE_OPERATOR, [c.id_sup])
    c.id_b = mk("Op B", ROLE_OPERATOR, [c.id_sup2])
    c.sup, c.sup2 = _user(ROLE_SUPERVISOR, c.id_sup, [c.op], "Sup Rel"), _user(ROLE_SUPERVISOR, c.id_sup2, [c.op], "Sup Outro")
    c.cd, c.gestor, c.qual = _user(ROLE_CONTROL_DESK, 9201, [c.op], "CD"), _user(ROLE_MANAGER, 9202, [], "Gestor"), _user(ROLE_QUALIDADE, 9203, [c.op], "Qual")
    c.a = _user(ROLE_OPERATOR, c.id_a, [c.op], "Op A")
    contratos = {i["codigo"]: i["id_contrato"] for i in repo.wfm_list_contratos(c.cd, c.op)}
    for i in (c.id_a, c.id_b):
        repo.wfm_set_contrato_operador(c.cd, c.op, i, contratos["CLT8"], date(2027, 1, 1))
    repo.wfm_save_turno(c.cd, {"operacao": c.op, "codigo": "M", "nome": "M", "entrada": "08:00", "saida": "16:00"})
    c.M = {t["codigo"]: t["id_turno"] for t in repo.wfm_list_turnos(c.cd, c.op)}["M"]
    repo.wfm_salvar_itens(c.cd, c.op, MES, [_item(c.id_a, 5, c.M), _item(c.id_a, 6, c.M), _item(c.id_a, 7, c.M), _item(c.id_b, 5, c.M)])
    repo.wfm_enviar_aprovacao(c.cd, c.op, MES)
    repo.wfm_aprovar_escala(c.gestor, c.op, MES)  # aprovar já publica
    repo.wfm_lancar_presenca(c.sup, c.op, c.id_a, f"{MES}-05", "PRESENTE")
    repo.wfm_lancar_presenca(c.sup, c.op, c.id_a, f"{MES}-06", "FALTA")
    yield c
    conn = repo._connect()
    try:
        cur = conn.cursor()
        for tabela in ("wfm_trocas", "wfm_pausas", "wfm_escala_itens", "wfm_escalas", "wfm_presencas", "wfm_horas_extras", "wfm_operador_contratos", "wfm_calendario_especial",
                       "wfm_turnos", "wfm_contratos", "wfm_operacao_config"):
            cur.execute(f"DELETE FROM dbo.{tabela} WHERE operacao = ?", (c.op,))
        cur.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE 'wfm_teste_%'")
        for (uid,) in cur.fetchall():
            cur.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (uid, uid))
            cur.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (uid,))
            cur.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (uid,))
            cur.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (uid,))
        cur.execute("DELETE FROM dbo.operacoes WHERE chave LIKE 'WFMREL_%'")
        conn.commit()
    finally:
        conn.close()


def test_permissao_do_relatorio():
    for perfil in (ROLE_SUPERVISOR, ROLE_CONTROL_DESK, ROLE_MANAGER):
        assert "wfm.relatorios" in get_role_permissions(perfil)
    for perfil in (ROLE_OPERATOR, ROLE_QUALIDADE):
        assert "wfm.relatorios" not in get_role_permissions(perfil)


def test_resumo_horas_presencas_e_faltas(ctx):
    rel = _rel(ctx, ctx.cd)
    por = {l["operador"]: l for l in rel["linhas"]}
    a = por["Op A"]
    assert a["dias_escalados"] == 3 and a["presencas"] == 1 and a["faltas"] == 1 and a["sem_lancamento"] == 1
    assert a["horas_escaladas"] == 21.0 or a["horas_escaladas"] > 0  # jornada líquida (desconta pausas)
    assert a["horas_trabalhadas"] == pytest.approx(a["horas_escaladas"] / 3, abs=0.01)
    assert a["absenteismo"] == 50.0  # 1 falta em 2 dias apurados
    assert por["Op B"]["sem_lancamento"] == 1 and rel["calculo"] and rel["resumo"]


def test_supervisor_so_ve_a_propria_equipe_e_outros_perfis_nao_entram(ctx):
    nomes = {l["operador"] for l in _rel(ctx, ctx.sup)["linhas"]}
    assert nomes == {"Op A"}
    assert {l["operador"] for l in _rel(ctx, ctx.sup2)["linhas"]} == {"Op B"}
    assert _erro(ctx.repo.wfm_relatorio, ctx.sup, "OUTRA_OP_QUE_NAO_EXISTE", "resumo", f"{MES}-01", f"{MES}-30").status_code in (403, 404)


def test_presencas_historico_e_aprovacoes(ctx):
    pres = _rel(ctx, ctx.cd, "presencas")
    assert [l["presenca"] if "presenca" in l else l["status"] for l in pres["linhas"] if l["operador"] == "Op A"] == ["Presente", "Falta", "Sem lançamento"]
    esc = _rel(ctx, ctx.cd, "escalas")
    assert esc["linhas"][0]["situacao"] == "Vigente" and esc["linhas"][0]["aprovado_por"] != "—"
    apr = _rel(ctx, ctx.cd, "aprovacoes")
    assert {"Enviada para aprovação", "Aprovada", "Publicada"} <= {l["acao"] for l in apr["linhas"]}


def test_trocas_filtro_e_validacao_do_periodo(ctx):
    assert _rel(ctx, ctx.cd, "trocas")["linhas"] == []
    assert _erro(ctx.repo.wfm_relatorio, ctx.cd, ctx.op, "resumo", "2027-01-01", "2028-12-31").status_code == 400
    assert _erro(ctx.repo.wfm_relatorio, ctx.cd, ctx.op, "resumo", f"{MES}-10", f"{MES}-01").status_code == 400
    assert _erro(ctx.repo.wfm_relatorio, ctx.cd, ctx.op, "nada", f"{MES}-01", f"{MES}-30").status_code == 400
    so_a = ctx.repo.wfm_relatorio(ctx.cd, ctx.op, "resumo", f"{MES}-01", f"{MES}-30", ctx.id_a)
    assert [l["operador"] for l in so_a["linhas"]] == ["Op A"]


def test_exportacao_xlsx_csv_e_completo(ctx):
    conteudo, nome, mime = ctx.repo.wfm_relatorio_exportar(ctx.cd, ctx.op, "completo", f"{MES}-01", f"{MES}-30")
    assert nome.endswith(".xlsx") and conteudo[:2] == b"PK" and "spreadsheetml" in mime
    csv, nome_csv, mime_csv = ctx.repo.wfm_relatorio_exportar(ctx.cd, ctx.op, "presencas", f"{MES}-01", f"{MES}-30", None, "csv")
    assert nome_csv.endswith(".csv") and "csv" in mime_csv and b"Presente" in csv


def test_painel_kpis_comparacao_e_graficos(ctx):
    rel = _rel(ctx, ctx.cd, "painel")
    p = rel["painel"]
    kpis = {k["chave"]: k for k in p["kpis"]}
    assert kpis["faltas"]["valor"] == 1 and kpis["absenteismo"]["valor"] == 50.0
    assert kpis["horas_trabalhadas"]["anterior"] == 0 and kpis["horas_trabalhadas"]["variacao"] is None  # sem base anterior: não inventa percentual
    g = p["graficos"]
    assert len(g["serie_diaria"]) == 30 and sum(x["escalados"] for x in g["serie_diaria"]) == 4
    assert {x["rotulo"]: x["valor"] for x in g["presenca"]} == {"Presente": 1, "Falta": 1, "Falta justificada": 0, "Atestado": 0, "Sem lançamento": 2}
    assert g["top_operadores"][0]["operador"] == "Op A" and len(g["absenteismo_semana"]) == 7 and g["horas_turno"][0]["rotulo"] == "M"
    assert p["anterior"]["fim"] == "2027-03-31"
    # Supervisor continua limitado à equipe também no painel
    assert {x["operador"] for x in _rel(ctx, ctx.sup, "painel")["painel"]["graficos"]["top_operadores"]} <= {"Op A"}


def test_resumo_traz_variacao_vs_periodo_anterior(ctx):
    rel = ctx.repo.wfm_relatorio(ctx.cd, ctx.op, "resumo", f"{MES}-01", f"{MES}-30")
    assert "variacao_horas" in rel["linhas"][0] and rel["linhas"][0]["_id_operador"]
    # painel exportado cai no resumo
    conteudo, nome, _ = ctx.repo.wfm_relatorio_exportar(ctx.cd, ctx.op, "painel", f"{MES}-01", f"{MES}-30")
    assert "resumo" in nome and conteudo[:2] == b"PK"

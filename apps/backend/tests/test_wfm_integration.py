"""WFM Fase 1 — testes de INTEGRAÇÃO contra o banco de DESENVOLVIMENTO.

Pulados quando não há banco de DEV acessível; nunca rodam contra produção.
Dados de teste usam a operação `WFMTESTE_xxxx` e usuários `wfm_teste_*`. Tabelas
imutáveis (versões, auditoria) mantêm seus registros por desenho."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import (
    ROLE_ADMIN,
    ROLE_CONTROL_DESK,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_QUALIDADE,
    ROLE_SUPERVISOR,
    get_role_permissions,
)

MES = "2027-03"


def _user(perfil, id_usuario, operacoes=(), nome="Teste"):
    return AuthenticatedUser(
        username=f"wfm_{perfil}_{id_usuario}", id_usuario=id_usuario, nome=nome, perfil=perfil,
        operacoes=frozenset(operacoes), permissions=frozenset(get_role_permissions(perfil)),
    )


class Ctx:
    pass


@pytest.fixture(scope="module")
def ctx():
    repo = repositorio_dev()
    c = Ctx()
    c.repo = repo
    c.op = f"WFMTESTE_{uuid.uuid4().hex[:4].upper()}"
    c.outra = f"WFMTESTE_{uuid.uuid4().hex[:4].upper()}"
    admin = _user(ROLE_ADMIN, 1, nome="Adm")
    for chave in (c.op, c.outra):
        repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": f"Op {chave}", "ativo": True})

    def mk(nome, perfil, operacoes, supervisores=()):
        return repo.mon_create_usuario(
            admin,
            {"nome": nome, "email": f"wfm_teste_{uuid.uuid4().hex[:10]}@example.com", "perfil": perfil,
             "operacoes": list(operacoes), "supervisores": list(supervisores)},
        )["id_usuario"]

    c.id_sup = mk("Sup Wfm", ROLE_SUPERVISOR, [c.op])
    c.id_sup2 = mk("Sup2 Wfm", ROLE_SUPERVISOR, [c.op])
    c.id_a = mk("Op A", ROLE_OPERATOR, [c.op], [c.id_sup])
    c.id_b = mk("Op B", ROLE_OPERATOR, [c.op], [c.id_sup])
    c.id_c = mk("Op C", ROLE_OPERATOR, [c.op], [c.id_sup2])  # equipe de OUTRO supervisor
    c.id_sup_outra = mk("Sup Outra", ROLE_SUPERVISOR, [c.outra])
    c.sup = _user(ROLE_SUPERVISOR, c.id_sup, [c.op], "Sup Wfm")
    c.sup_outra = _user(ROLE_SUPERVISOR, c.id_sup_outra, [c.outra], "Sup Outra")
    c.cd = _user(ROLE_CONTROL_DESK, 9001, [c.op], "CD")
    c.gestor = _user(ROLE_MANAGER, 9002, [], "Gestor")
    c.gestor2 = _user(ROLE_MANAGER, 9003, [], "Gestor 2")
    c.qual = _user(ROLE_QUALIDADE, 9004, [c.op], "Qualidade")
    c.admin = admin
    c.op_a = _user(ROLE_OPERATOR, c.id_a, [c.op], "Op A")
    c.op_b = _user(ROLE_OPERATOR, c.id_b, [c.op], "Op B")

    contratos = {i["codigo"]: i["id_contrato"] for i in repo.wfm_list_contratos(c.cd, c.op)}
    c.clt8, c.est6 = contratos["CLT8"], contratos["EST6"]
    for id_op in (c.id_a, c.id_b):
        repo.wfm_set_contrato_operador(c.cd, c.op, id_op, c.clt8, date(2027, 1, 1))
    repo.wfm_set_contrato_operador(c.cd, c.op, c.id_c, c.est6, date(2027, 1, 1))
    for codigo, ent, sai in (("M", "08:00", "16:00"), ("T", "14:00", "22:00")):
        repo.wfm_save_turno(c.cd, {"operacao": c.op, "codigo": codigo, "nome": codigo, "entrada": ent, "saida": sai})
    turnos = {t["codigo"]: t["id_turno"] for t in repo.wfm_list_turnos(c.cd, c.op)}
    c.M, c.T, c.FOLGA = turnos["M"], turnos["T"], turnos["FOLGA"]
    yield c
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        for chave in (c.op, c.outra):
            for tabela in (
                "wfm_escala_itens", "wfm_escalas", "wfm_presencas", "wfm_atestados", "wfm_operador_contratos",
                "wfm_usuario_skills", "wfm_skills", "wfm_calendario_especial", "wfm_turnos", "wfm_contratos",
            ):
                cursor.execute(f"DELETE FROM dbo.{tabela} WHERE operacao = ?", (chave,))
        cursor.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE 'wfm_teste_%'")
        for (id_usuario,) in cursor.fetchall():
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (id_usuario, id_usuario))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
        cursor.execute("DELETE FROM dbo.operacoes WHERE chave LIKE 'WFMTESTE_%'")
        conn.commit()
    finally:
        conn.close()


def _item(id_operador, dia, id_turno, versao=None):
    return {"id_operador": id_operador, "data": f"{MES}-{dia:02d}", "id_turno": id_turno, "versao_linha": versao}


def _erro(fn, *a, **k) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*a, **k)
    return e.value


def test_padroes_semeados_e_editaveis_por_control_desk(ctx):
    cods = {c["codigo"] for c in ctx.repo.wfm_list_contratos(ctx.cd, ctx.op)}
    assert {"EST4", "EST6", "CLT6", "CLT8", "TERCEIRO"} <= cods
    e = _erro(ctx.repo.wfm_save_contrato, ctx.sup, {"operacao": ctx.op, "codigo": "X", "nome": "X", "tipo": "CLT",
              "jornada_diaria_max_min": 480, "interjornada_min_min": 660, "max_dias_consecutivos": 6})
    assert e.status_code == 403  # Supervisor não edita contratos


def test_acesso_cruzado_entre_operacoes_e_negado(ctx):
    assert _erro(ctx.repo.wfm_get_escala, ctx.sup_outra, ctx.op, MES).status_code == 403
    assert _erro(ctx.repo.wfm_list_contratos, ctx.sup_outra, ctx.op).status_code == 403
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.sup_outra, ctx.op, MES, [_item(ctx.id_a, 1, ctx.M)]).status_code == 403
    assert _erro(ctx.repo.wfm_lancar_presenca, ctx.sup_outra, ctx.op, ctx.id_a, f"{MES}-01", "FALTA").status_code == 403


def test_supervisor_edita_so_a_propria_equipe(ctx):
    assert ctx.repo.wfm_salvar_itens(ctx.sup, ctx.op, MES, [_item(ctx.id_a, 1, ctx.M)])["alteradas"] == 1
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.sup, ctx.op, MES, [_item(ctx.id_c, 1, ctx.M)]).status_code == 403
    esc = ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)
    assert {o["id_usuario"] for o in esc["operadores"]} == {ctx.id_a, ctx.id_b}  # nunca a equipe do outro


def test_qualidade_le_mas_nao_edita_e_admin_nao_edita(ctx):
    assert ctx.repo.wfm_get_escala(ctx.qual, ctx.op, MES)["pode_editar"] is False
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.qual, ctx.op, MES, [_item(ctx.id_a, 2, ctx.M)]).status_code == 403
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.admin, ctx.op, MES, [_item(ctx.id_a, 2, ctx.M)]).status_code == 403
    assert _erro(ctx.repo.wfm_publicar, ctx.admin, ctx.op, MES).status_code == 403


def test_edicao_concorrente_gera_conflito_409(ctx):
    linha = next(i for i in ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)["itens"] if i["id_operador"] == ctx.id_a)
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 1, ctx.T, linha["versao_linha"])])  # CD edita primeiro
    e = _erro(ctx.repo.wfm_salvar_itens, ctx.sup, ctx.op, MES, [_item(ctx.id_a, 1, ctx.M, linha["versao_linha"])])
    assert e.status_code == 409 and e.detail["conflitos"][0]["alterado_por"]
    # volta ao turno M com a versão correta
    atual = next(i for i in ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)["itens"] if i["id_operador"] == ctx.id_a)
    ctx.repo.wfm_salvar_itens(ctx.sup, ctx.op, MES, [_item(ctx.id_a, 1, ctx.M, atual["versao_linha"])])


def test_publicar_versiona_e_operador_ve_so_o_publicado_proprio(ctx):
    ctx.repo.wfm_salvar_itens(ctx.sup, ctx.op, MES, [_item(ctx.id_a, d, ctx.M) for d in (2, 3)] if False else [_item(ctx.id_a, 2, ctx.M), _item(ctx.id_a, 3, ctx.M), _item(ctx.id_b, 1, ctx.M)])
    assert ctx.repo.wfm_get_escala(ctx.op_a, ctx.op, MES)["itens"] == []  # nada publicado ainda
    v1 = ctx.repo.wfm_publicar(ctx.sup, ctx.op, MES)
    assert v1["versao"] == 1 and not v1["com_violacao"]
    escala_op = ctx.repo.wfm_get_escala(ctx.op_a, ctx.op, MES)
    assert escala_op["fonte"] == "publicada" and {i["id_operador"] for i in escala_op["itens"]} == {ctx.id_a}
    assert [o["id_usuario"] for o in escala_op["operadores"]] == [ctx.id_a]  # sem colegas
    # editar depois de publicar NÃO altera o que o operador vê
    ctx.repo.wfm_salvar_itens(ctx.sup, ctx.op, MES, [_item(ctx.id_a, 4, ctx.M)])
    assert len(ctx.repo.wfm_get_escala(ctx.op_a, ctx.op, MES)["itens"]) == 3
    v2 = ctx.repo.wfm_publicar(ctx.sup, ctx.op, MES)
    assert v2["versao"] == 2
    assert [v["versao"] for v in ctx.repo.wfm_list_versoes(ctx.sup, ctx.op, MES)] == [2, 1]


def test_versoes_e_auditoria_sao_imutaveis_no_banco(ctx):
    conn = ctx.repo._connect()
    try:
        cursor = conn.cursor()
        for sql in (
            "UPDATE dbo.wfm_escala_versoes SET justificativa = 'x' WHERE operacao = ?",
            "DELETE FROM dbo.wfm_escala_versoes WHERE operacao = ?",
            "UPDATE dbo.wfm_auditoria SET acao = 'x' WHERE operacao = ?",
            "DELETE FROM dbo.wfm_auditoria WHERE operacao = ?",
        ):
            with pytest.raises(Exception) as e:
                cursor.execute(sql, (ctx.op,))
            assert "imutavel" in str(e.value).lower()
    finally:
        conn.close()


def test_violacao_bloqueia_supervisor_e_gestor_publica_com_justificativa(ctx):
    linha = next(i for i in ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)["itens"] if i["id_operador"] == ctx.id_b and i["data"].endswith("-01"))
    # B: 01 turno T (14-22) e 02 turno M (08h) => interjornada de 10h
    ctx.repo.wfm_salvar_itens(ctx.sup, ctx.op, MES, [_item(ctx.id_b, 1, ctx.T, linha["versao_linha"]), _item(ctx.id_b, 2, ctx.M)])
    val = ctx.repo.wfm_validar(ctx.sup, ctx.op, MES)
    assert val["bloqueio"] and not val["bloqueio_duro"] and val["violacoes"][0]["codigo"] == "INTERJORNADA"
    assert _erro(ctx.repo.wfm_publicar, ctx.sup, ctx.op, MES).status_code == 422
    assert _erro(ctx.repo.wfm_publicar, ctx.cd, ctx.op, MES).status_code == 422
    assert _erro(ctx.repo.wfm_publicar, ctx.gestor, ctx.op, MES).status_code == 422  # sem justificativa
    r = ctx.repo.wfm_publicar(ctx.gestor, ctx.op, MES, justificativa="cobertura de campanha aprovada")
    assert r["com_violacao"] and r["versao"] == 3
    aud = ctx.repo.wfm_list_auditoria(ctx.gestor, ctx.op, entidade="escala")
    assert any(a["acao"] == "publicar_com_violacao" and a["justificativa"] for a in aud)


def test_violacao_de_lei_do_estagiario_nem_o_gestor_publica(ctx):
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_c, 5, ctx.M)])  # estagiário 6h com turno de 8h
    e = _erro(ctx.repo.wfm_publicar, ctx.gestor, ctx.op, MES, justificativa="tentativa")
    assert e.status_code == 422 and "lei" in e.detail["mensagem"].lower()
    linha = next(i for i in ctx.repo.wfm_get_escala(ctx.gestor, ctx.op, MES)["itens"] if i["id_operador"] == ctx.id_c)
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_c, 5, None, linha["versao_linha"])])


def test_fechamento_so_gestor_corrige_com_justificativa(ctx):
    ctx.repo.wfm_publicar(ctx.gestor, ctx.op, MES, justificativa="mantida")  # publica o rascunho atual
    ctx.repo.wfm_fechar_periodo(ctx.sup, ctx.op, MES)
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.sup, ctx.op, MES, [_item(ctx.id_a, 8, ctx.M)]).status_code == 403
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.gestor, ctx.op, MES, [_item(ctx.id_a, 8, ctx.M)]).status_code == 422  # sem justificativa
    assert ctx.repo.wfm_salvar_itens(ctx.gestor, ctx.op, MES, [_item(ctx.id_a, 8, ctx.M)], justificativa="erro de digitação")["alteradas"] == 1
    aud = ctx.repo.wfm_list_auditoria(ctx.gestor, ctx.op, entidade="escala_item")
    assert any(a["acao"] == "corrigir_escala_fechada" and a["justificativa"] for a in aud)
    assert _erro(ctx.repo.wfm_fechar_periodo, ctx.sup, ctx.op, MES).status_code == 409  # já fechado


def test_conflito_de_interesse_ninguem_edita_a_propria_escala(ctx):
    gestor_operador = _user(ROLE_MANAGER, ctx.id_a, [], "Gestor que e operador")
    assert _erro(ctx.repo.wfm_salvar_itens, gestor_operador, ctx.op, MES, [_item(ctx.id_a, 20, ctx.M)], justificativa="x").status_code == 403
    assert _erro(ctx.repo.wfm_lancar_presenca, gestor_operador, ctx.op, ctx.id_a, f"{MES}-20", "FALTA").status_code in (403,)


def test_presenca_sem_prazo_e_atestado_sem_arquivo(ctx):
    # Sem prazo: lança e corrige em qualquer data (aqui, mês passado e futuro).
    ctx.repo.wfm_lancar_presenca(ctx.sup, ctx.op, ctx.id_a, "2026-01-05", "FALTA")
    ctx.repo.wfm_lancar_presenca(ctx.sup, ctx.op, ctx.id_a, "2026-01-05", "PRESENTE", "corrigido")
    assert _erro(ctx.repo.wfm_lancar_presenca, ctx.sup, ctx.op, ctx.id_c, "2027-03-05", "FALTA").status_code == 403  # fora da equipe
    ctx.repo.wfm_registrar_atestado(ctx.sup, ctx.op, ctx.id_a, "2027-03-10", "2027-03-12", "MEDICO")
    pres = {p["data"]: p["status"] for p in ctx.repo.wfm_list_presencas(ctx.sup, ctx.op, MES)}
    assert pres["2027-03-11"] == "ATESTADO"
    ats = ctx.repo.wfm_list_atestados(ctx.sup, ctx.op, MES)
    assert set(ats[0]) == {"id_atestado", "id_operador", "data_ini", "data_fim", "tipo", "validado_por"}
    # Operador vê só a própria presença; Qualidade não lê atestado (sem permissão de presença).
    assert {p["id_operador"] for p in ctx.repo.wfm_list_presencas(ctx.op_b, ctx.op, MES)} <= {ctx.id_b}
    assert "wfm.presenca.lancar" not in ctx.qual.permissions


def test_calendario_especial_salva_e_valida(ctx):
    r = ctx.repo.wfm_save_evento(ctx.sup, {"operacao": ctx.op, "tipo": "FERIADO", "data_ini": "2027-03-25", "descricao": "Feriado teste"})
    assert r["id_item"]
    assert _erro(ctx.repo.wfm_save_evento, ctx.sup, {"operacao": ctx.op, "tipo": "HORARIO_ESPECIAL", "data_ini": "2027-03-26", "descricao": "x"}).status_code == 400
    ctx.repo.wfm_save_evento(ctx.cd, {"operacao": ctx.op, "tipo": "HORARIO_ESPECIAL", "data_ini": "2027-03-26", "descricao": "Turno curto", "id_turno": ctx.M, "entrada": "09:00", "saida": "13:00"})
    assert len(ctx.repo.wfm_list_calendario(ctx.qual, ctx.op, MES)) == 2


def test_auditoria_so_gestor_e_adm_leem(ctx):
    assert "wfm.auditoria" in ctx.gestor.permissions and "wfm.auditoria" in ctx.admin.permissions
    for u in (ctx.sup, ctx.cd, ctx.qual, ctx.op_a):
        assert "wfm.auditoria" not in u.permissions
    assert ctx.repo.wfm_list_auditoria(ctx.gestor, ctx.op)
    assert ctx.repo.wfm_list_auditoria(ctx.gestor2, "") is not None


def test_control_desk_pode_ser_vinculado_a_operacoes(ctx):
    """Regressão: o Control Desk era impedido de receber vínculo de operação; o WFM precisa dele."""
    repo = ctx.repo
    criado = repo.mon_create_usuario(
        ctx.admin,
        {"nome": "CD Vinculado", "email": f"wfm_teste_{uuid.uuid4().hex[:10]}@example.com", "perfil": ROLE_CONTROL_DESK, "operacoes": [ctx.op]},
    )
    assert repo.mon_get_vinculos(criado["id_usuario"])["operacoes"] == [ctx.op]
    # "Editar usuário": grava outro vínculo e confere (o bug era justamente aqui)
    repo.mon_set_vinculos(ctx.admin, criado["id_usuario"], {"operacoes": [ctx.outra]})
    assert repo.mon_get_vinculos(criado["id_usuario"])["operacoes"] == [ctx.outra]
    repo.mon_set_vinculos(ctx.admin, criado["id_usuario"], {"operacoes": [ctx.op, ctx.outra]})
    assert sorted(repo.mon_get_vinculos(criado["id_usuario"])["operacoes"]) == sorted([ctx.op, ctx.outra])
    # vinculado, o Control Desk enxerga a operação no WFM; sem vínculo, nenhuma
    cd = _user(ROLE_CONTROL_DESK, criado["id_usuario"], [ctx.op, ctx.outra], "CD Vinculado")
    assert {o["chave"] for o in repo.wfm_contexto(cd)["operacoes"]} == {ctx.op, ctx.outra}
    assert repo.wfm_contexto(_user(ROLE_CONTROL_DESK, criado["id_usuario"], [], "CD"))["operacoes"] == []


def test_semeio_de_padroes_tolera_requisicoes_simultaneas(ctx):
    """Regressão: a tela de Cadastros faz 5 chamadas em paralelo; o semeio não pode estourar a chave única."""
    from concurrent.futures import ThreadPoolExecutor

    repo = ctx.repo
    nova = f"WFMTESTE_{uuid.uuid4().hex[:4].upper()}"
    repo.upsert_configuration_item("operacoes", {"chave": nova, "nome": f"Op {nova}", "ativo": True})
    gestor = _user(ROLE_MANAGER, 9010, [], "Gestor")
    try:
        chamadas = [lambda: repo.wfm_list_contratos(gestor, nova), lambda: repo.wfm_list_turnos(gestor, nova),
                    lambda: repo.wfm_list_skills(gestor, nova), lambda: repo.wfm_list_calendario(gestor, nova),
                    lambda: repo.wfm_get_escala(gestor, nova, "2027-03")] * 2
        with ThreadPoolExecutor(max_workers=10) as pool:
            resultados = [f.result() for f in [pool.submit(c) for c in chamadas]]
        assert len(resultados) == 10
        assert {c["codigo"] for c in repo.wfm_list_contratos(gestor, nova)} >= {"CLT8", "APR6"}
    finally:
        conn = repo._connect()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM dbo.wfm_contratos WHERE operacao = ?", (nova,))
            cur.execute("DELETE FROM dbo.wfm_turnos WHERE operacao = ?", (nova,))
            cur.execute("DELETE FROM dbo.wfm_escalas WHERE operacao = ?", (nova,))
            conn.commit()
        finally:
            conn.close()

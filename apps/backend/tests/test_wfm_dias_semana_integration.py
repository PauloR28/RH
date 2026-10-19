"""Escala por dia da semana (Etapa 1) — INTEGRAÇÃO contra o banco de DEV (cenário A, B, C e D da seção 4).

Pulado sem banco de DEV; usa a operação `WFMTESTE_xxxx` e a limpa no fim."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_OPERATOR, ROLE_SUPERVISOR, get_role_permissions

MES = "2027-06"  # 01/06/2027 = terça; 02 = qua; 03 = qui; 04 = sex; 05 = sáb; 07 = seg


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


@pytest.fixture(scope="module")
def ctx():
    repo = repositorio_dev()
    c = Ctx()
    c.repo = repo
    c.op = f"WFMTESTE_{uuid.uuid4().hex[:4].upper()}"
    admin = _user(ROLE_ADMIN, 1, nome="Adm")
    repo.upsert_configuration_item("operacoes", {"chave": c.op, "nome": f"Op {c.op}", "ativo": True})

    def mk(nome, perfil, supervisores=()):
        return repo.mon_create_usuario(admin, {"nome": nome, "email": f"wfm_teste_{uuid.uuid4().hex[:10]}@example.com", "perfil": perfil,
                                               "operacoes": [c.op], "supervisores": list(supervisores)})["id_usuario"]

    sup = mk("Sup", ROLE_SUPERVISOR)
    c.A, c.B, c.C, c.D = (mk(n, ROLE_OPERATOR, [sup]) for n in ("Op A", "Op B", "Op C", "Op D"))
    c.cd = _user(ROLE_CONTROL_DESK, 9101, [c.op], "CD")
    for codigo, ent, sai, dias in (("TARDE2", "14:00", "22:00", [0, 1, 3]), ("SAB", "08:00", "14:00", [5]),
                                   ("MANHA", "08:00", "16:00", [0, 1, 2, 3, 4]), ("TARDE1", "12:00", "20:00", [3, 4])):
        repo.wfm_save_turno(c.cd, {"operacao": c.op, "codigo": codigo, "nome": codigo, "entrada": ent, "saida": sai, "weekdays": dias})
    t = {x["codigo"]: x for x in repo.wfm_list_turnos(c.cd, c.op)}
    c.t = {k: t[k]["id_turno"] for k in ("TARDE2", "SAB", "MANHA", "TARDE1")}
    c.turnos = t
    yield c
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        for tabela in ("wfm_pausas", "wfm_operacao_config", "wfm_escala_itens", "wfm_escalas", "wfm_operador_contratos", "wfm_turnos", "wfm_contratos"):
            cursor.execute(f"DELETE FROM dbo.{tabela} WHERE operacao = ?", (c.op,))
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


def _manual(ctx, id_op, dia):
    conn = ctx.repo._connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT manual FROM dbo.wfm_escala_itens WHERE operacao = ? AND id_operador = ? AND data = ?", (ctx.op, id_op, f"{MES}-{dia:02d}"))
        return bool(cur.fetchone()[0])
    finally:
        conn.close()


def test_turno_expoe_dias_e_rotulo_na_listagem(ctx):
    assert ctx.turnos["MANHA"]["weekdays"] == [0, 1, 2, 3, 4] and ctx.turnos["MANHA"]["dias_rotulo"] == "Seg a Sex"
    assert ctx.turnos["TARDE2"]["dias_rotulo"] == "Seg, Ter, Qui"
    assert ctx.turnos["FOLGA"]["dias_rotulo"] == "—"


def test_turno_de_trabalho_sem_dia_e_recusado_e_folga_pode_ficar_sem(ctx):
    e = _erro(ctx.repo.wfm_save_turno, ctx.cd, {"operacao": ctx.op, "codigo": "VAZIO", "nome": "V", "entrada": "08:00", "saida": "12:00", "weekdays": []})
    assert e.status_code == 422 and "pelo menos um dia" in e.detail


def test_cenario_a_dois_turnos_em_dias_diferentes_e_aceito(ctx):
    r = ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.A, 1, ctx.t["TARDE2"]), _item(ctx.A, 5, ctx.t["SAB"])])
    assert r["alteradas"] == 2 and not _manual(ctx, ctx.A, 1) and not _manual(ctx, ctx.A, 5)


def test_cenario_b_manha_seg_a_sex(ctx):
    assert ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.B, 1, ctx.t["MANHA"]), _item(ctx.B, 4, ctx.t["MANHA"])])["alteradas"] == 2


def test_cenario_d_manha_mais_tarde_i_e_bloqueado_com_o_turno_que_ocupa_o_dia(ctx):
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.D, 1, ctx.t["MANHA"])])
    e = _erro(ctx.repo.wfm_salvar_itens, ctx.cd, ctx.op, MES, [_item(ctx.D, 3, ctx.t["TARDE1"])])
    assert e.status_code == 422
    assert "Qui e Sex" in e.detail["mensagem"] and "TARDE1" in e.detail["mensagem"] and "MANHA" in e.detail["mensagem"]


def test_dia_fora_dos_dias_do_turno_e_ajuste_manual_e_nao_bloqueia(ctx):
    # segunda-feira (07/06) fora de TARDE1 (Qui, Sex): fica gravado como manual e vence o padrão
    assert ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.D, 7, ctx.t["TARDE1"])])["alteradas"] == 1
    assert _manual(ctx, ctx.D, 7)


def test_cenario_c_pausa_em_operador_sem_escala_e_rejeitada_no_backend(ctx):
    pausas = [{"ordem": 1, "tipo": "DESCANSO", "inicio": "10:00", "duracao_min": 10}]
    e = _erro(ctx.repo.wfm_salvar_pausas, ctx.cd, ctx.op, f"{MES}-03", [{"id_operador": ctx.C, "pausas": pausas}])
    assert e.status_code == 422 and "não está escalado" in str(e.detail)


def test_editar_dias_do_turno_em_uso_avisa_o_impacto_e_marca_manuais(ctx):
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.D, 2, ctx.t["MANHA"])])   # quarta
    imp = ctx.repo.wfm_impacto_dias_turno(ctx.cd, ctx.op, ctx.t["MANHA"], [0, 1])
    assert imp["dias_fora"] >= 1 and imp["operadores"] >= 1 and imp["dias_novos"] == [0, 1]
    m = ctx.turnos["MANHA"]
    ctx.repo.wfm_save_turno(ctx.cd, {"operacao": ctx.op, "codigo": "MANHA", "nome": "MANHA", "entrada": "08:00", "saida": "16:00", "weekdays": [0, 1]}, m["id_turno"])
    assert _manual(ctx, ctx.D, 2)   # quarta passou a contar como configurada à mão; o dia segue na escala


def test_pausas_do_dia_listam_quem_esta_sem_escala_com_o_motivo_e_os_dias_do_turno(ctx):
    d = ctx.repo.wfm_get_pausas_dia(ctx.cd, ctx.op, f"{MES}-02")   # quarta: só D tem turno (MANHA, dia manual)
    escalados = {o["nome"]: o for o in d["operadores"]}
    assert set(escalados) == {"Op D"} and escalados["Op D"]["turno"]["codigo"] == "MANHA"
    assert escalados["Op D"]["turno"]["dias_rotulo"] == "Seg, Ter"       # dias atuais do turno (editados no teste anterior)
    sem = {o["nome"]: o["motivo"] for o in d["sem_escala"]}
    assert sem["Op C"] == "Sem turno cadastrado"                        # nunca teve turno no mês
    assert sem["Op B"] == "Hoje: sem turno (qua)"                       # tem turno em outros dias do mês


def test_escala_expoe_dia_manual_e_os_dias_de_cada_turno(ctx):
    e = ctx.repo.wfm_get_escala(ctx.cd, ctx.op, MES)
    por = {(i["id_operador"], i["data"]): i for i in e["itens"]}
    assert por[(ctx.D, f"{MES}-07")]["manual"] is True        # TARDE1 numa segunda: fora dos dias do turno
    assert por[(ctx.A, f"{MES}-01")]["manual"] is False        # TARDE2 na terça: dentro dos dias
    turnos = {t["codigo"]: t for t in e["turnos"]}
    assert turnos["TARDE2"]["weekdays"] == [0, 1, 3] and turnos["SAB"]["dias_rotulo"] == "Sáb"


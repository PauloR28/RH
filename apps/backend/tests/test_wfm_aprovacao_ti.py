"""WFM — aprovação da escala antes de publicar e setor de TI (tipos de escala, Técnicos, Analista de TI).

Parte pura (escopo/RBAC/migration) roda sempre; a parte de INTEGRAÇÃO roda contra o banco de DEV
(pulada sem banco; nunca contra produção). Dados de teste: operação `WFMAPR_xxxx` / `WFMTI_xxxx`."""

from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.auth import AuthenticatedUser
from rh_api.rbac import (
    ROLE_ADMIN,
    ROLE_ANALISTA_TI,
    ROLE_CONTROL_DESK,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_SUPERVISOR,
    ROLE_TEC_PLENO,
    get_role_permissions,
)
from rh_api.services import wfm_scope

REPO_ROOT = Path(__file__).resolve().parents[3]
MES = "2027-05"


def _user(perfil, id_usuario, operacoes=(), nome="Teste"):
    return AuthenticatedUser(
        username=f"wfm_{perfil}_{id_usuario}", id_usuario=id_usuario, nome=nome, perfil=perfil,
        operacoes=frozenset(operacoes), permissions=frozenset(get_role_permissions(perfil)),
    )


def _erro(fn, *args, **kwargs) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        fn(*args, **kwargs)
    return e.value


# ---------------------------------------------------------------- parte pura
def test_migration_v051_e_gerada_do_mesmo_ddl():
    from rh_api.repositories.wfm_schema import render_migration_aprovacao_ti_sql

    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V051__wfm_aprovacao_ti.sql"
    sql = render_migration_aprovacao_ti_sql()
    assert arquivo.read_text(encoding="utf-8") == sql
    assert "aprov_estado" in sql and "wfm_tipos_escala" in sql and "TI::SOBREAVISO" in sql and "DROP " not in sql.upper()


def test_operacao_base_e_escopo_dos_tipos_de_escala():
    assert wfm_scope.operacao_base("TI::SOBREAVISO") == "TI" and wfm_scope.operacao_base("C24H") == "C24H"
    assert wfm_scope.pode_ver_operacao(ROLE_ANALISTA_TI, ["TI"], "TI::PLANTAO-SABADO")
    assert not wfm_scope.pode_ver_operacao(ROLE_ANALISTA_TI, ["C24H"], "TI::PLANTAO-SABADO")


def test_quem_aprova_a_escala():
    base = dict(operacoes_usuario=["OP"], operacao="OP", id_enviou=10, ids_na_escala=[1, 2])
    assert wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=20, **base)[0]
    assert wfm_scope.pode_aprovar_escala(perfil=ROLE_MANAGER, id_usuario=20, **base)[0]
    assert not wfm_scope.pode_aprovar_escala(perfil=ROLE_CONTROL_DESK, id_usuario=20, **base)[0]
    assert not wfm_scope.pode_aprovar_escala(perfil=ROLE_ADMIN, id_usuario=20, **base)[0]
    assert not wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=10, **base)[0]  # quem enviou
    assert not wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=2, **base)[0]  # consta na escala
    ti = dict(operacoes_usuario=["TI"], operacao="TI::SOBREAVISO", id_enviou=10, ids_na_escala=[10])
    assert wfm_scope.pode_aprovar_escala(perfil=ROLE_ANALISTA_TI, id_usuario=10, **ti)[0]  # gestor único do TI


def test_migration_v052_config_escala_e_gerada_do_mesmo_ddl():
    from rh_api.repositories.wfm_schema import render_migration_config_escala_sql

    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V052__wfm_config_escala.sql"
    sql = render_migration_config_escala_sql()
    assert arquivo.read_text(encoding="utf-8") == sql and "nome_escala" in sql and "wfm_aprovadores" in sql and "DROP " not in sql.upper()


def test_aprovadores_configurados_restringem_quem_aprova():
    base = dict(operacoes_usuario=["OP"], operacao="OP", id_enviou=10, ids_na_escala=[1])
    so_usuario = {"perfis": [], "usuarios": [20]}
    assert wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=20, aprovadores=so_usuario, **base)[0]
    assert not wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=21, aprovadores=so_usuario, **base)[0]
    so_gestor = {"perfis": [ROLE_MANAGER], "usuarios": []}
    assert wfm_scope.pode_aprovar_escala(perfil=ROLE_MANAGER, id_usuario=30, aprovadores=so_gestor, **base)[0]
    assert not wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=20, aprovadores=so_gestor, **base)[0]
    assert wfm_scope.pode_aprovar_escala(perfil=ROLE_SUPERVISOR, id_usuario=21, aprovadores={"perfis": [], "usuarios": []}, **base)[0]  # sem config: padrão


def test_permissoes_dos_perfis_de_ti_e_aprovacao():
    analista, tecnico = get_role_permissions(ROLE_ANALISTA_TI), get_role_permissions(ROLE_TEC_PLENO)
    assert "wfm.escala.propria" in analista  # aba "Minhas escalas"
    assert {"wfm.escala.editar", "wfm.escala.publicar", "wfm.escala.aprovar", "wfm.tipos_escala.editar"} <= analista
    assert "wfm.escala.propria" in tecnico and "wfm.escala.editar" not in tecnico and "wfm.escala.aprovar" not in tecnico
    assert "wfm.escala.aprovar" in get_role_permissions(ROLE_SUPERVISOR) | set() and "wfm.escala.aprovar" in get_role_permissions(ROLE_MANAGER)
    assert "wfm.escala.aprovar" not in get_role_permissions(ROLE_CONTROL_DESK) and "wfm.escala.aprovar" not in get_role_permissions(ROLE_ADMIN)
    assert "wfm.tipos_escala.editar" not in get_role_permissions(ROLE_SUPERVISOR)


# ---------------------------------------------------------------- integração
class Ctx:
    pass


@pytest.fixture(scope="module")
def ctx():
    repo = repositorio_dev()
    c = Ctx()
    c.repo = repo
    c.op = f"WFMAPR_{uuid.uuid4().hex[:4].upper()}"
    c.ti = f"WFMTI_{uuid.uuid4().hex[:4].upper()}"
    admin = _user(ROLE_ADMIN, 1, nome="Adm")
    for chave in (c.op, c.ti):
        repo.upsert_configuration_item("operacoes", {"chave": chave, "nome": f"Op {chave}", "ativo": True})

    def mk(nome, perfil, operacoes, supervisores=()):
        ti = perfil in (ROLE_ANALISTA_TI, ROLE_TEC_PLENO)  # a criação da Monitoria só aceita perfis dela
        id_usuario = repo.mon_create_usuario(
            admin,
            {"nome": nome, "email": f"wfm_teste_{uuid.uuid4().hex[:10]}@example.com", "perfil": ROLE_CONTROL_DESK if ti else perfil,
             "operacoes": list(operacoes), "supervisores": list(supervisores)},
        )["id_usuario"]
        if ti:
            conn = repo._connect()
            try:
                conn.cursor().execute("UPDATE dbo.usuarios SET perfil_id = ? WHERE id_usuario = ?", (perfil, id_usuario))
                conn.commit()
            finally:
                conn.close()
        return id_usuario

    c.id_sup = mk("Sup Apr", ROLE_SUPERVISOR, [c.op])
    c.id_sup2 = mk("Sup2 Apr", ROLE_SUPERVISOR, [c.op])
    c.id_a = mk("Op A", ROLE_OPERATOR, [c.op], [c.id_sup])
    c.sup, c.sup2 = _user(ROLE_SUPERVISOR, c.id_sup, [c.op], "Sup Apr"), _user(ROLE_SUPERVISOR, c.id_sup2, [c.op], "Sup2 Apr")
    c.cd, c.gestor, c.admin = _user(ROLE_CONTROL_DESK, 9101, [c.op], "CD"), _user(ROLE_MANAGER, 9102, [], "Gestor"), admin
    contratos = {i["codigo"]: i["id_contrato"] for i in repo.wfm_list_contratos(c.cd, c.op)}
    repo.wfm_set_contrato_operador(c.cd, c.op, c.id_a, contratos["CLT8"], date(2027, 1, 1))
    repo.wfm_save_turno(c.cd, {"operacao": c.op, "codigo": "M", "nome": "M", "entrada": "08:00", "saida": "16:00"})
    c.M = {t["codigo"]: t["id_turno"] for t in repo.wfm_list_turnos(c.cd, c.op)}["M"]

    # Setor de TI: analista (gestor), dois técnicos, tipo de escala próprio
    c.id_analista = mk("Analista TI", ROLE_ANALISTA_TI, [c.ti])
    c.id_t1 = mk("Tec Um", ROLE_TEC_PLENO, [c.ti])
    c.id_t2 = mk("Tec Dois", ROLE_TEC_PLENO, [c.ti])
    c.analista = _user(ROLE_ANALISTA_TI, c.id_analista, [c.ti], "Analista TI")
    c.tec1 = _user(ROLE_TEC_PLENO, c.id_t1, [c.ti], "Tec Um")
    yield c
    conn = repo._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT chave FROM dbo.wfm_tipos_escala WHERE operacao_base IN (?, ?)", (c.ti, c.op))
        chaves = [r[0] for r in cursor.fetchall()] + [c.op]
        for chave in chaves:
            for tabela in ("wfm_trocas", "wfm_pausas", "wfm_operacao_config", "wfm_escala_itens", "wfm_escalas", "wfm_presencas", "wfm_atestados",
                           "wfm_operador_contratos", "wfm_usuario_skills", "wfm_skills", "wfm_calendario_especial", "wfm_turnos", "wfm_contratos"):
                cursor.execute(f"DELETE FROM dbo.{tabela} WHERE operacao = ?", (chave,))
        cursor.execute("DELETE FROM dbo.wfm_tipos_escala WHERE operacao_base IN (?, ?)", (c.ti, c.op))
        cursor.execute("DELETE FROM dbo.wfm_aprovadores WHERE operacao LIKE 'WFMAPR_%' OR operacao LIKE 'WFMTI_%'")
        cursor.execute("SELECT id_usuario FROM dbo.usuarios WHERE email LIKE 'wfm_teste_%'")
        for (id_usuario,) in cursor.fetchall():
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? OR id_supervisor = ?", (id_usuario, id_usuario))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes_historico WHERE id_usuario = ?", (id_usuario,))
            cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
        cursor.execute("DELETE FROM dbo.operacoes WHERE chave LIKE 'WFMAPR_%' OR chave LIKE 'WFMTI_%'")
        conn.commit()
    finally:
        conn.close()


def _item(id_operador, dia, id_turno):
    return {"id_operador": id_operador, "data": f"{MES}-{dia:02d}", "id_turno": id_turno, "versao_linha": None}


def _estado(ctx, user, operacao=None):
    return ctx.repo.wfm_get_escala(user, operacao or ctx.op, MES)["aprovacao"]


def test_fluxo_enviar_declinar_corrigir_aprovar_e_publicar(ctx):
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 3, ctx.M)])
    assert _estado(ctx, ctx.cd)["estado"] == "RASCUNHO" and _estado(ctx, ctx.cd)["pode_enviar"]
    assert _erro(ctx.repo.wfm_publicar, ctx.gestor, ctx.op, MES).status_code == 409  # sem aprovação não publica
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.sup, ctx.op, MES).status_code == 409  # ainda não foi enviada
    ctx.repo.wfm_enviar_aprovacao(ctx.cd, ctx.op, MES)
    assert _estado(ctx, ctx.cd)["estado"] == "EM_APROVACAO"
    # em aprovação: edição bloqueada; Control Desk (quem enviou) e Admin não aprovam
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.cd, ctx.op, MES, [_item(ctx.id_a, 4, ctx.M)]).status_code == 409
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.cd, ctx.op, MES).status_code == 403
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.admin, ctx.op, MES).status_code == 403
    # declinar exige justificativa e devolve a escala à edição
    assert _erro(ctx.repo.wfm_declinar_escala, ctx.sup, ctx.op, MES, "").status_code == 422
    ctx.repo.wfm_declinar_escala(ctx.sup, ctx.op, MES, "Faltam operadores no sábado")
    est = _estado(ctx, ctx.cd)
    assert est["estado"] == "RASCUNHO" and est["declinada"] and est["motivo"] == "Faltam operadores no sábado" and est["enviado_por"] == "CD"
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 4, ctx.M)])
    # reenvia e o Supervisor aprova; o operador da escala não aprovaria a própria
    ctx.repo.wfm_enviar_aprovacao(ctx.cd, ctx.op, MES)
    r = ctx.repo.wfm_aprovar_escala(ctx.sup2, ctx.op, MES)
    assert _estado(ctx, ctx.cd)["estado"] == "APROVADA"
    # aprovar já publica, e o histórico mostra quem aprovou
    assert r["publicada"] is True and r["versao"] == 1
    assert ctx.repo.wfm_list_versoes(ctx.cd, ctx.op, MES)[0]["aprovado_por"]
    # qualquer alteração depois invalida a aprovação
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 5, ctx.M)])
    assert _estado(ctx, ctx.cd)["estado"] == "RASCUNHO"
    assert _erro(ctx.repo.wfm_publicar, ctx.cd, ctx.op, MES).status_code == 409
    acoes = {a["acao"] for a in ctx.repo.wfm_list_auditoria(ctx.gestor, ctx.op, entidade="escala")}
    assert {"enviar_aprovacao", "declinar_escala", "aprovar_escala", "publicar_escala"} <= acoes


def test_cancelar_envio_devolve_a_rascunho(ctx):
    ctx.repo.wfm_enviar_aprovacao(ctx.cd, ctx.op, MES)
    assert _estado(ctx, ctx.cd)["pode_cancelar"]
    ctx.repo.wfm_cancelar_envio(ctx.cd, ctx.op, MES)
    assert _estado(ctx, ctx.cd)["estado"] == "RASCUNHO" and not _estado(ctx, ctx.cd)["declinada"]


def test_ti_tipos_de_escala_cadastraveis_so_pelo_analista(ctx):
    assert _erro(ctx.repo.wfm_save_tipo_escala, ctx.tec1, {"operacao_base": ctx.ti, "nome": "Final de semana"}).status_code == 403
    r = ctx.repo.wfm_save_tipo_escala(ctx.analista, {"operacao_base": ctx.ti, "nome": "Plantão de sábado"})
    r2 = ctx.repo.wfm_save_tipo_escala(ctx.analista, {"operacao_base": ctx.ti, "nome": "Sobreaviso"})
    assert r["chave"] == f"{ctx.ti}::PLANTAO-DE-SABADO" and r2["chave"].endswith("::SOBREAVISO")
    assert _erro(ctx.repo.wfm_save_tipo_escala, ctx.analista, {"operacao_base": ctx.ti, "nome": "Sobreaviso"}).status_code == 409
    ctx.chave_plantao, ctx.chave_sob, ctx.id_plantao = r["chave"], r2["chave"], r["id_tipo"]
    ctx_ti = ctx.repo.wfm_contexto(ctx.analista)
    assert {ctx.chave_plantao, ctx.chave_sob} <= {o["chave"] for o in ctx_ti["operacoes"]} and ctx_ti["pode_editar_tipos_escala"]
    assert ctx.repo.wfm_contexto(ctx.tec1)["pode_editar_tipos_escala"] is False
    # o tipo nasce com turno semeado (Sobreaviso não conta horas); Técnicos e Analista são os participantes
    turnos = {t["codigo"]: t for t in ctx.repo.wfm_list_turnos(ctx.analista, ctx.chave_sob)}
    assert turnos["SOB"]["tipo"] == "SOBREAVISO" and turnos["SOB"]["minutos"] == 0
    esc = ctx.repo.wfm_get_escala(ctx.analista, ctx.chave_sob, MES)
    assert {o["id_usuario"] for o in esc["operadores"]} == {ctx.id_analista, ctx.id_t1, ctx.id_t2} and esc["pode_editar"]


def test_ti_analista_monta_aprova_a_propria_e_publica_tecnico_so_le_o_proprio(ctx):
    sob = ctx.chave_sob
    id_sob = next(t["id_turno"] for t in ctx.repo.wfm_list_turnos(ctx.analista, sob) if t["codigo"] == "SOB")
    # o Analista pode se escalar (sem conflito de interesse no TI) e aprova a própria escala
    ctx.repo.wfm_salvar_itens(ctx.analista, sob, MES, [_item(ctx.id_t1, 8, id_sob), _item(ctx.id_analista, 15, id_sob)])
    assert _estado(ctx, ctx.analista, sob)["pode_aprovar"]
    assert ctx.repo.wfm_aprovar_escala(ctx.analista, sob, MES)["versao"] == 1  # aprovar já publica
    # Técnico lê só a própria linha publicada, não edita e não aprova
    esc = ctx.repo.wfm_get_escala(ctx.tec1, sob, MES)
    assert esc["fonte"] == "publicada" and {i["id_operador"] for i in esc["itens"]} == {ctx.id_t1} and esc["aprovacao"] is None
    assert _erro(ctx.repo.wfm_salvar_itens, ctx.tec1, sob, MES, [_item(ctx.id_t1, 9, id_sob)]).status_code == 403
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.tec1, sob, MES).status_code == 403
    # a escala do TI não vaza para quem não está vinculado ao setor
    assert _erro(ctx.repo.wfm_get_escala, ctx.sup, sob, MES).status_code == 403


def test_mesma_pessoa_em_duas_escalas_so_sem_sobrepor_horario(ctx):
    sab, sob = ctx.chave_plantao, ctx.chave_sob
    for chave, codigo, ent, sai in ((sab, "PS", "08:00", "12:00"), (sob, "W1", "10:00", "14:00"), (sob, "W2", "12:00", "16:00")):
        ctx.repo.wfm_save_turno(ctx.analista, {"operacao": chave, "codigo": codigo, "nome": codigo, "entrada": ent, "saida": sai})
    ids = {c: {t["codigo"]: t["id_turno"] for t in ctx.repo.wfm_list_turnos(ctx.analista, ch)} for c, ch in (("sab", sab), ("sob", sob))}
    ctx.repo.wfm_salvar_itens(ctx.analista, sab, MES, [_item(ctx.id_t1, 20, ids["sab"]["PS"])])
    erro = _erro(ctx.repo.wfm_salvar_itens, ctx.analista, sob, MES, [_item(ctx.id_t1, 20, ids["sob"]["W1"])])
    assert erro.status_code == 422 and "Tec Um já está escalado em" in erro.detail and "08:00 às 12:00" in erro.detail
    ctx.repo.wfm_salvar_itens(ctx.analista, sob, MES, [_item(ctx.id_t1, 20, ids["sob"]["W2"])])  # encosta, não sobrepõe
    # "Minhas escalas" do Analista: só a própria linha, mesmo com permissão de gestão
    propria = ctx.repo.wfm_get_escala(ctx.analista, sob, MES, propria=True)
    assert propria["fonte"] == "publicada" and all(i["id_operador"] == ctx.id_analista for i in propria["itens"])


def test_excluir_tipo_so_sem_historico(ctx):
    novo = ctx.repo.wfm_save_tipo_escala(ctx.analista, {"operacao_base": ctx.ti, "nome": "Teste descartável"})
    assert ctx.repo.wfm_excluir_tipo_escala(ctx.analista, novo["id_tipo"])["success"]
    sob_id = next(t["id_tipo"] for t in ctx.repo.wfm_list_tipos_escala(ctx.analista, ctx.ti) if t["chave"] == ctx.chave_sob)
    assert _erro(ctx.repo.wfm_excluir_tipo_escala, ctx.analista, sob_id).status_code == 409  # já publicada: só desativa
    assert _erro(ctx.repo.wfm_excluir_tipo_escala, ctx.tec1, sob_id).status_code == 403


def test_config_da_escala_nome_aprovadores_por_usuario_e_resumo(ctx):
    cfg = ctx.repo.wfm_get_config_escala(ctx.cd, ctx.op)
    assert cfg["nome_escala"] is None and cfg["pode_editar"]
    assert {c["id_usuario"] for c in cfg["candidatos"]} >= {ctx.id_sup, ctx.id_sup2}
    assert _erro(ctx.repo.wfm_save_config_escala, ctx.cd, ctx.op, "X", [], [ctx.id_a]).status_code == 400  # operador não aprova
    assert _erro(ctx.repo.wfm_save_config_escala, ctx.cd, ctx.op, "X", ["operador"], []).status_code == 400
    assert _erro(ctx.repo.wfm_save_config_escala, ctx.tec1, ctx.ti, "X", [], []).status_code == 403
    ctx.repo.wfm_save_config_escala(ctx.cd, ctx.op, "Escala Atendimento", [], [ctx.id_sup2])
    assert ctx.repo.wfm_get_escala(ctx.cd, ctx.op, MES)["nome_escala"] == "Escala Atendimento"
    # só o usuário configurado aprova; o outro Supervisor e o Gestor (perfil não listado) não
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 20, ctx.M)])
    ctx.repo.wfm_enviar_aprovacao(ctx.cd, ctx.op, MES)
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.sup, ctx.op, MES).status_code == 403
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.gestor, ctx.op, MES).status_code == 403
    assert not ctx.repo.wfm_get_escala(ctx.sup, ctx.op, MES)["aprovacao"]["pode_aprovar"]
    assert ctx.repo.wfm_get_escala(ctx.sup2, ctx.op, MES)["aprovacao"]["pode_aprovar"]
    ctx.repo.wfm_aprovar_escala(ctx.sup2, ctx.op, MES)
    # por perfil: só Gestor
    ctx.repo.wfm_save_config_escala(ctx.cd, ctx.op, "Escala Atendimento", ["gestor"], [])
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(ctx.id_a, 21, ctx.M)])
    ctx.repo.wfm_enviar_aprovacao(ctx.cd, ctx.op, MES)
    assert _erro(ctx.repo.wfm_aprovar_escala, ctx.sup2, ctx.op, MES).status_code == 403
    ctx.repo.wfm_aprovar_escala(ctx.gestor, ctx.op, MES)
    resumo = {r["chave"]: r for r in ctx.repo.wfm_resumo_escalas(ctx.cd, MES)}
    assert resumo[ctx.op]["nome"] == "Escala Atendimento" and resumo[ctx.op]["aprovacao"] == "APROVADA" and resumo[ctx.op]["escalados"] == 1


# ---------------------------------------------------------------- gestão de escalas (criar/configurar/duplicar/excluir)
def test_migration_v053_gestao_escalas_e_gerada_do_mesmo_ddl():
    from rh_api.repositories.wfm_schema import render_migration_gestao_escalas_sql

    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V053__wfm_gestao_escalas.sql"
    sql = render_migration_gestao_escalas_sql()
    assert arquivo.read_text(encoding="utf-8") == sql and "ativa" in sql and "id_contrato" in sql and "excluido" in sql
    # aditiva: nada de apagar tabela/coluna; a única remoção é a constraint única dos turnos, trocada por índice filtrado
    assert "DROP TABLE" not in sql.upper() and "DROP COLUMN" not in sql.upper() and sql.upper().count("DROP ") == 1 and "UX_wfm_turnos_codigo" in sql


def test_quem_cria_e_gere_escalas():
    for perfil in (ROLE_SUPERVISOR, ROLE_CONTROL_DESK, ROLE_ANALISTA_TI):
        assert wfm_scope.pode_criar_escala(perfil) and "wfm.escala.criar" in get_role_permissions(perfil)
    for perfil in (ROLE_MANAGER, ROLE_ADMIN, ROLE_OPERATOR, ROLE_TEC_PLENO):
        assert not wfm_scope.pode_criar_escala(perfil) and "wfm.escala.criar" not in get_role_permissions(perfil)


def test_gestao_criar_configurar_duplicar_e_excluir_escala(ctx):
    repo = ctx.repo
    # Gestor não cria; Supervisor/CD criam em operação do próprio escopo apenas
    assert _erro(repo.wfm_criar_escala, ctx.gestor, ctx.op, "Plantão X").status_code == 403
    assert _erro(repo.wfm_criar_escala, ctx.cd, ctx.ti, "Fora do escopo").status_code == 403
    nova = repo.wfm_criar_escala(ctx.cd, ctx.op, "Plantão de sábado")
    chave = nova["chave"]
    assert chave == f"{ctx.op}::PLANTAO-DE-SABADO"
    assert _erro(repo.wfm_criar_escala, ctx.cd, ctx.op, "Plantão de sábado").status_code == 409

    # a escala principal continua no contexto e a nova aparece junto
    chaves = {o["chave"] for o in repo.wfm_contexto(ctx.cd)["operacoes"]}
    assert {ctx.op, chave} <= chaves
    lista = repo.wfm_gestao_escalas(ctx.cd, MES)
    por_chave = {i["chave"]: i for i in lista["itens"]}
    assert lista["pode_criar"] and por_chave[ctx.op]["principal"] and not por_chave[chave]["principal"] and por_chave[chave]["ativa"]
    assert repo.wfm_gestao_escalas(ctx.gestor, MES)["pode_criar"] is False

    # configurar: nome, jornada padrão (atrelada à escala) e aprovadores; só quem cria altera ativa/jornada
    cfg = repo.wfm_get_config_escala(ctx.cd, chave)
    clt = next(c for c in cfg["contratos"] if c["codigo"] == "CLT8")
    assert not cfg["principal"] and cfg["ativa"] and cfg["pode_gerir"]
    repo.wfm_save_config_escala(ctx.cd, chave, "Plantão Sábado 2", [], [ctx.id_sup2], id_contrato=clt["id_contrato"], alterar_contrato=True)
    cfg = repo.wfm_get_config_escala(ctx.cd, chave)
    assert cfg["id_contrato"] == clt["id_contrato"] and cfg["nome_escala"] == "Plantão Sábado 2"
    assert {i["nome"] for i in repo.wfm_list_tipos_escala(ctx.cd, ctx.op)} >= {"Plantão Sábado 2"}
    assert _erro(repo.wfm_save_config_escala, ctx.gestor, chave, "x", [], [], ativa=False).status_code in (403,)
    assert _erro(repo.wfm_save_config_escala, ctx.cd, chave, "x", [], [], id_contrato=999999999, alterar_contrato=True).status_code == 400

    # a jornada da escala vale para quem não tem contrato próprio (o motor passa a validar)
    id_m = next(t["id_turno"] for t in repo.wfm_list_turnos(ctx.cd, chave) if t["tipo"] == "TRABALHO") if any(
        t["tipo"] == "TRABALHO" for t in repo.wfm_list_turnos(ctx.cd, chave)) else repo.wfm_save_turno(
        ctx.cd, {"operacao": chave, "codigo": "P1", "nome": "P1", "entrada": "08:00", "saida": "16:00"})["id_turno"]
    repo.wfm_salvar_itens(ctx.cd, chave, MES, [_item(ctx.id_a, 6, id_m)])
    esc = repo.wfm_get_escala(ctx.cd, chave, MES)
    assert esc["nome_escala"] == "Plantão Sábado 2"

    # desativar: some do contexto, aparece como inativa na lista e não aceita edição; reativar volta
    repo.wfm_save_config_escala(ctx.cd, chave, "Plantão Sábado 2", [], [ctx.id_sup2], ativa=False)
    assert chave not in {o["chave"] for o in repo.wfm_contexto(ctx.cd)["operacoes"]}
    assert not {i["chave"]: i for i in repo.wfm_gestao_escalas(ctx.cd, MES)["itens"]}[chave]["ativa"]
    assert _erro(repo.wfm_salvar_itens, ctx.cd, chave, MES, [_item(ctx.id_a, 7, id_m)]).status_code == 409
    repo.wfm_save_config_escala(ctx.cd, chave, "Plantão Sábado 2", [], [ctx.id_sup2], ativa=True)
    assert chave in {o["chave"] for o in repo.wfm_contexto(ctx.cd)["operacoes"]}

    # escala principal: desativa/ativa pela configuração, mas não se exclui
    repo.wfm_save_config_escala(ctx.cd, ctx.op, "", [], [], ativa=False)
    # a operação segue no contexto (Cadastros/Jornadas/Presença), só a escala principal fica marcada como inativa
    assert next(o for o in repo.wfm_contexto(ctx.cd)["operacoes"] if o["chave"] == ctx.op)["escala_ativa"] is False
    assert _erro(repo.wfm_salvar_itens, ctx.cd, ctx.op, MES, [_item(ctx.id_a, 9, ctx.M)]).status_code == 409
    repo.wfm_save_config_escala(ctx.cd, ctx.op, "", [], [], ativa=True)
    assert next(o for o in repo.wfm_contexto(ctx.cd)["operacoes"] if o["chave"] == ctx.op)["escala_ativa"] is True

    # duplicar: só para operação do escopo; copia nome/aprovadores/jornada e não os lançamentos
    assert _erro(repo.wfm_duplicar_escala, ctx.cd, chave, ctx.ti).status_code == 403
    assert _erro(repo.wfm_duplicar_escala, ctx.gestor, chave, ctx.op).status_code == 403
    copia = repo.wfm_duplicar_escala(ctx.cd, chave, ctx.op)
    assert copia["nome"] == "Plantão Sábado 2 (cópia)" and copia["chave"] != chave
    cfg_copia = repo.wfm_get_config_escala(ctx.cd, copia["chave"])
    assert cfg_copia["aprovadores"]["usuarios"] == [ctx.id_sup2] and cfg_copia["id_contrato"] is not None
    assert repo.wfm_get_escala(ctx.cd, copia["chave"], MES)["itens"] == []

    # excluir: sem histórico exclui; com histórico (a original tem itens) pede para desativar
    assert repo.wfm_excluir_escala(ctx.cd, copia["chave"])["success"]
    assert copia["chave"] not in {i["chave"] for i in repo.wfm_gestao_escalas(ctx.cd, MES)["itens"]}
    assert _erro(repo.wfm_excluir_escala, ctx.gestor, chave).status_code == 403
    # com histórico (itens lançados) a exclusão é lógica: some das telas, o histórico fica
    assert repo.wfm_excluir_escala(ctx.cd, chave)["logica"]
    assert chave not in {i["chave"] for i in repo.wfm_gestao_escalas(ctx.cd, MES)["itens"]}
    assert chave not in {o["chave"] for o in repo.wfm_contexto(ctx.cd)["operacoes"]}
    assert _erro(repo.wfm_get_escala, ctx.cd, chave, MES).status_code == 404
    # a escala principal também se exclui (logicamente) e sai da lista, mas a operação continua usável nas outras abas
    assert repo.wfm_excluir_escala(ctx.cd, ctx.op)["logica"]
    assert ctx.op not in {i["chave"] for i in repo.wfm_gestao_escalas(ctx.cd, MES)["itens"]}
    assert next(o for o in repo.wfm_contexto(ctx.cd)["operacoes"] if o["chave"] == ctx.op)["escala_excluida"] is True
    assert repo.wfm_list_contratos(ctx.cd, ctx.op) and repo.wfm_list_turnos(ctx.cd, ctx.op)
    assert _erro(repo.wfm_salvar_itens, ctx.cd, ctx.op, MES, [_item(ctx.id_a, 9, ctx.M)]).status_code == 404
    # a Operadora escalada deixa de ver a escala excluída (Minha escala)
    operadora = _user(ROLE_OPERATOR, ctx.id_a, [ctx.op], "Op A")
    assert ctx.op not in {o["chave"] for o in repo.wfm_contexto(operadora)["operacoes"]}
    assert _erro(repo.wfm_get_escala, operadora, ctx.op, MES).status_code == 404


def test_excluir_apaga_de_vez_e_nome_codigo_podem_ser_reutilizados(ctx):
    repo = ctx.repo
    # ---- escala: excluída (com histórico) libera o nome; a nova nasce limpa, com outra chave
    a = repo.wfm_criar_escala(ctx.cd, ctx.op, "Plantão Reuso")
    id_a = next(t["id_turno"] for t in repo.wfm_list_turnos(ctx.cd, a["chave"]) if t["tipo"] == "TRABALHO") if any(
        t["tipo"] == "TRABALHO" for t in repo.wfm_list_turnos(ctx.cd, a["chave"])) else repo.wfm_save_turno(
        ctx.cd, {"operacao": a["chave"], "codigo": "ZZ", "nome": "ZZ", "entrada": "08:00", "saida": "16:00"})["id_turno"]
    repo.wfm_salvar_itens(ctx.cd, a["chave"], MES, [_item(ctx.id_a, 11, id_a)])
    assert repo.wfm_excluir_escala(ctx.cd, a["chave"])["logica"]
    b = repo.wfm_criar_escala(ctx.cd, ctx.op, "Plantão Reuso")  # mesmo nome: agora pode
    assert b["chave"] != a["chave"]
    assert not any(t["tipo"] == "TRABALHO" for t in repo.wfm_list_turnos(ctx.cd, b["chave"]))  # os turnos da antiga não voltam
    assert [i["nome"] for i in repo.wfm_gestao_escalas(ctx.cd, MES)["itens"] if i["nome"] == "Plantão Reuso"] == ["Plantão Reuso"]

    # ---- turno: nunca usado = apagado; usado só no passado = exclusão lógica; em uso de hoje em diante = recusado
    t1 = repo.wfm_save_turno(ctx.cd, {"operacao": b["chave"], "codigo": "TX1", "nome": "TX1", "entrada": "09:00", "saida": "17:00"})
    assert repo.wfm_excluir_turno(ctx.cd, b["chave"], t1["id_turno"])["logica"] is False
    t2 = repo.wfm_save_turno(ctx.cd, {"operacao": b["chave"], "codigo": "TX2", "nome": "TX2", "entrada": "09:00", "saida": "17:00"})
    repo.wfm_salvar_itens(ctx.cd, b["chave"], "2020-01", [{"id_operador": ctx.id_a, "data": "2020-01-10", "id_turno": t2["id_turno"], "versao_linha": None}], justificativa="histórico de teste")
    assert repo.wfm_excluir_turno(ctx.cd, b["chave"], t2["id_turno"])["logica"] is True
    assert "TX2" not in {t["codigo"] for t in repo.wfm_list_turnos(ctx.cd, b["chave"])}
    repo.wfm_save_turno(ctx.cd, {"operacao": b["chave"], "codigo": "TX2", "nome": "TX2 novo", "entrada": "10:00", "saida": "18:00"})  # código reutilizável
    hist = repo.wfm_get_escala(ctx.cd, b["chave"], "2020-01")
    assert any(t["id_turno"] == t2["id_turno"] and t["ativo"] is False for t in hist["turnos"])  # o histórico ainda sabe o que era
    t3 = repo.wfm_save_turno(ctx.cd, {"operacao": b["chave"], "codigo": "TX3", "nome": "TX3", "entrada": "09:00", "saida": "17:00"})
    repo.wfm_salvar_itens(ctx.cd, b["chave"], "2099-01", [{"id_operador": ctx.id_a, "data": "2099-01-10", "id_turno": t3["id_turno"], "versao_linha": None}])
    assert _erro(repo.wfm_excluir_turno, ctx.cd, b["chave"], t3["id_turno"]).status_code == 409

    # ---- padrões não ressuscitam: excluir uma jornada e voltar a usar a escala não a traz de volta
    contratos = {c["codigo"]: c["id_contrato"] for c in repo.wfm_list_contratos(ctx.cd, b["chave"])}
    assert contratos
    sobrando = next(iter(contratos))
    repo.wfm_excluir_contrato(ctx.cd, b["chave"], contratos[sobrando])
    assert sobrando not in {c["codigo"] for c in repo.wfm_list_contratos(ctx.cd, b["chave"])}


def test_excluir_escala_com_historico_e_logico_e_some_do_cadastro(ctx):
    antes = {t["chave"] for t in ctx.repo.wfm_list_tipos_escala(ctx.analista, ctx.ti)}
    assert ctx.chave_sob in antes
    assert ctx.repo.wfm_excluir_escala(ctx.analista, ctx.chave_sob)["logica"] is True
    # escala excluída não gera mais conflito de horário para quem estava nela
    ctx.repo.wfm_save_turno(ctx.analista, {"operacao": ctx.chave_plantao, "codigo": "PL", "nome": "PL", "entrada": "13:00", "saida": "15:00"})
    pl = next(t["id_turno"] for t in ctx.repo.wfm_list_turnos(ctx.analista, ctx.chave_plantao) if t["codigo"] == "PL")
    atual = next(i for i in ctx.repo.wfm_get_escala(ctx.analista, ctx.chave_plantao, MES)["itens"] if i["id_operador"] == ctx.id_t1 and i["data"].endswith("-20"))
    ctx.repo.wfm_salvar_itens(ctx.analista, ctx.chave_plantao, MES, [{**_item(ctx.id_t1, 20, pl), "versao_linha": atual["versao_linha"]}])
    assert ctx.chave_sob not in {t["chave"] for t in ctx.repo.wfm_list_tipos_escala(ctx.analista, ctx.ti)}
    assert ctx.chave_sob not in {o["chave"] for o in ctx.repo.wfm_contexto(ctx.analista)["operacoes"]}


def test_migration_v054_antecedencia_de_troca_e_gerada_do_mesmo_ddl():
    from rh_api.repositories.wfm_schema import render_migration_troca_antecedencia_sql

    arquivo = REPO_ROOT / "infra" / "sql" / "migrations" / "V054__wfm_troca_antecedencia.sql"
    sql = render_migration_troca_antecedencia_sql()
    assert arquivo.read_text(encoding="utf-8") == sql and "troca_antecedencia_dias" in sql and "DROP " not in sql.upper()


def test_wfm_fechado_para_participantes_na_fase_de_teste():
    """Sem RH_WFM_LIBERAR_PARTICIPANTES, Operador/Técnico/Qualidade não têm nenhuma permissão WFM; quem gere continua com acesso."""
    import os
    import subprocess
    import sys

    codigo = "; ".join([
        "from rh_api.rbac import get_role_permissions as g",
        "ruins = [r for r in ('operador','qualidade','tecnico_junior','tecnico_pleno','tecnico_senior') if any(p.startswith('wfm.') or p == 'sessao.wfm.acessar' for p in g(r))]",
        "bons = [r for r in ('control_desk','supervisor','gestor','analista_ti') if 'sessao.wfm.acessar' in g(r) and 'wfm.relatorios' in g(r)]",
        "print(ruins, sorted(bons))",
    ])
    env = {**os.environ, "RH_WFM_LIBERAR_PARTICIPANTES": "", "PYTHONPATH": str(REPO_ROOT / "apps" / "backend")}
    saida = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, env=env, cwd=str(REPO_ROOT / "apps" / "backend"), check=True).stdout.strip()
    assert saida == "[] ['analista_ti', 'control_desk', 'gestor', 'supervisor']", saida


def test_restricao_wfm_vale_mesmo_com_permissao_gravada_no_banco_ou_no_token():
    import os
    import subprocess
    import sys

    codigo = "; ".join([
        "from rh_api.rbac import aplicar_restricao_wfm_em_teste as f",
        "gravadas = ['inicio.visualizar', 'sessao.wfm.acessar', 'wfm.escala.propria', 'wfm.troca.solicitar']",
        "print(f('operador', gravadas), f('supervisor', gravadas) == gravadas)",
    ])
    env = {**os.environ, "RH_WFM_LIBERAR_PARTICIPANTES": "", "PYTHONPATH": str(REPO_ROOT / "apps" / "backend")}
    saida = subprocess.run([sys.executable, "-c", codigo], capture_output=True, text=True, env=env, cwd=str(REPO_ROOT / "apps" / "backend"), check=True).stdout.strip()
    assert saida == "['inicio.visualizar'] True", saida

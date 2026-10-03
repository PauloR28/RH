"""Modularização, Etapa 5: a TI é uma operação do WFM e a tela emprestada ao módulo tecnologia usa as MESMAS rotas e tabelas.
O isolamento é do servidor: quem é da TI só enxerga a TI; quem é de outra operação não enxerga a escala da TI.

Reaproveita o cenário (operação de atendimento + operação de TI de teste, usuários e tipos de escala) de test_wfm_aprovacao_ti.py."""

from __future__ import annotations

import pytest

from rh_api.rbac import ROLE_MANAGER
from rh_api.services import wfm_scope
from test_wfm_aprovacao_ti import MES, _erro, _user, ctx  # noqa: F401 - `ctx` é a fixture do cenário


@pytest.fixture()
def escalas_ti(ctx):  # noqa: F811
    """Garante que existe ao menos um tipo de escala na operação de TI de teste."""
    if not getattr(ctx, "chave_sob", None):
        r = ctx.repo.wfm_save_tipo_escala(ctx.analista, {"operacao_base": ctx.ti, "nome": "Sobreaviso ISO"})
        ctx.chave_sob = r["chave"]
    return ctx


def _bases(contexto):
    return {wfm_scope.operacao_base(o["chave"]) for o in contexto["operacoes"]}


def test_tecnico_de_ti_so_ve_a_operacao_da_ti(escalas_ti):
    c = escalas_ti
    assert _bases(c.repo.wfm_contexto(c.tec1)) == {c.ti}
    assert _erro(c.repo.wfm_get_escala, c.tec1, c.op, MES).status_code == 403
    assert _erro(c.repo.wfm_list_turnos, c.tec1, c.op).status_code == 403


def test_analista_de_ti_nao_enxerga_a_operacao_de_atendimento(escalas_ti):
    c = escalas_ti
    assert _bases(c.repo.wfm_contexto(c.analista)) == {c.ti}
    assert _erro(c.repo.wfm_get_escala, c.analista, c.op, MES).status_code == 403
    chaves = {i["operacao_base"] for i in c.repo.wfm_gestao_escalas(c.analista, MES)["itens"]}
    assert chaves == {c.ti}


def test_supervisor_de_outra_operacao_nao_ve_a_escala_da_ti(escalas_ti):
    c = escalas_ti
    assert c.ti not in _bases(c.repo.wfm_contexto(c.sup))
    assert _erro(c.repo.wfm_get_escala, c.sup, c.chave_sob, MES).status_code == 403
    assert _erro(c.repo.wfm_get_escala, c.sup, c.ti, MES).status_code == 403
    gestao = c.repo.wfm_gestao_escalas(c.sup, MES)["itens"]
    assert gestao and all(i["operacao_base"] != c.ti for i in gestao)


def test_control_desk_de_outra_operacao_tambem_nao_ve_a_ti(escalas_ti):
    c = escalas_ti
    assert c.ti not in _bases(c.repo.wfm_contexto(c.cd))
    assert _erro(c.repo.wfm_get_escala, c.cd, c.chave_sob, MES).status_code == 403
    assert all(i["operacao_base"] != c.ti for i in c.repo.wfm_gestao_escalas(c.cd, MES)["itens"])


def test_gestor_e_global_e_enxerga_a_ti_e_as_demais(escalas_ti):
    c = escalas_ti
    gestor = _user(ROLE_MANAGER, 9102, [], "Gestor")
    bases = {i["operacao_base"] for i in c.repo.wfm_gestao_escalas(gestor, MES)["itens"]}
    assert {c.ti, c.op} <= bases


def test_a_operacao_ti_padrao_existe_e_e_a_que_o_modulo_tecnologia_usa(escalas_ti):
    from rh_api.modulos_catalogo import OPERACAO_TI

    assert OPERACAO_TI == "TI" and OPERACAO_TI in wfm_scope.OPERACOES_SO_TIPOS
    conn = escalas_ti.repo._connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT ativo FROM dbo.operacoes WHERE chave = ?", (OPERACAO_TI,))
        linha = cur.fetchone()
    finally:
        conn.close()
    if linha is None:
        pytest.skip("Operação TI ainda não semeada neste banco (V051).")
    assert bool(linha[0])


def test_a_tela_emprestada_usa_as_mesmas_rotas_do_wfm():
    """Não existe rota /tecnologia de escala: Tecnologia reutiliza /wfm/* (nenhum código de WFM duplicado)."""
    from rh_api.main import app

    caminhos = {r.path for r in app.routes if hasattr(r, "path")}
    assert not [p for p in caminhos if p.startswith("/tecnologia") and ("escala" in p or "wfm" in p.replace("parametros/wfm-participantes", ""))]
    assert "/wfm/contexto" in caminhos or any(p.startswith("/wfm/") for p in caminhos)

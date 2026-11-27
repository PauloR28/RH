"""Etapa 5 (17/nov/2026): o alcance reproduz as regras antigas por nome de perfil."""

from rh_api import alcance as al
from rh_api import rbac as r
from rh_api.services import monitoria_scope as ms
from rh_api.services import wfm_scope as ws


def test_alcance_reproduz_os_conjuntos_antigos():
    assert ws.PERFIS_GLOBAIS == {r.ROLE_ADMIN, r.ROLE_MANAGER}
    assert set(ws.PERFIS_GESTAO) == {r.ROLE_MANAGER, r.ROLE_CONTROL_DESK, r.ROLE_SUPERVISOR, r.ROLE_ANALISTA_TI}
    assert ms.PERFIS_GLOBAIS == {r.ROLE_ADMIN, r.ROLE_MANAGER, r.ROLE_CONTROL_DESK}
    assert ms.LIMITE_OPERACOES == {r.ROLE_OPERATOR: 1, r.ROLE_SUPERVISOR: 3, r.ROLE_QUALIDADE: 2}
    assert al.perfis_com(wfm=al.PROPRIO) == r.WFM_PERFIS_PARTICIPANTES
    assert al.perfis_com(aprova_propria_escala=True) == {r.ROLE_ANALISTA_TI}


def test_perfil_desconhecido_tem_alcance_padrao():
    a = al.alcance("perfil_novo")
    assert (a.wfm, a.monitoria, a.gerencia) == (al.UNIDADE, al.UNIDADE, frozenset())


def test_mensagens_de_vinculo_iguais_as_de_antes():
    assert ms.validar_vinculos(r.ROLE_OPERATOR, [], [1])[0] == "O Operador deve estar vinculado a exatamente 1 operação."
    assert ms.validar_vinculos(r.ROLE_SUPERVISOR, [], []) == ["O Supervisor precisa estar vinculado a ao menos 1 operação."]
    assert ms.validar_vinculos(r.ROLE_QUALIDADE, [], []) == ["A Qualidade precisa estar vinculada a ao menos 1 operação."]
    assert ms.validar_vinculos(r.ROLE_QUALIDADE, ["A", "B", "C"], []) == ["Qualidade pode ter no máximo 2 operações."]


def test_cada_flag_troca_exatamente_o_perfil_de_antes():
    assert al.perfis_com(wfm=al.EQUIPE) == {r.ROLE_SUPERVISOR}
    assert al.perfis_com(monitoria=al.EQUIPE) == {r.ROLE_SUPERVISOR}
    assert al.perfis_com(monitoria=al.PROPRIO) == {r.ROLE_OPERATOR}
    assert al.perfis_com(total=True) == {r.ROLE_ADMIN}
    assert al.perfis_com(avalia_monitoria=True) == {r.ROLE_QUALIDADE}
    assert al.perfis_com(chamados=al.TODOS) == {r.ROLE_ADMIN, r.ROLE_MANAGER}


def test_alcance_gravado_vence_o_padrao_do_codigo():
    al.definir_carregador(lambda: {(r.ROLE_QUALIDADE, "wfm"): al.EQUIPE})
    try:
        assert al.alcance(r.ROLE_QUALIDADE).wfm == al.EQUIPE
        assert al.alcance(r.ROLE_QUALIDADE).monitoria == al.UNIDADE
        assert al.alcance_padrao(r.ROLE_QUALIDADE).wfm == al.UNIDADE
    finally:
        al.definir_carregador(None)


def test_migration_v074_coincide_com_o_schema():
    from pathlib import Path

    from rh_api.repositories import alcance_schema as s
    pasta = Path(__file__).resolve().parents[3] / "infra/sql/migrations"
    assert (pasta / "V074__perfis_alcance.sql").read_text(encoding="utf-8") == s.render_migration_sql()
    assert (pasta / "V074__perfis_alcance.rollback.sql").read_text(encoding="utf-8") == s.render_rollback_sql()


def test_tela_acessos_mostra_alcance_e_base():
    from rh_api import acesso_catalogo as cat
    from rh_api.services import central_acessos as ca
    perfis = [{"id": r.ROLE_SUPERVISOR}, {"id": r.ROLE_OPERATOR}]
    a = ca._alcance_da_funcao(cat.POR_ID["wfm"], perfis)
    assert a["area"] == "wfm" and a["valores"] == {r.ROLE_SUPERVISOR: al.EQUIPE, r.ROLE_OPERATOR: al.PROPRIO}
    assert ca._alcance_da_funcao(cat.POR_ID["mural"], perfis) is None
    assert ca._sempre_ligada(cat.POR_ID["logs"], "tecnologia") and not ca._sempre_ligada(cat.POR_ID["mural"], "tecnologia")


class _U:
    def __init__(self, perfil, ops=()):
        self.perfil = perfil
        self.operacoes = frozenset(ops)

    def allows_operacao(self, op):
        return not self.operacoes or op in self.operacoes


def test_ve_operacao_sem_vinculo_so_perfil_global():
    from rh_api.rbac import ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_MANAGER, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR

    for perfil in (ROLE_ADMIN, ROLE_MANAGER, ROLE_CONTROL_DESK):
        assert al.ve_operacao(_U(perfil), "CRF") is True
    for perfil in (ROLE_SUPERVISOR, ROLE_OPERATOR, ROLE_QUALIDADE):
        assert al.ve_operacao(_U(perfil), "CRF") is False


def test_ve_operacao_com_vinculo_segue_as_operacoes_da_pessoa():
    from rh_api.rbac import ROLE_SUPERVISOR

    u = _U(ROLE_SUPERVISOR, {"NEWE"})
    assert al.ve_operacao(u, "NEWE") is True
    assert al.ve_operacao(u, "CRF") is False

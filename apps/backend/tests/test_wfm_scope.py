from __future__ import annotations

from rh_api.rbac import ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_MANAGER, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR
from rh_api.services import wfm_scope as sc

BASE = dict(operacoes_usuario=["A"], operacao="A", equipe_supervisor=[10, 11])


def _edita(perfil, id_usuario, id_operador, **kw):
    return sc.pode_editar_escala_de(perfil=perfil, id_usuario=id_usuario, id_operador=id_operador, **{**BASE, **kw})


def _ve(perfil, id_usuario, id_operador, **kw):
    return sc.pode_ver_escala_de(perfil=perfil, id_usuario=id_usuario, id_operador=id_operador, **{**BASE, **kw})


def test_acesso_cruzado_operacao_outra_e_negado_para_perfis_restritos():
    for perfil in (ROLE_SUPERVISOR, ROLE_CONTROL_DESK, ROLE_QUALIDADE):
        assert not sc.pode_ver_operacao(perfil, ["A"], "B")
        assert not _ve(perfil, 1, 10, operacao="B")
        assert not _edita(perfil, 1, 10, operacao="B")


def test_operador_nao_ve_escala_de_colega_nem_de_outra_operacao():
    assert _ve(ROLE_OPERATOR, 10, 10)
    assert not _ve(ROLE_OPERATOR, 10, 11)
    assert not _ve(ROLE_OPERATOR, 10, 10, operacao="B")
    assert not _edita(ROLE_OPERATOR, 10, 10)


def test_supervisor_edita_so_a_propria_equipe():
    assert _edita(ROLE_SUPERVISOR, 1, 10)
    assert not _edita(ROLE_SUPERVISOR, 1, 99)
    assert not _ve(ROLE_SUPERVISOR, 1, 99)


def test_control_desk_edita_qualquer_operador_das_operacoes_vinculadas():
    assert _edita(ROLE_CONTROL_DESK, 1, 99)
    assert not _edita(ROLE_CONTROL_DESK, 1, 99, operacoes_usuario=[])


# 09/11/2026 (decisão do Paulo): o escopo só define o ALCANCE; quem edita é quem tem a chave wfm.escala.editar
# (conferida na rota e no repositório). Qualidade e Administrador editam se a chave estiver ligada em Perfis.
def test_qualidade_le_e_o_alcance_de_edicao_depende_da_chave():
    assert _ve(ROLE_QUALIDADE, 1, 99)
    assert _edita(ROLE_QUALIDADE, 1, 99)
    assert not _edita(ROLE_QUALIDADE, 1, 99, operacoes_usuario=[])


def test_administrador_le_e_edita_tudo_quando_tem_a_chave():
    assert _ve(ROLE_ADMIN, 1, 99, operacao="Z", operacoes_usuario=[])
    assert _edita(ROLE_ADMIN, 1, 99, operacao="Z", operacoes_usuario=[])
    assert not _edita(ROLE_ADMIN, 10, 10)  # conflito de interesse continua valendo


def test_gestor_e_global_e_edita():
    assert _edita(ROLE_MANAGER, 1, 99, operacao="Z", operacoes_usuario=[])


def test_conflito_de_interesse_vale_para_todos_os_perfis():
    for perfil in (ROLE_MANAGER, ROLE_CONTROL_DESK, ROLE_SUPERVISOR):
        assert not _edita(perfil, 10, 10, equipe_supervisor=[10])


def test_perfis_restritos_sem_vinculo_nao_acessam_nada():
    for perfil in (ROLE_SUPERVISOR, ROLE_CONTROL_DESK, ROLE_QUALIDADE):
        assert not sc.pode_ver_operacao(perfil, [], "A")


def test_contratos_valem_pela_chave_e_participante_nunca():
    for perfil in (ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_SUPERVISOR, ROLE_MANAGER):
        assert sc.pode_editar_contratos(perfil)
    assert not sc.pode_editar_contratos(ROLE_OPERATOR)


def _decide(perfil, id_usuario, **kw):
    return sc.pode_decidir_troca(perfil=perfil, id_usuario=id_usuario, operacoes_usuario=kw.get("ops", ["A"]),
                                 operacao=kw.get("operacao", "A"), id_a=10, id_b=50, equipe_supervisor=kw.get("equipe", [10]))


def test_decidir_troca_respeita_perfil_equipe_operacao_e_conflito():
    assert _decide(ROLE_SUPERVISOR, 1)
    assert not _decide(ROLE_SUPERVISOR, 1, equipe=[99])          # nenhum dos dois é da equipe
    assert _decide(ROLE_SUPERVISOR, 1, equipe=[50])              # basta um deles
    assert not _decide(ROLE_SUPERVISOR, 10)                      # parte da troca
    assert not _decide(ROLE_MANAGER, 50)                         # parte da troca (qualquer perfil)
    assert _decide(ROLE_MANAGER, 9, ops=[], operacao="Z")
    assert _decide(ROLE_CONTROL_DESK, 9) and not _decide(ROLE_CONTROL_DESK, 9, operacao="B")
    assert _decide(ROLE_ADMIN, 9, ops=[], operacao="Z")         # com a chave wfm.troca.aprovar
    assert not _decide(ROLE_OPERATOR, 9)


def test_ver_troca_so_os_dois_operadores_e_gestores():
    def ve(perfil, uid, **kw):
        return sc.pode_ver_troca(perfil=perfil, id_usuario=uid, operacoes_usuario=["A"], operacao="A", id_a=10, id_b=50, equipe_supervisor=kw.get("equipe", [10]))
    assert ve(ROLE_OPERATOR, 10) and ve(ROLE_OPERATOR, 50) and not ve(ROLE_OPERATOR, 77)
    assert ve(ROLE_SUPERVISOR, 1) and not ve(ROLE_SUPERVISOR, 1, equipe=[99])
    assert ve(ROLE_MANAGER, 9) and ve(ROLE_CONTROL_DESK, 9)
    assert ve(ROLE_ADMIN, 9)  # quem lê depende da chave wfm.troca.visualizar (conferida no repositório)

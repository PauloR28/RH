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

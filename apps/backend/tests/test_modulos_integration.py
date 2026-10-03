"""Modularização, Etapa 3: registro de módulos contra o banco de DESENVOLVIMENTO (pula sem banco ou sem as migrations V055/V056).
Tudo que o teste altera é restaurado no `finally`."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from _integracao_dev import repositorio_dev
from rh_api.modulos_catalogo import MODULO_RH, MODULO_TECNOLOGIA, modulo_dono_padrao
from rh_api.rbac import PERMISSION_DEFINITIONS
from rh_api.services import acesso, modulos_admin


@pytest.fixture()
def banco():
    repo = repositorio_dev()
    conn = repo._connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT OBJECT_ID('dbo.modulos_sistema'), COL_LENGTH('dbo.permissoes', 'modulo_dono')")
        tabela, coluna = cur.fetchone()
    finally:
        conn.close()
    if tabela is None or coluna is None:
        pytest.skip("Migrations V055/V056 não aplicadas neste banco.")
    acesso.definir_carregador(None)
    yield repo
    acesso.definir_carregador(None)


def test_seed_do_banco_bate_com_o_catalogo_em_codigo(banco):
    est = acesso._carregar_do_banco()
    assert est.de_banco and est.ativos >= {"core", "tecnologia"}
    for chave, definicao in PERMISSION_DEFINITIONS.items():
        assert est.donos.get(chave), f"{chave} sem modulo_dono"
        # Só diverge se o RH reatribuiu em Tecnologia; num banco recém-migrado é idêntico ao padrão.
        if est.donos[chave] != modulo_dono_padrao(chave, definicao.module):
            pytest.skip(f"{chave} foi reatribuída neste banco (esperado em ambiente já configurado).")
    abrem = sorted(c for c, a in est.abre.items() if a)
    assert abrem == sorted(["sessao.curriculos.acessar", "sessao.processos.acessar", "sessao.provas.acessar", "sessao.monitoria.acessar", "sessao.wfm.acessar", "configuracoes.visualizar"])


def test_desativar_e_reativar_modulo_no_banco(banco):
    estado_inicial = acesso._carregar_do_banco().ativos
    try:
        modulos_admin.definir_ativo(MODULO_RH, False, autor="teste")
        assert not acesso.modulo_ativo(MODULO_RH)
        assert "candidatos.visualizar" not in acesso.filtrar_permissoes({"candidatos.visualizar", "inicio.visualizar"})
    finally:
        modulos_admin.definir_ativo(MODULO_RH, MODULO_RH in estado_inicial, autor="teste")
    assert acesso.modulo_ativo(MODULO_RH) == (MODULO_RH in estado_inicial)


def test_core_e_tecnologia_recusam_desativacao(banco):
    for protegido in ("core", MODULO_TECNOLOGIA):
        with pytest.raises(HTTPException) as exc:
            modulos_admin.definir_ativo(protegido, False, autor="teste")
        assert exc.value.status_code == 409


def test_nao_move_a_permissao_que_abre_a_tecnologia(banco):
    with pytest.raises(HTTPException) as exc:
        modulos_admin.definir_modulo_da_permissao("configuracoes.visualizar", MODULO_RH, None, autor="teste")
    assert exc.value.status_code == 409


def test_reatribuir_o_modulo_de_relatorios_e_reversivel(banco):
    original = acesso.modulo_da_permissao("relatorios.visualizar")
    abre_original = acesso.modulo_aberto_por("relatorios.visualizar") is not None
    try:
        modulos_admin.definir_modulo_da_permissao("relatorios.visualizar", MODULO_RH, False, autor="teste")
        assert acesso.modulo_da_permissao("relatorios.visualizar") == MODULO_RH
    finally:
        modulos_admin.definir_modulo_da_permissao("relatorios.visualizar", original, abre_original, autor="teste")
    assert acesso.modulo_da_permissao("relatorios.visualizar") == original

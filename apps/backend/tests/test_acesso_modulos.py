"""Modularização, Etapa 3: ponto único de acesso por módulo (`services/acesso.py`), catálogo de donos e guarda."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import _matriz_acesso as m
from rh_api.auth import AuthenticatedUser
from rh_api.dependencies import get_current_user
from rh_api.modulos_catalogo import (
    ABRE_MODULO_PADRAO,
    MODULO_CORE,
    MODULO_OPERACAO,
    MODULO_RH,
    MODULO_TECNOLOGIA,
    MODULOS_PROTEGIDOS,
    modulo_dono_padrao,
)
from rh_api.rbac import PERMISSION_DEFINITIONS, ROLE_PERMISSIONS
from rh_api.routers import core as core_router
from rh_api.services import acesso


def _desligar(*modulos: str):
    base = acesso.EstadoModulos()
    acesso.definir_carregador(lambda: acesso.EstadoModulos(ativos=frozenset(base.ativos - set(modulos)) | MODULOS_PROTEGIDOS))


@pytest.fixture(autouse=True)
def _sem_banco():
    """Estado padrão do catálogo, sem tocar no banco; restaura o carregador real ao final."""
    acesso.definir_carregador(lambda: acesso.EstadoModulos())
    yield
    acesso.definir_carregador(None)


# ------------------------------------------------------------------ catálogo
def test_toda_permissao_tem_dono_valido():
    for chave, definicao in PERMISSION_DEFINITIONS.items():
        assert modulo_dono_padrao(chave, definicao.module) in {MODULO_CORE, MODULO_RH, MODULO_OPERACAO, MODULO_TECNOLOGIA}, chave


def test_decisoes_do_rh_no_mapeamento():
    d = lambda k: modulo_dono_padrao(k, PERMISSION_DEFINITIONS[k].module)  # noqa: E731
    assert d("emails.enviar_modelo") == MODULO_RH and d("onedrive.visualizar") == MODULO_RH  # D-3
    assert d("relatorios.visualizar") == MODULO_TECNOLOGIA  # D-3 (configurável)
    assert d("onboarding.visualizar") == MODULO_CORE and d("onboarding.concluir_proprio") == MODULO_CORE  # D-1
    assert d("onboarding.editar") == MODULO_CORE  # D-9
    assert d("onboarding.criar") == MODULO_RH and d("onboarding.gerenciar") == MODULO_RH  # D-1
    assert d("operacoes.visualizar") == MODULO_CORE and d("mural.visualizar") == MODULO_CORE
    assert d("monitoria.visualizar") == MODULO_OPERACAO and d("wfm.escala.visualizar") == MODULO_OPERACAO


def test_so_as_chaves_previstas_abrem_modulo():
    assert set(ABRE_MODULO_PADRAO) == {
        "sessao.curriculos.acessar", "sessao.processos.acessar", "sessao.provas.acessar",
        "sessao.monitoria.acessar", "sessao.wfm.acessar", "configuracoes.visualizar",
        "chamados.abrir", "chamados.atender",  # Suporte TI (Chamados): quem abre ou atende enxerga o módulo Tecnologia
    }
    assert "relatorios.visualizar" not in ABRE_MODULO_PADRAO  # D-8


# ------------------------------------------------------------------ visibilidade (matriz do PLANO §9)
ESPERADO_FECHADA = {
    "administrador": ["rh", "operacao", "tecnologia"],
    "gestor": ["rh", "operacao"],
    "rh": ["rh"],
    "dp": ["rh"],
    "estagiario": ["rh"],
    "supervisor": ["operacao", "tecnologia"],  # Suporte TI: chamados.abrir abre Tecnologia (menu filtrado: só "Suporte TI")
    "control_desk": ["operacao"],
    "qualidade": ["operacao"],  # Monitoria abre `operacao` (WFM só entra com a flag aberta)
    "operador": ["operacao"],
    "funcionario": [],
    "candidato": [],
    "analista_ti": ["operacao", "tecnologia"],
    "tecnico_junior": ["tecnologia"],
    "tecnico_pleno": ["tecnologia"],
    "tecnico_senior": ["tecnologia"],
}


@pytest.mark.parametrize("flag,esperado_extra", [("", {}), ("1", {"tecnico_junior": ["operacao", "tecnologia"], "tecnico_pleno": ["operacao", "tecnologia"], "tecnico_senior": ["operacao", "tecnologia"]})])
def test_matriz_perfil_x_modulo(flag, esperado_extra):
    efetivas = m._permissoes_efetivas_em_subprocesso(flag)
    esperado = {**ESPERADO_FECHADA, **esperado_extra}
    obtido = {perfil: acesso.modulos_visiveis(perms) for perfil, perms in efetivas.items()}
    assert obtido == esperado


def test_perfis_de_ti_nao_enxergam_rh_nem_perfis_de_rh_enxergam_tecnologia():
    efetivas = m._permissoes_efetivas_em_subprocesso("1")
    for perfil in ("rh", "dp", "estagiario", "gestor", "operador", "funcionario"):  # Supervisor vê Tecnologia só pelo Suporte TI
        assert MODULO_TECNOLOGIA not in acesso.modulos_visiveis(efetivas[perfil]), perfil
    for perfil in m.PERFIS_TI:
        assert MODULO_RH not in acesso.modulos_visiveis(efetivas[perfil]), perfil


def test_quem_tem_um_modulo_so_nao_precisa_de_seletor():
    efetivas = m._permissoes_efetivas_em_subprocesso("")
    for perfil in ("rh", "dp", "estagiario", "control_desk", "operador"):
        assert len(acesso.modulos_visiveis(efetivas[perfil])) == 1, perfil


# ------------------------------------------------------------------ módulo desativado
def test_modulo_desativado_remove_suas_permissoes_e_o_modulo():
    efetivas = m._permissoes_efetivas_em_subprocesso("1")
    _desligar(MODULO_RH)
    gestor = acesso.filtrar_permissoes(efetivas["gestor"])
    assert "candidatos.visualizar" not in gestor and "monitoria.visualizar" in gestor
    assert "inicio.visualizar" in gestor  # core nunca some
    assert acesso.modulos_visiveis(efetivas["gestor"]) == ["operacao"]
    assert acesso.modulos_visiveis(efetivas["rh"]) == []


def test_core_e_tecnologia_nao_se_desligam_nem_pelo_estado_do_banco():
    _desligar(MODULO_CORE, MODULO_TECNOLOGIA)
    assert acesso.modulo_ativo(MODULO_CORE) and acesso.modulo_ativo(MODULO_TECNOLOGIA)
    admin = ROLE_PERMISSIONS["administrador"]
    assert "usuarios.visualizar" in acesso.filtrar_permissoes(admin)


def test_com_todos_ativos_o_filtro_nao_altera_nada():
    for perms in m._permissoes_efetivas_em_subprocesso("1").values():
        assert acesso.filtrar_permissoes(perms) == frozenset(perms)


def test_falha_ao_ler_o_estado_cai_nos_padroes_e_nao_trava_ninguem():
    def quebra():
        raise RuntimeError("banco fora")

    acesso.definir_carregador(quebra)
    assert acesso.modulo_ativo(MODULO_RH) and acesso.modulo_ativo(MODULO_OPERACAO)
    assert acesso.filtrar_permissoes({"candidatos.visualizar"}) == {"candidatos.visualizar"}


def test_reatribuir_o_dono_vale_em_runtime():
    base = acesso.EstadoModulos()
    acesso.definir_carregador(lambda: acesso.EstadoModulos(donos={"relatorios.visualizar": MODULO_RH}, abre={"relatorios.visualizar": False}, ativos=base.ativos))
    assert acesso.modulo_da_permissao("relatorios.visualizar") == MODULO_RH
    _desligar(MODULO_RH)
    acesso.definir_carregador(lambda: acesso.EstadoModulos(donos={"relatorios.visualizar": MODULO_RH}, ativos=frozenset({MODULO_CORE, MODULO_OPERACAO, MODULO_TECNOLOGIA})))
    assert acesso.filtrar_permissoes({"relatorios.visualizar", "inicio.visualizar"}) == {"inicio.visualizar"}


# ------------------------------------------------------------------ GET /core/acesso
def _cliente(perms, perfil="gestor"):
    app = FastAPI()
    app.include_router(core_router.router)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(username="t", perfil=perfil, permissions=frozenset(perms))
    return TestClient(app)


def test_endpoint_core_acesso_devolve_modulos_e_permissoes():
    perms = m._permissoes_efetivas_em_subprocesso("1")["analista_ti"]
    corpo = _cliente(perms, "analista_ti").get("/core/acesso").json()
    visiveis = [x["chave"] for x in corpo["modulos"] if x["visivel"]]
    assert visiveis == ["operacao", "tecnologia"] and corpo["modulo_padrao"] == "operacao"
    assert corpo["permissoes"] == sorted(perms) and corpo["operacao_ti"] == "TI"
    assert {x["chave"]: x["protegido"] for x in corpo["modulos"]} == {"rh": False, "operacao": False, "tecnologia": True}


def test_endpoint_modulo_desativado_some_do_seletor_e_das_permissoes():
    _desligar(MODULO_OPERACAO)
    perms = m._permissoes_efetivas_em_subprocesso("1")["analista_ti"]
    corpo = _cliente(perms, "analista_ti").get("/core/acesso").json()
    assert [x["chave"] for x in corpo["modulos"] if x["visivel"]] == ["tecnologia"]
    assert not any(p.startswith("wfm.") for p in corpo["permissoes"])


# ------------------------------------------------------------------ guarda nas rotas (get_current_user)
def test_guarda_bloqueia_rota_de_modulo_desativado_com_403():
    from fastapi import Depends

    from rh_api.dependencies import require_permissions

    app = FastAPI()

    @app.get("/x", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
    def _x():
        return {"ok": True}

    import rh_api.auth as auth_mod
    import rh_api.dependencies as dep

    usuario = AuthenticatedUser(username="u", perfil="gestor", permissions=frozenset({"candidatos.visualizar"}))
    app.dependency_overrides[dep.get_repository] = lambda: None
    # Passa pelo get_current_user real, com o token validado simulado.
    original = dep.validate_access_token
    dep.validate_access_token = lambda _t: usuario
    try:
        cliente = TestClient(app)
        cab = {"Authorization": "Bearer abc"}
        assert cliente.get("/x", headers=cab).status_code == 200
        _desligar(MODULO_RH)
        assert cliente.get("/x", headers=cab).status_code == 403
    finally:
        dep.validate_access_token = original
    assert auth_mod  # silencia lint


# ------------------------------------------------------------------ enumeração de rotas
def test_nenhuma_rota_nova_fica_sem_permissao_declarada():
    """Toda rota autenticada precisa exigir permissão (ou estar na lista congelada de rotas de autoatendimento/públicas)."""
    permitido = set(json.loads((m.SNAPSHOT_DIR / "rotas_sem_permissao.json").read_text(encoding="utf-8")))
    tabela = m.tabela_de_rotas()
    sem = {r for r, d in tabela.items() if not d["perms"] and not d["inline"]}
    novas = sorted(sem - permitido - {"GET /core/acesso"})
    assert not novas, f"Rotas novas sem permissão nem módulo declarados: {novas}"

"""Modularização, Etapa 4: a flag do WFM (RH_WFM_LIBERAR_PARTICIPANTES) virou configuração no banco.

Cobre os 5 estados (env ligada, env desligada, banco ligado, banco desligado, env x banco discordando) para Operador,
Técnico de TI e Qualidade, e prova que nenhum outro perfil muda em nenhum estado."""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from rh_api import auth, rbac
from rh_api.auth import AuthenticatedUser
from rh_api.dependencies import get_current_user, get_repository
from rh_api.routers import tecnologia as tecnologia_router
from rh_api.services import acesso

AFETADOS = ("operador", "qualidade", "tecnico_pleno")
TODOS = tuple(rbac.ROLE_DEFINITIONS)
NAO_AFETADOS = tuple(p for p in TODOS if p not in rbac.WFM_PERFIS_EM_TESTE_FECHADO)


@pytest.fixture()
def estado(monkeypatch):
    """Controla env e banco sem tocar em nenhum dos dois de verdade."""
    banco = {"valor": False, "indisponivel": False}

    def ler(_semente):
        if banco["indisponivel"]:
            raise RuntimeError("banco fora")
        return banco["valor"]

    monkeypatch.setattr(acesso, "_ler_banco_wfm", ler)

    def configurar(*, env=None, no_banco=False, indisponivel=False):
        if env is None:
            monkeypatch.delenv(acesso.VAR_AMBIENTE_WFM, raising=False)
        else:
            monkeypatch.setenv(acesso.VAR_AMBIENTE_WFM, env)
        banco["valor"], banco["indisponivel"] = no_banco, indisponivel
        acesso.invalidar_cache_wfm()
        acesso._wfm_log_emitido = False

    yield configurar
    acesso.invalidar_cache_wfm()
    acesso._wfm_log_emitido = False


def _tem_wfm(perfil: str) -> bool:
    permissoes = rbac.aplicar_restricao_wfm_em_teste(perfil, rbac.ROLE_PERMISSIONS[perfil])
    return any(p.startswith("wfm.") or p == "sessao.wfm.acessar" for p in permissoes)


CENARIOS = [
    ("env ligada", dict(env="1", no_banco=False), True),
    ("env desligada", dict(env="", no_banco=True), False),
    ("env 0 prevalece sobre banco ligado", dict(env="0", no_banco=True), False),
    ("env 1 prevalece sobre banco desligado", dict(env="1", no_banco=False), True),
    ("banco ligado", dict(env=None, no_banco=True), True),
    ("banco desligado", dict(env=None, no_banco=False), False),
    ("banco indisponível = fechado", dict(env=None, no_banco=True, indisponivel=True), False),
]


@pytest.mark.parametrize("nome,cfg,liberado", CENARIOS, ids=[c[0] for c in CENARIOS])
def test_participantes_so_ganham_wfm_quando_liberado(estado, nome, cfg, liberado):
    estado(**cfg)
    assert acesso.wfm_participantes_liberado() is liberado
    for perfil in AFETADOS:
        assert _tem_wfm(perfil) is liberado, f"{nome}/{perfil}"
        assert (any(p.startswith("wfm.") for p in rbac.get_role_permissions(perfil))) is liberado


def test_nenhum_outro_perfil_muda_em_nenhum_estado(estado):
    por_estado = []
    for _nome, cfg, _lib in CENARIOS:
        estado(**cfg)
        por_estado.append({p: frozenset(rbac.get_role_permissions(p)) for p in NAO_AFETADOS})
    assert all(snap == por_estado[0] for snap in por_estado), "um perfil fora da fase de teste mudou conforme a flag"


def test_tecnico_fechado_mantem_so_o_basico_e_a_administracao_de_ti(estado):
    estado(env=None, no_banco=False)
    permissoes = rbac.get_role_permissions("tecnico_pleno")
    assert {"inicio.visualizar", "notificacoes.visualizar", "usuarios.editar", "configuracoes.editar"} <= permissoes
    assert not any(p.startswith("wfm.") for p in permissoes)


def test_valor_inicial_do_banco_e_o_do_ambiente(estado, monkeypatch):
    """Sem linha no banco, ela nasce com o valor atual da variável de ambiente (nada muda no dia da implantação)."""
    chamadas = []

    def ler(semente):
        chamadas.append(semente)
        return semente

    estado(env="1")
    monkeypatch.setattr(acesso, "_ler_banco_wfm", ler)
    acesso.invalidar_cache_wfm()
    acesso._wfm_log_emitido = False
    assert acesso.wfm_participantes_liberado() is True
    assert chamadas == [True]  # a semente é o valor do ambiente


def test_variavel_de_ambiente_prevalecendo_e_registrada_em_log(estado, caplog):
    estado(env="1", no_banco=False)
    with caplog.at_level(logging.WARNING, logger="rh_api.services.acesso"):
        acesso.wfm_participantes_liberado()
        acesso.wfm_participantes_liberado()
    avisos = [r.getMessage() for r in caplog.records if "PREVALECE" in r.getMessage()]
    assert len(avisos) == 1 and "RH_WFM_LIBERAR_PARTICIPANTES=1" in avisos[0] and "banco (0)" in avisos[0]


def test_sem_variavel_nao_ha_log_de_prevalencia(estado, caplog):
    estado(env=None, no_banco=True)
    with caplog.at_level(logging.WARNING, logger="rh_api.services.acesso"):
        acesso.wfm_participantes_liberado()
    assert not [r for r in caplog.records if "PREVALECE" in r.getMessage()]


# ------------------------------------------------------------------ token
def _token(perfil: str, estado_ao_emitir, estado_fn, cfg_emissao, cfg_agora):
    estado_fn(**cfg_emissao)
    perms = frozenset(rbac.get_role_permissions(perfil))
    token = auth._build_token(AuthenticatedUser(username="u", id_usuario=1, perfil=perfil, permissions=perms))
    estado_fn(**cfg_agora)
    return token


FECHADO = dict(env=None, no_banco=False)
ABERTO = dict(env=None, no_banco=True)


@pytest.mark.parametrize("perfil", AFETADOS)
def test_abrir_o_wfm_forca_novo_login_so_dos_perfis_afetados(estado, perfil):
    token = _token(perfil, None, estado, FECHADO, ABERTO)
    with pytest.raises(HTTPException) as erro:
        auth.validate_access_token(token)
    assert erro.value.status_code == 401 and "Faça login novamente" in erro.value.detail


@pytest.mark.parametrize("perfil", [p for p in NAO_AFETADOS if p != "candidato"])
def test_abrir_o_wfm_nao_derruba_a_sessao_dos_demais_perfis(estado, perfil):
    token = _token(perfil, None, estado, FECHADO, ABERTO)
    assert auth.validate_access_token(token).perfil == perfil


@pytest.mark.parametrize("perfil", AFETADOS)
def test_fechar_o_wfm_vale_na_hora_sem_novo_login(estado, perfil):
    token = _token(perfil, None, estado, ABERTO, FECHADO)
    usuario = auth.validate_access_token(token)
    assert not any(p.startswith("wfm.") or p == "sessao.wfm.acessar" for p in usuario.permissions)


@pytest.mark.parametrize("perfil", AFETADOS)
def test_token_novo_apos_abrir_traz_o_wfm(estado, perfil):
    token = _token(perfil, None, estado, ABERTO, ABERTO)
    assert any(p.startswith("wfm.") for p in auth.validate_access_token(token).permissions)


# ------------------------------------------------------------------ botão (endpoint)
def _cliente(perfil="administrador", perms=("configuracoes.visualizar", "configuracoes.editar")):
    app = FastAPI()
    app.include_router(tecnologia_router.router)
    trilha: list[dict] = []

    class _Repo:
        def record_audit_log(self, **kw):
            trilha.append(kw)
            return {"success": True}

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(username="ti", id_usuario=7, perfil=perfil, permissions=frozenset(perms))
    app.dependency_overrides[get_repository] = lambda: _Repo()
    return TestClient(app), trilha


def test_botao_exige_confirmacao(estado):
    estado(env=None, no_banco=False)
    cliente, trilha = _cliente()
    assert cliente.put("/tecnologia/parametros/wfm-participantes", json={"valor": True}).status_code == 400
    assert trilha == []


def test_botao_recusa_enquanto_a_variavel_de_ambiente_prevalece(estado):
    estado(env="1", no_banco=False)
    cliente, _ = _cliente()
    resposta = cliente.put("/tecnologia/parametros/wfm-participantes", json={"valor": False, "confirmar": True})
    assert resposta.status_code == 409 and "RH_WFM_LIBERAR_PARTICIPANTES" in resposta.json()["detail"]
    situacao = cliente.get("/tecnologia/parametros/wfm-participantes").json()
    assert situacao["origem"] == "ambiente" and situacao["editavel"] is False and situacao["liberado"] is True


def test_botao_altera_o_banco_e_grava_auditoria(estado, monkeypatch):
    estado(env=None, no_banco=False)
    gravado = {}

    def definir(valor, *, autor):
        gravado.update(valor=valor, autor=autor)
        return {"valor_anterior": False, "valor": valor}

    monkeypatch.setattr(acesso, "definir_wfm_participantes", definir)
    cliente, trilha = _cliente()
    resposta = cliente.put("/tecnologia/parametros/wfm-participantes", json={"valor": True, "confirmar": True, "justificativa": "início do piloto"})
    assert resposta.status_code == 200 and gravado == {"valor": True, "autor": "ti"}
    assert len(trilha) == 1
    log = trilha[0]
    assert log["acao"] == "wfm_participantes_alterado" and log["valor_anterior"] == {"liberado": False} and log["valor_novo"] == {"liberado": True}
    assert log["user"].username == "ti" and log["justificativa"] == "início do piloto"


def test_botao_so_para_quem_edita_configuracoes(estado):
    from rh_api.dependencies import require_permissions  # noqa: F401 - garante a dependência real no roteador

    estado(env=None, no_banco=False)
    app = FastAPI()
    app.include_router(tecnologia_router.router)
    import rh_api.dependencies as dep

    original = dep.validate_access_token
    dep.validate_access_token = lambda _t: AuthenticatedUser(username="x", perfil="operador", permissions=frozenset({"inicio.visualizar"}))
    try:
        cliente = TestClient(app)
        cab = {"Authorization": "Bearer t"}
        assert cliente.get("/tecnologia/parametros/wfm-participantes", headers=cab).status_code == 403
        assert cliente.put("/tecnologia/parametros/wfm-participantes", headers=cab, json={"valor": True, "confirmar": True}).status_code == 403
    finally:
        dep.validate_access_token = original

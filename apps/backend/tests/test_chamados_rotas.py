"""Chamados — cada permissão libera só o que deve, na camada HTTP (o frontend nunca é a única barreira). Sem banco."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from rh_api.auth import AuthenticatedUser
from rh_api.dependencies import get_current_user, get_repository
from rh_api.main import create_app

TODAS = ("chamados.abrir", "chamados.ver_operacao", "chamados.atender", "chamados.atribuir", "chamados.dashboard", "chamados.configurar")


class RepositorioFalso:
    """Qualquer método devolve um dicionário vazio: só interessa se a rota deixou passar."""

    def __getattr__(self, nome):
        return lambda *a, **k: {"itens": [], "config": {}, "status": "ok", "urgencia": "alta"}


_APP = None


def _app():
    """create_app() é caro (monta todas as rotas): uma única instância para o módulo; cada teste troca só as dependências."""
    global _APP
    if _APP is None:
        _APP = create_app()
    return _APP


def _cliente(permissoes):
    app = _app()
    usuario = AuthenticatedUser(username="u", id_usuario=7, perfil="supervisor", permissions=frozenset(permissoes))
    app.dependency_overrides[get_current_user] = lambda: usuario
    app.dependency_overrides[get_repository] = lambda: RepositorioFalso()
    return TestClient(app, raise_server_exceptions=False)


def _chamar(cliente, metodo, caminho):
    if metodo == "POST" and caminho == "/chamados":
        return cliente.post(caminho, data={"dados": json.dumps({"titulo": "t"})})
    corpos = {
        "/chamados/1/atribuir": {"responsavel_id": 3},
        "/chamados/1/status": {"status": "em_andamento"},
        "/chamados/1/urgencia": {"urgencia": "alta"},
        "/chamados/config": {"valores": {"sla_horas_alta": 4}},
        "/chamados/config/categorias": {"nome": "Nova"},
        "/chamados/config/categorias/1": {"nome": "Nova"},
    }
    return cliente.request(metodo, caminho, json=corpos.get(caminho))


# (método, caminho, permissões que liberam a rota — qualquer uma)
ROTAS_GUARDADAS = [
    ("GET", "/chamados/meta", set(TODAS)),
    ("GET", "/chamados", {"chamados.abrir", "chamados.ver_operacao"}),
    ("GET", "/chamados/fila", {"chamados.atender"}),
    ("POST", "/chamados", {"chamados.abrir"}),
    ("GET", "/chamados/agentes?operacao=X&q=an", {"chamados.abrir"}),
    ("GET", "/chamados/atendentes", {"chamados.atribuir"}),
    ("GET", "/chamados/dashboard", {"chamados.dashboard"}),
    ("GET", "/chamados/config", {"chamados.configurar"}),
    ("PUT", "/chamados/config", {"chamados.configurar"}),
    ("POST", "/chamados/config/categorias", {"chamados.configurar"}),
    ("PUT", "/chamados/config/categorias/1", {"chamados.configurar"}),
    ("POST", "/chamados/1/assumir", {"chamados.atender"}),
    ("POST", "/chamados/1/atribuir", {"chamados.atribuir"}),
    ("PUT", "/chamados/1/status", {"chamados.atender"}),
    ("PUT", "/chamados/1/urgencia", {"chamados.atender"}),
]


@pytest.mark.parametrize("metodo,caminho,libera", ROTAS_GUARDADAS)
def test_sem_nenhuma_permissao_a_api_responde_403(metodo, caminho, libera):
    assert _chamar(_cliente(set()), metodo, caminho.split("?")[0] + ("?" + caminho.split("?")[1] if "?" in caminho else "")).status_code == 403


@pytest.mark.parametrize("metodo,caminho,libera", ROTAS_GUARDADAS)
def test_cada_permissao_libera_apenas_o_que_deve(metodo, caminho, libera):
    for permissao in TODAS:
        resposta = _chamar(_cliente({permissao}), metodo, caminho)
        if permissao in libera:
            assert resposta.status_code != 403, f"{permissao} deveria liberar {metodo} {caminho}"
        else:
            assert resposta.status_code == 403, f"{permissao} NÃO deveria liberar {metodo} {caminho}"


def test_sem_token_responde_401():
    app = _app()
    app.dependency_overrides.clear()
    assert TestClient(app).get("/chamados/meta").status_code == 401
    assert TestClient(app).get("/chamados/fila").status_code == 401


def test_acoes_do_solicitante_nao_exigem_permissao_na_rota():
    """Cancelar/confirmar/reabrir/detalhe/mensagem passam pela rota sem permissão: quem abriu nunca fica órfão. A regra de
    'só o solicitante' é do repositório (coberta nos testes de integração)."""
    cliente = _cliente(set())
    for metodo, caminho, corpo in (
        ("POST", "/chamados/1/cancelar", {"motivo": ""}),
        ("POST", "/chamados/1/confirmar-encerramento", None),
        ("POST", "/chamados/1/reabrir", {"motivo": "x"}),
        ("GET", "/chamados/1", None),
        ("GET", "/chamados/1/eventos", None),
        ("DELETE", "/chamados/anexos/1", None),
    ):
        assert cliente.request(metodo, caminho, json=corpo).status_code != 403, (metodo, caminho)

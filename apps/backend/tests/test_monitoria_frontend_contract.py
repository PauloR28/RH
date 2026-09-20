"""Contratos estáticos entre o frontend e o backend da Monitoria (sem navegador)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.rbac import (
    ROLE_ADMIN,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_SUPERVISOR,
    ROLE_QUALIDADE,
    ROLE_CONTROL_DESK,
    ROLE_PERMISSIONS,
    SCREEN_PERMISSIONS,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FONTE = REPO_ROOT / "apps" / "frontend" / "fonte"


def _ler(caminho: Path) -> str:
    return caminho.read_text(encoding="utf-8")


def test_rotas_spa_da_monitoria_nao_colidem_com_o_prefixo_da_api():
    """Recarregar a página numa rota do SPA que também é rota GET da API devolveria JSON
    em vez da aplicação (achado na verificação de C5). O SPA usa `monitorias/...`."""
    rotas = dict(re.findall(r"'(screen-monitoria[a-z-]*)': '([^']+)'", _ler(FONTE / "rotas.js")))
    assert len(rotas) >= 13
    for tela, rota in rotas.items():
        assert not (rota == "monitoria" or rota.startswith("monitoria/")), f"{tela} -> {rota} colide com /monitoria (API)"


def test_permissoes_das_telas_do_frontend_espelham_o_backend():
    codigo = _ler(FONTE / "app" / "controlador-aplicacao.js")
    frontend = dict(re.findall(r"'(screen-monitoria[a-z-]*|screen-settings-monitoria)': '([a-z_.]+)'", codigo.split("SESSAO_DA_TELA")[0]))
    assert frontend, "mapa de permissões da Monitoria não encontrado no controlador"
    for tela, permissao in frontend.items():
        assert SCREEN_PERMISSIONS.get(tela) == permissao, (tela, permissao, SCREEN_PERMISSIONS.get(tela))


def test_todas_as_abas_da_monitoria_tem_permissao_existente():
    indice = _ler(FONTE / "features" / "monitoria" / "index.js")
    permissoes = set(re.findall(r"permissao: '([a-z_.]+)'", indice))
    conhecidas = set().union(*ROLE_PERMISSIONS.values())
    assert permissoes and permissoes <= conhecidas


def test_menu_por_sessoes_supervisor_e_operador_mostram_apenas_treinamentos_e_monitoria():
    for perfil in (ROLE_SUPERVISOR, ROLE_OPERATOR):
        sessoes = {p.split(".")[1] for p in ROLE_PERMISSIONS[perfil] if p.startswith("sessao.")}
        assert sessoes == {"treinamentos", "monitoria"}, (perfil, sessoes)
    assert {p.split(".")[1] for p in ROLE_PERMISSIONS[ROLE_QUALIDADE] if p.startswith("sessao.")} == {"monitoria"}
    assert {p.split(".")[1] for p in ROLE_PERMISSIONS[ROLE_CONTROL_DESK] if p.startswith("sessao.")} == {"monitoria"}
    assert "inicio.visualizar" in ROLE_PERMISSIONS[ROLE_SUPERVISOR]


def test_gestor_e_admin_tem_acesso_a_central_de_monitoria():
    assert "sessao.monitoria.acessar" in ROLE_PERMISSIONS[ROLE_ADMIN]
    assert "monitoria.configurar" in ROLE_PERMISSIONS[ROLE_ADMIN]
    assert {"sessao.monitoria.acessar", "monitoria.visualizar", "monitoria.dashboard"} <= ROLE_PERMISSIONS[ROLE_MANAGER]


def test_login_nao_menciona_mais_rh_na_marca():
    gestao = _ler(FONTE / "features" / "gestao" / "index.js")
    assert "Sistema Interno RH" not in gestao and "Acesso ao ambiente RH" not in gestao
    assert "Acesse sua conta" in gestao and "Esqueci a senha" in gestao


def test_caddy_encaminha_a_api_da_monitoria_ao_backend():
    caddy = _ler(REPO_ROOT / "infra" / "caddy" / "Caddyfile")
    assert "/monitoria/*" in caddy

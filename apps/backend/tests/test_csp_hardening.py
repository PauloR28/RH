"""Achado SEC-012 (S-11): remove 'unsafe-inline' de script-src no CSP do
Caddy, migrando o único <script> inline de index.html para um arquivo
externo (fonte/tema-inicial.js). Checagem estática de conteúdo (mesmo
padrão de test_performance_index_script.py) — não executa JavaScript."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIR = REPO_ROOT / "apps" / "frontend"
CADDYFILE = REPO_ROOT / "infra" / "caddy" / "Caddyfile"

_SCRIPT_TAG_PATTERN = re.compile(r"<script\b([^>]*)>", re.IGNORECASE)


def _csp_directive(csp: str, name: str) -> str:
    match = re.search(rf"{re.escape(name)}\s+([^;]*)", csp)
    assert match, f"Diretiva {name} não encontrada no CSP"
    return match.group(1)


def test_caddyfile_script_src_no_longer_allows_unsafe_inline():
    content = CADDYFILE.read_text(encoding="utf-8")
    match = re.search(r'Content-Security-Policy\s+"([^"]+)"', content)
    assert match, "Header Content-Security-Policy não encontrado no Caddyfile"
    csp = match.group(1)

    script_src = _csp_directive(csp, "script-src")
    assert "'unsafe-inline'" not in script_src

    # style-src deliberadamente NÃO foi endurecido nesta rodada: a UI usa
    # estilo inline dinâmico via React (style=${{...}}) em dezenas de
    # lugares (barras de progresso, larguras calculadas, etc.) — remover
    # 'unsafe-inline' de style-src exigiria reescrever todos esses pontos
    # para classes/CSS custom properties, fora do escopo deste quick win.
    style_src = _csp_directive(csp, "style-src")
    assert "'unsafe-inline'" in style_src


def test_index_html_has_no_inline_script_blocks():
    content = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    for tag_attrs in _SCRIPT_TAG_PATTERN.findall(content):
        assert "src=" in tag_attrs, (
            f"<script{tag_attrs}> é um bloco inline — precisa de src= externo para não depender de "
            "script-src 'unsafe-inline'"
        )


def test_tema_inicial_script_exists_and_is_referenced_by_index_html():
    tema_script = FRONTEND_DIR / "fonte" / "tema-inicial.js"
    assert tema_script.is_file()
    content = tema_script.read_text(encoding="utf-8")
    assert "c24_tema_preferido" in content
    assert "data-theme" in content
    assert "data-bs-theme" in content

    index_html = (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    assert re.search(r'<script src="/fonte/tema-inicial\.js(\?v=[\w-]+)?"></script>', index_html)

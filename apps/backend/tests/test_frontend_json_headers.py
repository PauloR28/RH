"""Toda chamada do frontend que manda corpo JSON precisa avisar o tipo (Content-Type: application/json).

Sem isso o navegador manda como texto e o servidor responde "Input should be a valid dictionary or object
to extract fields from" (bug das Equipes, 24/11/2026: salvar equipe e mover operadores).
"""

from __future__ import annotations

import re
from pathlib import Path

FONTE = Path(__file__).resolve().parents[2] / "frontend" / "fonte"


def test_corpo_json_sempre_com_cabecalho():
    faltando = []
    for arquivo in sorted(FONTE.rglob("*.js")):
        linhas = arquivo.read_text(encoding="utf-8").splitlines()
        for n, linha in enumerate(linhas):
            if not re.search(r"\bbody:\s*JSON\.stringify", linha):
                continue
            janela = "\n".join(linhas[max(0, n - 4): n + 2])
            if "headers" not in janela and "HEADERS" not in janela:
                faltando.append(f"{arquivo.relative_to(FONTE)}:{n + 1}")
    assert not faltando, "Corpo JSON sem Content-Type: " + ", ".join(faltando)

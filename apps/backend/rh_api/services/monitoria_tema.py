"""Tema por operação (promt.txt §4): deriva os tokens do Conecta (--brand,
--brand-ink, --brand-soft) a partir de UMA cor primária e valida contraste
(WCAG AA) — botões primários usam texto branco sobre --brand, então a cor
precisa ter contraste >= 4,5:1 com branco. Nada além da cor primária muda
(tags de status, fundo branco e cores de alerta permanecem do Conecta)."""

from __future__ import annotations

import re

_HEX = re.compile(r"^#([0-9a-fA-F]{6})$")
MIN_CONTRASTE_BOTAO = 4.5


def normalizar_hex(cor: str) -> str:
    texto = (cor or "").strip()
    if len(texto) == 4 and texto.startswith("#"):  # #abc → #aabbcc
        texto = "#" + "".join(c * 2 for c in texto[1:])
    if not _HEX.match(texto):
        raise ValueError("Informe a cor no formato #RRGGBB.")
    return texto.lower()


def _rgb(hexcor: str) -> tuple[int, int, int]:
    h = hexcor.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _luminancia(rgb: tuple[int, int, int]) -> float:
    def canal(v: int) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (canal(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(cor_a: str, cor_b: str) -> float:
    la, lb = _luminancia(_rgb(cor_a)), _luminancia(_rgb(cor_b))
    claro, escuro = max(la, lb), min(la, lb)
    return round((claro + 0.05) / (escuro + 0.05), 2)


def _mistura(cor: str, alvo: tuple[int, int, int], fator: float) -> str:
    r, g, b = _rgb(cor)
    return "#{:02x}{:02x}{:02x}".format(*(round(c + (t - c) * fator) for c, t in zip((r, g, b), alvo)))


def derivar_tokens(cor_primaria: str) -> dict[str, str]:
    """Tokens do tema claro e do escuro a partir da cor primária."""
    cor = normalizar_hex(cor_primaria)
    return {
        "brand": cor,
        "brand-ink": _mistura(cor, (0, 0, 0), 0.45),      # variação escura (hover/texto sobre suave)
        "brand-soft": _mistura(cor, (255, 255, 255), 0.9),  # fundo suave (badges/itens ativos)
        "brand-dark-mode": _mistura(cor, (255, 255, 255), 0.25),
    }


def validar_cor_primaria(cor_primaria: str) -> tuple[str, list[str]]:
    """Devolve (cor normalizada, erros). Recusa cor sem contraste AA com branco
    (botões primários) ou contraste insuficiente do texto escuro sobre o fundo suave."""
    try:
        cor = normalizar_hex(cor_primaria)
    except ValueError as exc:
        return "", [str(exc)]
    erros: list[str] = []
    if contraste(cor, "#ffffff") < MIN_CONTRASTE_BOTAO:
        erros.append(
            f"A cor {cor} é clara demais para botões com texto branco (contraste {contraste(cor, '#ffffff')}:1; mínimo {MIN_CONTRASTE_BOTAO}:1)."
        )
    tokens = derivar_tokens(cor)
    if contraste(tokens["brand-ink"], tokens["brand-soft"]) < MIN_CONTRASTE_BOTAO:
        erros.append("A cor escolhida não gera um texto legível sobre o fundo suave (contraste insuficiente).")
    return cor, erros

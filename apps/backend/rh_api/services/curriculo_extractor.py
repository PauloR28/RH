from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .cv import CvTextExtractionError, extract_text_from_uploaded_file, normalize_cv_text

_CONTACT_PATTERNS = (
    re.compile(r"(?i)\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b"),
    re.compile(r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{4}(?!\d)"),
    re.compile(r"(?i)\b(?:cpf|rg)\s*[:\-]?\s*[\d.\-/]+"),
)
_SENSITIVE_LINE = re.compile(
    r"(?i)^\s*(?:data\s+de\s+nascimento|nascimento|idade|sexo|g[eê]nero|"
    r"estado\s+civil|religi[aã]o|ra[cç]a|etnia|nacionalidade|endere[cç]o|"
    r"defici[eê]ncia)\s*[:\-]"
)


@dataclass(frozen=True)
class CurriculoTexto:
    texto: str
    caracteres_extraidos: int
    caracteres_enviados: int
    truncado: bool


def _remover_dados_desnecessarios(texto: str) -> str:
    linhas = []
    for linha in texto.splitlines():
        if _SENSITIVE_LINE.match(linha):
            continue
        limpa = linha
        for pattern in _CONTACT_PATTERNS:
            limpa = pattern.sub("[DADO_REMOVIDO]", limpa)
        linhas.append(limpa)
    return normalize_cv_text("\n".join(linhas))


def extrair_curriculo_para_ia(
    caminho_arquivo: str,
    nome_arquivo: str,
    mime_type: str,
    *,
    limite_caracteres: int,
) -> CurriculoTexto:
    caminho = Path(caminho_arquivo).expanduser()
    if not caminho.is_file():
        raise CvTextExtractionError("Currículo não encontrado para este candidato.")

    texto_extraido = extract_text_from_uploaded_file(
        nome_arquivo or caminho.name,
        caminho.read_bytes(),
        mime_type or "",
    )
    texto_normalizado = _remover_dados_desnecessarios(texto_extraido)
    if not texto_normalizado:
        raise CvTextExtractionError(
            "Não foi possível encontrar texto profissional utilizável no currículo."
        )

    limite = max(1000, int(limite_caracteres or 30000))
    truncado = len(texto_normalizado) > limite
    texto_enviado = texto_normalizado[:limite].rstrip()
    if truncado:
        texto_enviado += "\n[CURRÍCULO TRUNCADO PELO LIMITE DE SEGURANÇA]"

    return CurriculoTexto(
        texto=texto_enviado,
        caracteres_extraidos=len(texto_normalizado),
        caracteres_enviados=len(texto_enviado),
        truncado=truncado,
    )

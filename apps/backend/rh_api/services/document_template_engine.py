"""Motor simples de substituição de variáveis para templates de documentos.

Placeholders no formato ``{{variavel}}`` (espaços ao redor do nome são
tolerados: ``{{ variavel }}``) são substituídos pelo valor correspondente do
dicionário informado. Nunca lança erro por variável ausente: quando o valor
não está disponível, o placeholder é substituído por um texto indicativo
visível (``[não informado]``) por padrão, mantendo o documento gerado
legível e sem quebrar a geração.
"""

from __future__ import annotations

import re

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")

MISSING_VALUE_PLACEHOLDER = "[não informado]"

# Lista de variáveis suportadas nativamente pelo motor de geração de
# documentos, documentada aqui e também exposta na tela de cadastro de
# templates como ajuda ao usuário do RH.
SUPPORTED_VARIABLES: dict[str, str] = {
    "nome_candidato": "Nome completo do candidato.",
    "vaga": "Nome da vaga/processo seletivo vinculado.",
    "email_candidato": "E-mail informado pelo candidato.",
    "telefone_candidato": "Telefone informado pelo candidato.",
    "id_processo": "Identificador do processo seletivo.",
    "status_candidato": "Status atual do candidato no processo.",
    "data_admissao": "Data de admissão (quando informada manualmente na geração).",
    "salario": "Salário combinado (quando informado manualmente na geração).",
    "nome_empresa": "Nome da empresa (Central 24 Horas).",
    "data_atual": "Data em que o documento está sendo gerado.",
}


def render_template_text(texto: str, variaveis: dict | None = None) -> str:
    """Substitui ``{{variavel}}`` pelos valores de ``variaveis``.

    Variáveis ausentes ou com valor vazio nunca geram erro: o placeholder é
    trocado por ``MISSING_VALUE_PLACEHOLDER``. Variáveis fora do texto do
    template são simplesmente ignoradas.
    """
    safe_texto = str(texto or "")
    safe_variaveis = variaveis if isinstance(variaveis, dict) else {}

    def _substituir(match: re.Match) -> str:
        chave = match.group(1)
        valor = safe_variaveis.get(chave)
        if valor is None:
            return MISSING_VALUE_PLACEHOLDER
        texto_valor = str(valor).strip()
        return texto_valor if texto_valor else MISSING_VALUE_PLACEHOLDER

    return PLACEHOLDER_PATTERN.sub(_substituir, safe_texto)


def extract_template_variables(texto: str) -> list[str]:
    """Retorna a lista (sem duplicatas, na ordem de aparição) de variáveis
    referenciadas no texto do template."""
    vistos: list[str] = []
    for match in PLACEHOLDER_PATTERN.finditer(str(texto or "")):
        chave = match.group(1)
        if chave not in vistos:
            vistos.append(chave)
    return vistos

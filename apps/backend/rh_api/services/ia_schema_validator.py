from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

PARECERES_PERMITIDOS = (
    "ADERENTE",
    "ADERENTE_COM_RESSALVAS",
    "BAIXA_ADERENCIA",
    "INSUFICIENTE_PARA_ANALISE",
)


class AnaliseCurriculoIaSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nota_aderencia: float = Field(ge=0, le=100)
    parecer: Literal[
        "ADERENTE",
        "ADERENTE_COM_RESSALVAS",
        "BAIXA_ADERENCIA",
        "INSUFICIENTE_PARA_ANALISE",
    ]
    resumo: str
    pontos_fortes: list[str]
    pontos_atencao: list[str]
    riscos: list[str]
    justificativa: str
    perguntas_sugeridas_entrevista: list[str]

    @field_validator("resumo", "justificativa")
    @classmethod
    def validar_texto(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("deve ser texto")
        return value.strip()

    @field_validator(
        "pontos_fortes",
        "pontos_atencao",
        "riscos",
        "perguntas_sugeridas_entrevista",
    )
    @classmethod
    def validar_lista_textos(cls, value: list[str]) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("deve ser uma lista")
        return [str(item).strip() for item in value if str(item).strip()]


class IaSchemaValidationError(ValueError):
    pass


def _remover_cerca_markdown(conteudo: str) -> str:
    texto = (conteudo or "").strip()
    cerca = chr(96) * 3
    pattern = rf"{re.escape(cerca)}(?:json)?\s*(.*?)\s*{re.escape(cerca)}"
    match = re.fullmatch(pattern, texto, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else texto


def validar_resultado_ia(conteudo: str | dict) -> tuple[dict, dict]:
    bruto = conteudo if isinstance(conteudo, dict) else None
    if bruto is None:
        try:
            bruto = json.loads(_remover_cerca_markdown(conteudo))
        except (TypeError, json.JSONDecodeError) as exc:
            raise IaSchemaValidationError("A IA retornou JSON inválido.") from exc

    if not isinstance(bruto, dict):
        raise IaSchemaValidationError("A IA não retornou um objeto JSON.")

    try:
        validado = AnaliseCurriculoIaSchema.model_validate(bruto)
    except ValidationError as exc:
        campos = sorted(
            {
                str(erro.get("loc", ["campo"])[0])
                for erro in exc.errors()
                if erro.get("loc")
            }
        )
        detalhe = ", ".join(campos) or "estrutura"
        raise IaSchemaValidationError(
            f"A resposta da IA não atende ao schema esperado ({detalhe})."
        ) from exc

    return validado.model_dump(), bruto

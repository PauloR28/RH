from __future__ import annotations

from pydantic import field_validator

from .common import BaseSchema


class DiscFraseInput(BaseSchema):
    dimensao: str = ""
    texto: str = ""

    @field_validator("dimensao")
    @classmethod
    def validate_dimensao(cls, value: str) -> str:
        safe_value = str(value or "").strip().upper()
        if safe_value not in {"D", "I", "S", "C"}:
            raise ValueError("Dimensão deve ser D, I, S ou C.")
        return safe_value

    @field_validator("texto")
    @classmethod
    def validate_texto(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o texto da frase.")
        return safe_value


class DiscBlocoCreateRequest(BaseSchema):
    ordem: int = 0
    frases: list[DiscFraseInput] = []

    @field_validator("frases")
    @classmethod
    def validate_frases(cls, value: list[DiscFraseInput]) -> list[DiscFraseInput]:
        if len(value) != 4:
            raise ValueError("Cada bloco DISC precisa ter exatamente 4 frases (D, I, S e C).")
        dimensoes = {frase.dimensao for frase in value}
        if dimensoes != {"D", "I", "S", "C"}:
            raise ValueError("O bloco precisa ter uma frase para cada dimensão (D, I, S e C).")
        return value


class DiscBlocoUpdateRequest(DiscBlocoCreateRequest):
    """Correções.txt item 7: mesma validação de criação (4 frases, uma por dimensão)."""


class DiscAplicacaoCreateRequest(BaseSchema):
    id_teste: str = ""
    id_processo_ref: int | None = None

    @field_validator("id_teste")
    @classmethod
    def validate_id_teste(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o identificador do candidato (id_teste).")
        return safe_value


class DiscRespostaBlocoRequest(BaseSchema):
    bloco_id: int
    frase_mais_id: int
    frase_menos_id: int

    @field_validator("frase_menos_id")
    @classmethod
    def validate_diferentes(cls, value: int, info) -> int:
        mais = info.data.get("frase_mais_id")
        if mais is not None and value == mais:
            raise ValueError("A frase 'mais' e a frase 'menos' precisam ser diferentes.")
        return value


class DiscFinalizarRequest(BaseSchema):
    respostas: list[DiscRespostaBlocoRequest] = []

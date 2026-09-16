from __future__ import annotations

from pydantic import field_validator

from .common import BaseSchema


class MuralPublicacaoCreateRequest(BaseSchema):
    titulo: str = ""
    resumo: str = ""
    conteudo_html: str = ""
    categoria: str = ""
    fixado: bool = False
    imagens: list[str] = []
    ambientes: list[int] = []

    @field_validator("titulo")
    @classmethod
    def validate_titulo(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o título da publicação.")
        if len(safe_value) > 255:
            raise ValueError("O título deve ter no máximo 255 caracteres.")
        return safe_value

    @field_validator("conteudo_html")
    @classmethod
    def validate_conteudo_html(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Escreva o conteúdo da publicação.")
        return safe_value


class MuralPublicacaoUpdateRequest(MuralPublicacaoCreateRequest):
    pass


class MuralPublicarRequest(BaseSchema):
    ambientes: list[int] = []

from __future__ import annotations

from pydantic import field_validator

from .common import BaseSchema


class DocumentoBibliotecaCreateRequest(BaseSchema):
    titulo: str = ""
    topico: str = ""
    area: str = ""
    descricao: str = ""
    url_arquivo: str = ""
    ativo: bool = True

    @field_validator("titulo")
    @classmethod
    def validate_titulo(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o título do documento.")
        if len(safe_value) > 255:
            raise ValueError("O título deve ter no máximo 255 caracteres.")
        return safe_value

    @field_validator("topico")
    @classmethod
    def validate_topico(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o tópico do documento.")
        if len(safe_value) > 120:
            raise ValueError("O tópico deve ter no máximo 120 caracteres.")
        return safe_value

    @field_validator("url_arquivo")
    @classmethod
    def validate_url_arquivo(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o link do arquivo.")
        if len(safe_value) > 1000:
            raise ValueError("O link do arquivo é grande demais.")
        return safe_value


class DocumentoBibliotecaUpdateRequest(DocumentoBibliotecaCreateRequest):
    pass

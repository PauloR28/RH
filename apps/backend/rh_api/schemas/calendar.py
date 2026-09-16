from __future__ import annotations

from pydantic import field_validator

from .common import BaseSchema


class CelebratoryDateCreateRequest(BaseSchema):
    titulo: str = ""
    # dia/mes continuam aceitos por compatibilidade (formulários antigos),
    # mas quando data_inicio é enviado ele é a fonte da verdade — ver
    # repositories/celebratory_dates.py._resolver_dados_evento.
    dia: int = 0
    mes: int = 0
    descricao: str = ""
    data_inicio: str = ""
    data_fim: str = ""
    dia_inteiro: bool = True
    local: str = ""
    link: str = ""
    categoria: str = ""
    imagem_url: str = ""
    id_ambiente: int | None = None

    @field_validator("titulo")
    @classmethod
    def validate_titulo(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe o título da data comemorativa.")
        if len(safe_value) > 255:
            raise ValueError("O título deve ter no máximo 255 caracteres.")
        return safe_value

    @field_validator("dia")
    @classmethod
    def validate_dia(cls, value: int) -> int:
        if value and (value < 1 or value > 31):
            raise ValueError("Informe um dia válido (1 a 31).")
        return value

    @field_validator("mes")
    @classmethod
    def validate_mes(cls, value: int) -> int:
        if value and (value < 1 or value > 12):
            raise ValueError("Informe um mês válido (1 a 12).")
        return value

    @field_validator("descricao")
    @classmethod
    def validate_descricao(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if len(safe_value) > 1000:
            raise ValueError("A descrição deve ter no máximo 1000 caracteres.")
        return safe_value


class CelebratoryDateUpdateRequest(CelebratoryDateCreateRequest):
    pass

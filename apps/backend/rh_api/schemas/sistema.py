from __future__ import annotations

from pydantic import Field

from .common import BaseSchema


class ParametroSistemaRequest(BaseSchema):
    valor: str = Field(default="")
    categoria: str = Field(default="geral")
    descricao: str = Field(default="")
    mascarado: bool = False
    justificativa: str = Field(default="")


class ResetarDadosConectaRequest(BaseSchema):
    confirmacao: str = Field(default="")


class AmbienteSharePointRequest(BaseSchema):
    nome: str = Field(default="")
    operacao_id: int | None = Field(default=None)
    site_url: str = Field(default="")
    biblioteca_destino: str = Field(default="")

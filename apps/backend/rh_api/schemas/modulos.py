from __future__ import annotations

from typing import Literal

from pydantic import Field

from .common import BaseSchema


class ModuloAtivoRequest(BaseSchema):
    ativo: bool
    justificativa: str = Field(default="", max_length=400)


class PermissaoModuloRequest(BaseSchema):
    modulo: str = Field(min_length=1, max_length=30)
    abre_modulo: bool | None = None
    justificativa: str = Field(default="", max_length=400)


class FuncaoModuloRequest(BaseSchema):
    ativo: bool
    justificativa: str = Field(default="", max_length=400)


class AlteracaoLoteRequest(BaseSchema):
    """Uma mudança do lote: ligar/desligar um módulo, uma função de um módulo ou a liberação do WFM para participantes."""

    tipo: Literal["modulo", "funcao", "wfm_participantes"]
    modulo: str = Field(default="", max_length=30)
    funcao: str = Field(default="", max_length=40)
    ativo: bool


class LoteModulosRequest(BaseSchema):
    alteracoes: list[AlteracaoLoteRequest] = Field(min_length=1, max_length=60)
    justificativa: str = Field(default="", max_length=400)


class ModulosAcessoRequest(BaseSchema):
    modulos: list[str] = Field(default_factory=list, max_length=10)
    justificativa: str = Field(default="", max_length=400)


class WfmParticipantesRequest(BaseSchema):
    valor: bool
    confirmar: bool = False
    justificativa: str = Field(default="", max_length=400)

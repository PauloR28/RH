from __future__ import annotations

from pydantic import Field

from .common import BaseSchema


class ModuloAtivoRequest(BaseSchema):
    ativo: bool
    justificativa: str = Field(default="", max_length=400)


class PermissaoModuloRequest(BaseSchema):
    modulo: str = Field(min_length=1, max_length=30)
    abre_modulo: bool | None = None
    justificativa: str = Field(default="", max_length=400)


class ModulosAcessoRequest(BaseSchema):
    modulos: list[str] = Field(default_factory=list, max_length=10)
    justificativa: str = Field(default="", max_length=400)


class WfmParticipantesRequest(BaseSchema):
    valor: bool
    confirmar: bool = False
    justificativa: str = Field(default="", max_length=400)

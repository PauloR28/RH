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


class MudancaAcessoRequest(BaseSchema):
    """Central de Acessos (Etapa 6): uma célula (perm) ou a chave de uma função (funcao)."""

    tipo: Literal["perm", "funcao"]
    chave: str = Field(default="", max_length=120)
    perfil: str = Field(default="", max_length=60)
    valor: bool = False
    funcao: str = Field(default="", max_length=40)
    ligada: bool = True


class LoteAcessosRequest(BaseSchema):
    modulo: str = Field(max_length=30)
    escopo: str = Field(default="padrao", max_length=80)
    mudancas: list[MudancaAcessoRequest] = Field(min_length=1, max_length=400)
    justificativa: str = Field(default="", max_length=400)


class PadronizarAcessosRequest(BaseSchema):
    modulo: str = Field(max_length=30)
    escopo: str = Field(default="padrao", max_length=80)
    justificativa: str = Field(default="", max_length=400)

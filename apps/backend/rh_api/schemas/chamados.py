from __future__ import annotations

from pydantic import Field

from .common import BaseSchema


class ChamadoCriarRequest(BaseSchema):
    titulo: str = Field(default="", max_length=160)
    descricao: str = Field(default="", max_length=20000)
    categoria_id: int = Field(default=0)
    operacao: str = Field(default="", max_length=60)
    tipo_impacto: str = Field(default="agente", max_length=10)
    agentes_ids: list[int] = Field(default_factory=list, max_length=50)
    pa_posto: str = Field(default="", max_length=40)
    pa_parada: bool = False
    urgencia: str = Field(default="media", max_length=10)


class MensagemRequest(BaseSchema):
    conteudo: str = Field(default="", max_length=8000)


class AtribuirRequest(BaseSchema):
    responsavel_id: int


class StatusRequest(BaseSchema):
    status: str = Field(max_length=30)
    justificativa: str = Field(default="", max_length=1000)


class UrgenciaRequest(BaseSchema):
    urgencia: str = Field(max_length=10)
    justificativa: str = Field(default="", max_length=1000)


class MotivoRequest(BaseSchema):
    motivo: str = Field(default="", max_length=1000)


class ConfigRequest(BaseSchema):
    valores: dict[str, float] = Field(default_factory=dict)


class CategoriaRequest(BaseSchema):
    nome: str = Field(default="", max_length=80)
    ativo: bool | None = None
    ordem: int | None = None

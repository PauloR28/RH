from __future__ import annotations

from pydantic import Field

from .common import BaseSchema


class PainelMetricaIn(BaseSchema):
    metrica: str = Field(min_length=1, max_length=40)
    forma: str = Field(default="", max_length=30)


class PainelSalvarRequest(BaseSchema):
    modulo: str = Field(min_length=1, max_length=20)
    operacao: str = Field(min_length=1, max_length=60)
    ativo: bool = True
    intervalo_seg: int = 60
    metricas: list[PainelMetricaIn] = Field(default_factory=list, max_length=20)
    perfis: list[str] = Field(default_factory=list, max_length=40)

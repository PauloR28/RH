from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import Field

from .common import BaseSchema


class ExigenciaPausaRequest(BaseSchema):
    nome: str = Field(default="", max_length=60)
    a_partir_de_min: int = Field(default=0, ge=0, le=1440)
    tipo: str = Field(default="", max_length=20)
    quantidade: int = Field(default=0, ge=0, le=20)
    duracao_min: int = Field(default=0, ge=0, le=480)


class ContratoRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    codigo: str = Field(default="", max_length=30)
    nome: str = Field(default="", max_length=120)
    tipo: str = Field(default="", max_length=20)
    jornada_diaria_max_min: int = Field(ge=30, le=1440)
    interjornada_min_min: int = Field(ge=0, le=1440)
    max_dias_consecutivos: int = Field(ge=1, le=31)
    jornada_feriado_max_min: int | None = Field(default=None, ge=30, le=1440)
    jornada_bloqueio_duro: bool = False
    exigencias_pausa: list[ExigenciaPausaRequest] = Field(default_factory=list, max_length=20)
    ativo: bool = True


class PausaTurnoRequest(BaseSchema):
    offset_min: int = Field(default=0, ge=0, le=1440)
    duracao_min: int = Field(default=1, ge=1, le=480)
    tipo: str = Field(default="", max_length=20)


class TurnoRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    id_contrato: int | None = None  # turno atrelado a um contrato: a saída = entrada + jornada do contrato
    id_supervisor: int | None = None  # supervisor responsável pelo turno (a equipe vem do supervisor)
    codigo: str = Field(default="", max_length=20)
    nome: str = Field(default="", max_length=120)
    tipo: str = Field(default="TRABALHO", max_length=12)
    cor: str = Field(default="#1f5fbf", max_length=9)
    entrada: str = Field(default="", max_length=5)
    saida: str = Field(default="", max_length=5)
    pausas: list[PausaTurnoRequest] = Field(default_factory=list, max_length=12)
    ativo: bool = True


class SkillRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    categoria: str = Field(default="", max_length=20)
    nome: str = Field(default="", max_length=120)
    ativo: bool = True


class SkillsOperadorRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    ids_skill: list[int] = Field(default_factory=list, max_length=50)


class ContratoOperadorRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    id_contrato: int
    vigencia_ini: date


class EventoRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    tipo: str = Field(default="", max_length=20)
    data_ini: str = Field(default="", max_length=10)
    data_fim: str = Field(default="", max_length=10)
    descricao: str = Field(default="", max_length=200)
    id_turno: int | None = None
    entrada: str = Field(default="", max_length=5)
    saida: str = Field(default="", max_length=5)
    ativo: bool = True


class ItemEscalaRequest(BaseSchema):
    id_operador: int
    data: str = Field(max_length=10)
    id_turno: int | None = None  # None remove a marcação do dia
    versao_linha: int | None = None  # versão lida; exigida para editar linha existente
    ajustar_horario: bool = False  # True: `entrada`/`saida` vazias removem o horário combinado do dia
    entrada: str = Field(default="", max_length=5)
    saida: str = Field(default="", max_length=5)


class SalvarItensRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    ano_mes: str = Field(max_length=7)
    itens: list[ItemEscalaRequest] = Field(default_factory=list)
    justificativa: str = Field(default="", max_length=400)


class PublicarRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    ano_mes: str = Field(max_length=7)
    justificativa: str = Field(default="", max_length=400)


class DeclinarRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    ano_mes: str = Field(max_length=7)
    justificativa: str = Field(default="", max_length=400)


class TipoEscalaRequest(BaseSchema):
    operacao_base: str = Field(default="TI", max_length=60)
    nome: str = Field(default="", max_length=120)
    descricao: str = Field(default="", max_length=200)
    ativo: bool = True


class ConfigEscalaRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    nome_escala: str = Field(default="", max_length=120)
    perfis: list[str] = Field(default_factory=list, max_length=5)
    usuarios: list[int] = Field(default_factory=list, max_length=100)
    ativa: bool | None = None
    alterar_jornada: bool = False
    id_contrato: int | None = None
    troca_antecedencia_dias: int | None = Field(default=None, ge=0, le=30)


class CriarEscalaRequest(BaseSchema):
    operacao_base: str = Field(max_length=60)
    nome: str = Field(max_length=120)


class DuplicarEscalaRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    operacao_destino: str = Field(max_length=60)
    nome: str = Field(default="", max_length=120)


class FecharRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    ano_mes: str = Field(max_length=7)


class PresencaRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    id_operador: int
    data: str = Field(max_length=10)
    status: str = Field(max_length=20)
    observacao: str = Field(default="", max_length=300)


class HoraExtraRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    id_operador: int
    data: str = Field(max_length=10)
    minutos: int = Field(ge=0, le=720)  # 0 remove o lançamento
    observacao: str = Field(default="", max_length=200)


class AtestadoRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    id_operador: int
    data_ini: str = Field(max_length=10)
    data_fim: str = Field(max_length=10)
    tipo: str = Field(max_length=30)
    # Sem campo de arquivo nem CID: dado de saúde, guardamos só período, tipo e validador.


class TrocaSolicitarRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    id_alvo: int
    data_a: str = Field(max_length=10)  # dia que o solicitante cede
    data_b: str = Field(default="", max_length=10)  # dia do colega que o solicitante assume (vazio = mesmo dia)
    motivo: str = Field(default="", max_length=300)


class TrocaResponderRequest(BaseSchema):
    aceitar: bool


class TrocaDecidirRequest(BaseSchema):
    aprovar: bool
    justificativa: str = Field(default="", max_length=400)


class TrocaDesfazerRequest(BaseSchema):
    justificativa: str = Field(max_length=400)


class PresencaLoteRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    data: str = Field(max_length=10)
    status: str = Field(max_length=20)
    excecoes: list[int] = Field(default_factory=list, max_length=500)  # operadores que NÃO recebem o status


class CapacidadePausasRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    pausas_simultaneas: int = Field(ge=1, le=200)


class PausaItemRequest(BaseSchema):
    ordem: int = Field(default=1, ge=1, le=6)
    tipo: str = Field(max_length=12)
    inicio: str = Field(max_length=5)
    duracao_min: int = Field(ge=1, le=120)


class PausasOperadorRequest(BaseSchema):
    id_operador: int
    pausas: list[PausaItemRequest] = Field(default_factory=list, max_length=6)


class SalvarPausasRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    data: str = Field(max_length=10)
    itens: list[PausasOperadorRequest] = Field(default_factory=list, max_length=500)


class DistribuirPausasRequest(BaseSchema):
    operacao: str = Field(max_length=60)
    data: str = Field(max_length=10)
    ids: list[int] | None = None  # None = todos os escalados do escopo
    sobrescrever: bool = False
    data_fim: str = Field(default="", max_length=10)  # preenchido: distribui de `data` até `data_fim` (semana/mês)
    dias_semana: list[int] | None = None  # 0 = segunda ... 6 = domingo; None = todos os dias do período

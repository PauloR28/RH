from __future__ import annotations

from typing import Any

from pydantic import Field

from .common import BaseSchema


class EquipeRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    nome: str = Field(default="", max_length=120)
    ativo: bool = True


class CatalogoRequest(BaseSchema):
    tipo: str = Field(default="", max_length=30)
    operacao: str = Field(default="", max_length=60)
    valor: str = Field(default="", max_length=120)
    ordem: int = 0
    ativo: bool = True


class UsuarioMonitoriaRequest(BaseSchema):
    nome: str = Field(default="", max_length=180)
    sobrenome: str = Field(default="", max_length=180)
    email: str = Field(default="", max_length=180)
    cargo: str = Field(default="", max_length=180)
    perfil: str = Field(default="", max_length=40)
    status: str | None = None
    provedor_autenticacao: str = "microsoft"
    senha: str = Field(default="", max_length=200)
    operacoes: list[str] | None = None
    supervisores: list[int] | None = None
    id_equipe: int | None = None
    turno: str | None = None
    canais: list[int] | None = None


class VinculosMonitoriaRequest(BaseSchema):
    operacoes: list[str] | None = None
    supervisores: list[int] | None = None
    id_equipe: int | None = None
    turno: str | None = None
    canais: list[int] | None = None


class AmbienteOperacaoRequest(BaseSchema):
    possui_qualidade: bool | None = None
    supervisores: list[int] | None = None
    qualidade: list[int] | None = None
    intranets: list[int] | None = None


class TransferirSupervisaoRequest(BaseSchema):
    operacao: str
    id_de: int
    id_para: int
    justificativa: str = Field(default="", max_length=400)


class TemaRequest(BaseSchema):
    operacao: str = ""


class MatrizConfigRequest(BaseSchema):
    config: dict[str, Any]
    observacao: str = Field(default="", max_length=400)


class MonitoriaCriarRequest(BaseSchema):
    operacao: str
    id_operador: int
    canal: str = Field(default="", max_length=120)
    tipo_atendimento: str = Field(default="", max_length=120)
    data_contato: str = ""
    telefone: str = Field(default="", max_length=40)
    id_interacao: str = Field(default="", max_length=120)
    respostas: dict[str, str] = {}
    pilares: dict[str, dict[str, int]] = {}
    motivo_ncg: str = ""
    justificativa_anulacao: str = ""
    observacao: str = ""
    sugestao_feedback: str = ""


class RascunhoRequest(BaseSchema):
    operacao: str
    payload: dict[str, Any] = {}


class FeedbackRequest(BaseSchema):
    observacao: str = Field(default="", max_length=4000)
    complemento: str = Field(default="", max_length=4000)


class ContestacaoRequest(BaseSchema):
    criterios: list[str] = []
    motivo: str = Field(default="", max_length=400)
    justificativa: str = Field(default="", max_length=4000)


class ReplicaRequest(BaseSchema):
    texto: str = Field(default="", max_length=4000)


class ReanaliseRequest(BaseSchema):
    resultado: str = ""
    observacao: str = Field(default="", max_length=4000)


class PlanoAcaoRequest(BaseSchema):
    id_monitoria: int | None = None
    operacao: str = ""
    id_operador: int = 0
    origem: str = Field(default="", max_length=120)
    id_responsavel: int | None = None
    problema: str = ""
    criterio: str = Field(default="", max_length=400)
    objetivo: str = ""
    acao: str = ""
    prazo: str = ""
    observacoes: str = ""


class PlanoAcaoRevisaoRequest(BaseSchema):
    status: str = ""
    data_revisao: str = ""
    resultado: str = ""
    observacoes: str = ""
    detalhe: str = ""


class CompartilharRequest(BaseSchema):
    destinatarios: list[int] = []
    ids: list[int] = []
    mensagem: str = Field(default="", max_length=1000)


class GuiaRequest(BaseSchema):
    titulo: str = Field(default="", max_length=180)
    conteudo: str = ""
    ordem: int = 0
    ativo: bool = True


class ConfigMonitoriaRequest(BaseSchema):
    limiar_alerta_pct: int | None = None


class IdentidadeOperacaoRequest(BaseSchema):
    cor_primaria: str = Field(default="", max_length=9)


class RiscoRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    confirmacao: str = Field(default="", max_length=60)
    justificativa: str = Field(default="", max_length=400)


class CalcularRequest(BaseSchema):
    operacao: str = Field(default="", max_length=60)
    respostas: dict[str, str] = {}

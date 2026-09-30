from __future__ import annotations

from typing import Any

from pydantic import Field, field_validator

from .common import BaseSchema

LOGIN_METHODS_CONECTA_PROVA = {"email", "celular", "codigo_prova"}


class GeneratedExamCreateRequest(BaseSchema):
    candidato_id: str = ""
    id_teste: str = ""
    id_registro: int | None = None
    id_entrevista: int | None = None
    nome_candidato: str
    email: str = ""
    telefone: str = ""
    whatsapp: str = ""
    cpf: str = ""
    id_processo: str = ""
    id_processo_ref: str = ""
    vaga: str
    cargo: str = ""
    area: str = ""
    area_prova: str = ""
    operacao: str = ""
    trilha: str = ""
    nivel: str = ""
    tempo_total: int = Field(default=40, ge=1, le=300)
    tempo_minutos: int = Field(default=0, ge=0, le=300)
    quantidade_questoes: int = Field(default=0, ge=0)
    etapas: list[dict[str, Any]] = Field(default_factory=list)
    categorias: list[str] = Field(default_factory=list)
    competencias: list[str] = Field(default_factory=list)
    questoes_snapshot: list[dict[str, Any]] = Field(default_factory=list)
    configuracao: dict[str, Any] = Field(default_factory=dict)
    personalizacao: dict[str, Any] = Field(default_factory=dict)
    perfil_vaga: str = ""
    tipo_avaliacao: str = ""
    observacoes_internas_rh: str = ""
    contexto_vaga: str = ""
    perfil_esperado: str = ""
    tom_prova: str = ""
    situacao_pratica_operacao: str = ""
    area_atuacao: str = ""
    instrucoes_especificas: str = ""
    instrucoes_operacao: str = ""
    expira_em: str = ""
    login_method: str = ""
    # Dia/horário em que o candidato deve vir fazer a prova; ocupa um horário no Calendário.
    agendada_para: str = ""
    agendada_duracao_min: int = Field(default=60, ge=15, le=480)

    @field_validator("login_method")
    @classmethod
    def validate_login_method(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if safe_value and safe_value not in LOGIN_METHODS_CONECTA_PROVA:
            raise ValueError("Forma de login do Conecta Prova inválida.")
        return safe_value


class PublicExamAccessRequest(BaseSchema):
    email: str = ""
    telefone: str = ""
    codigo: str = ""


class PublicExamTokenRequest(BaseSchema):
    token: str = Field(min_length=1, max_length=512)


class PublicResponseTelemetry(BaseSchema):
    questao_indice: int = Field(ge=0, le=10000)
    questao_id: str = Field(default="", max_length=180)
    etapa_chave: str = Field(default="", max_length=120)
    categoria_chave: str = Field(default="", max_length=120)
    primeiro_acesso_em: str = Field(default="", max_length=64)
    ultima_alteracao_em: str = Field(default="", max_length=64)
    tempo_ativo_segundos: float = Field(default=0, ge=0, le=86400)
    quantidade_alteracoes: int = Field(default=0, ge=0, le=100000)
    ordem_resposta: int | None = Field(default=None, ge=1, le=10000)
    tamanho_resposta_final: int = Field(default=0, ge=0, le=10000000)
    evento_colagem: bool = False
    quantidade_colagens: int = Field(default=0, ge=0, le=100000)
    tamanho_colagem_aproximado: int = Field(default=0, ge=0, le=10000000)


class PublicStageStartRequest(PublicExamTokenRequest):
    etapa_chave: str = Field(min_length=1, max_length=120)
    etapa_iniciada_em: str = Field(default="", max_length=64)
    questao_indice: int | None = Field(default=None, ge=0, le=10000)


class PublicCandidateDataRequest(PublicExamTokenRequest):
    nome_candidato: str
    email: str
    confirmar_email: str = ""
    telefone: str
    whatsapp: str = ""
    cep: str = ""
    endereco: str = ""
    numero: str = ""
    bairro: str = ""
    cidade: str = ""
    idade: int | None = Field(default=None, ge=14, le=100)
    escolaridade: str = ""


class PublicExamAnswersRequest(PublicExamTokenRequest):
    respostas: list[Any] = Field(default_factory=list)
    finalizar_mesmo_assim: bool = False
    etapa_chave: str = Field(default="", max_length=120)
    questao_indice: int | None = Field(default=None, ge=0, le=10000)
    etapa_iniciada_em: str = Field(default="", max_length=64)
    etapa_finalizada_em: str = Field(default="", max_length=64)
    tempo_ativo_etapa_segundos: float | None = Field(default=None, ge=0, le=86400)
    telemetria: list[PublicResponseTelemetry] = Field(default_factory=list, max_length=500)


class ManualEvaluationRequest(BaseSchema):
    nota_redacao: float | None = None
    nota_excel: float | None = None
    nota_tecnica: float | None = None
    nota_comunicacao: float | None = None
    nota_lgpd: float | None = None
    observacao: str = ""


class ReopenExamRequest(BaseSchema):
    motivo: str
    manter_respostas: bool = True


class CancelExamRequest(BaseSchema):
    motivo: str = ""


class DecisionRhRequest(BaseSchema):
    decisao: str
    justificativa: str = ""
    observacao: str = ""
    score_considerado: bool = True
    # Campos de aprovação (mesmo modal "Aprovar candidato" da Central), usados quando decisao = Aprovado.
    mensagem_aprovacao: str = ""
    data_comparecimento_aprovacao: str = ""
    documentos_aprovacao: list[str] = Field(default_factory=list)
    anexo_aprovacao_nome: str = ""
    anexo_aprovacao_tipo: str = ""
    anexo_aprovacao_tamanho: int = 0
    anexo_aprovacao_base64: str = ""

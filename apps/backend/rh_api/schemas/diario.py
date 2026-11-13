from __future__ import annotations

from typing import Any

from pydantic import Field

from .common import BaseSchema


class DiarioDemandaIn(BaseSchema):
    id_item: int
    inicio: Any = None  # vazio continua vazio (None); nunca vira 0
    fim: Any = None


class DiarioNsIn(BaseSchema):
    id_item: int
    valor: Any = None


class DiarioTurnoSalvarRequest(BaseSchema):
    versao: int
    demandas: list[DiarioDemandaIn] = Field(default_factory=list)
    ns: list[DiarioNsIn] = Field(default_factory=list)
    observacoes: str | None = None


class DiarioVersaoRequest(BaseSchema):
    versao: int


class DiarioMotivoRequest(BaseSchema):
    motivo: str = ""


class DiarioEditarRequest(BaseSchema):
    forcar: bool = False


class DiarioEncerramentoRequest(BaseSchema):
    versao: int
    encerramento_tipo: str | None = None
    passagem: str | None = None


class DiarioAbsRequest(BaseSchema):
    presentes: Any = None
    faltas: Any = None
    justificadas: Any = None
    folgas: Any = None
    ferias: Any = None
    motivo: str = ""


class DiarioIntercorrenciaRequest(BaseSchema):
    operacao: str = ""
    versao: int | None = None
    id_ferramenta: int | None = None
    canal: str = ""
    inicio: str = ""
    fim: str | None = None
    descricao: str = ""
    acao: str | None = None
    chamado: str | None = None


class DiarioParcialRequest(BaseSchema):
    hora: str = ""
    valores: dict[str, Any] = Field(default_factory=dict)


class DiarioEnvioRequest(BaseSchema):
    passo: str


class DiarioCadastroRequest(BaseSchema):
    operacao: str
    tipo: str
    nome: str
    ativo: bool = True
    ordem: int | None = None


class DiarioImportarRequest(BaseSchema):
    operacao: str
    arquivos: list[Any] = Field(default_factory=list)
    gravar: bool = False


class DiarioExportarRequest(BaseSchema):
    operacao: str
    ano_mes: str
    formato: str = "xlsx"

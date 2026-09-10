from __future__ import annotations

from pydantic import Field

from .common import BaseSchema


class UserCreateRequest(BaseSchema):
    nome: str = Field(default="")
    sobrenome: str = Field(default="")
    email: str = Field(default="")
    login: str = Field(default="")
    senha: str = Field(default="")
    perfil: str = Field(default="estagiario")
    cargo: str = Field(default="")
    status: str = Field(default="Ativo")
    provedor_autenticacao: str = Field(default="local")
    operacoes: list[str] = Field(default_factory=list)


class QuickTrainingUserCreateRequest(BaseSchema):
    """Botão "Criar usuário rápido" — nome, e-mail e senha, perfil fixo
    (Central de Treinamentos), sem atribuir treinamento."""

    nome: str = Field(default="")
    email: str = Field(default="")
    senha: str = Field(default="")


class UserUpdateRequest(BaseSchema):
    nome: str = Field(default="")
    sobrenome: str = Field(default="")
    email: str = Field(default="")
    login: str = Field(default="")
    perfil: str = Field(default="")
    cargo: str = Field(default="")
    status: str = Field(default="")
    provedor_autenticacao: str = Field(default="")
    operacoes: list[str] | None = Field(default=None)
    justificativa: str = Field(default="")


class UserPasswordRequest(BaseSchema):
    senha: str = Field(default="")
    justificativa: str = Field(default="")


class UserStatusRequest(BaseSchema):
    acao: str = Field(default="")
    justificativa: str = Field(default="")


class RolePermissionsUpdateRequest(BaseSchema):
    permissoes: list[str] = Field(default_factory=list)
    justificativa: str = Field(default="")


class ConfigurationItemRequest(BaseSchema):
    chave: str = Field(default="")
    nome: str = Field(default="")
    descricao: str = Field(default="")
    categoria: str = Field(default="")
    payload: dict = Field(default_factory=dict)
    ativo: bool = True
    justificativa: str = Field(default="")


class LgpdRequestCreate(BaseSchema):
    tipo_solicitacao: str = Field(default="")
    titular: str = Field(default="")
    email: str = Field(default="")
    descricao: str = Field(default="")


class NotificationAutomationSettingsRequest(BaseSchema):
    """Liga/desliga a automação de e-mail por etapa (roadmap: e-mails
    automáticos por etapa) e a automação de lembretes/alertas periódicos
    (roadmap: lembretes e alertas automáticos). Ambos default desligado — o
    RH precisa optar por ativar cada automação explicitamente."""

    email_automatico_ativo: bool = False
    lembretes_automaticos_ativos: bool = False

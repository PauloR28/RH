from __future__ import annotations

import re

from pydantic import Field, field_validator, model_validator

from .common import BaseSchema

_AVATAR_ILUSTRADO_PATTERN = re.compile(r"^avatar-(0[1-9]|[12]\d|3\d|40)$")


class LoginRequest(BaseSchema):
    usuario: str = Field(default="")
    senha: str = Field(default="")
    mfa_code: str = Field(default="", max_length=12)


class AppEmailLoginRequest(BaseSchema):
    """Correções.txt (rodada 16/set/2026): login do app-treinamento-
    colaborador — só e-mail, sem senha (ver routers/auth.py, login_app_email
    / repositories/security.py, authenticate_app_email)."""

    email: str = Field(default="", max_length=200)


class E2ETestLoginRequest(BaseSchema):
    """Achado QA-001/S-23: bypass de autenticação restrito à suíte E2E, nunca
    disponível em produção — ver routers/auth.py (`e2e_test_login`)."""

    secret: str = Field(default="", max_length=200)
    usuario: str = Field(default="e2e.teste", max_length=120)
    perfil: str = Field(default="administrador", max_length=40)


class MfaCodeRequest(BaseSchema):
    code: str = Field(min_length=6, max_length=12)


class MfaSetupResponse(BaseSchema):
    secret: str
    provisioning_uri: str
    message: str = "Escaneie o QR code e confirme um código antes de ativar o MFA."


class LoginResponse(BaseSchema):
    access_token: str
    token_type: str = "bearer"
    usuario: str
    nome: str = ""
    sobrenome: str = ""
    cargo: str = ""
    email: str = ""
    perfil: str = "administrador"
    perfil_nome: str = "Administrador"
    nivel: str = "Completo"
    permissoes: list[str] = []
    avatar_ilustrado: str = ""
    provedor_autenticacao: str = ""


class SessionResponse(BaseSchema):
    authenticated: bool = True
    usuario: str
    nome: str = ""
    sobrenome: str = ""
    cargo: str = ""
    email: str = ""
    perfil: str = "administrador"
    perfil_nome: str = "Administrador"
    nivel: str = "Completo"
    permissoes: list[str] = []
    avatar_ilustrado: str = ""
    provedor_autenticacao: str = ""
    access_token: str = ""


class UpdateAvatarRequest(BaseSchema):
    avatar_ilustrado: str = Field(default="")

    @field_validator("avatar_ilustrado")
    @classmethod
    def validate_avatar(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if safe_value and not _AVATAR_ILUSTRADO_PATTERN.fullmatch(safe_value):
            raise ValueError("Avatar inválido.")
        return safe_value


class UpdateNameRequest(BaseSchema):
    nome: str = Field(default="")

    @field_validator("nome")
    @classmethod
    def validate_nome(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not (2 <= len(safe_value) <= 120):
            raise ValueError("Informe um nome entre 2 e 120 caracteres.")
        return safe_value


class UpdateOwnPasswordRequest(BaseSchema):
    senha_atual: str = Field(default="")
    nova_senha: str = Field(default="")

    @field_validator("nova_senha")
    @classmethod
    def validate_nova_senha(cls, value: str) -> str:
        safe_value = str(value or "")
        if len(safe_value) < 8:
            raise ValueError("A nova senha deve ter pelo menos 8 caracteres.")
        return safe_value


class UpdateSurnameRequest(BaseSchema):
    sobrenome: str = Field(default="", max_length=180)


class UpdateCargoRequest(BaseSchema):
    cargo: str = Field(default="", max_length=180)


class RequestEmailChangeRequest(BaseSchema):
    email_novo: str = Field(default="")

    @field_validator("email_novo")
    @classmethod
    def validate_email_novo(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", safe_value):
            raise ValueError("Informe um e-mail válido.")
        return safe_value


class DecideEmailChangeRequest(BaseSchema):
    motivo: str = Field(default="", max_length=500)


class ActivateLocalLoginRequest(BaseSchema):
    nova_senha: str = Field(default="")
    confirmar_senha: str = Field(default="")

    @field_validator("nova_senha")
    @classmethod
    def validate_nova_senha(cls, value: str) -> str:
        safe_value = str(value or "")
        if len(safe_value) < 8:
            raise ValueError("A nova senha deve ter pelo menos 8 caracteres.")
        return safe_value

    @model_validator(mode="after")
    def validate_confirmacao(self):
        if self.nova_senha != self.confirmar_senha:
            raise ValueError("A confirmação não corresponde à nova senha.")
        return self


class UpdateAuthProviderRequest(BaseSchema):
    provedor: str = Field(default="")

    @field_validator("provedor")
    @classmethod
    def validate_provedor(cls, value: str) -> str:
        safe_value = str(value or "").strip().lower()
        if safe_value not in {"local", "microsoft"}:
            raise ValueError("Tipo de acesso inválido.")
        return safe_value

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from conecta.infrastructure.security.token_denylist import InMemoryTokenDenylist

from .config import get_settings
from .rbac import ROLE_ADMIN, get_role_definition, get_role_permissions, sanitize_permissions
from .services.helpers import normalize_text


logger = logging.getLogger(__name__)

_token_denylist = InMemoryTokenDenylist()


def _token_key(token: str) -> str:
    return hashlib.sha256(normalize_text(token).encode("utf-8")).hexdigest()


def revoke_access_token(token: str) -> None:
    """Revoga um token no logout — não afeta a assinatura/emissão de novos tokens,
    só passa a rejeitar este token específico nas próximas requisições."""
    safe_token = normalize_text(token)
    if not safe_token or "." not in safe_token:
        return
    payload, _ = safe_token.split(".", 1)
    try:
        data = json.loads(_b64decode(payload).decode("utf-8"))
        expires_at = int(data.get("exp") or 0)
    except Exception:
        return
    ttl_seconds = expires_at - int(datetime.now(timezone.utc).timestamp())
    _token_denylist.revoke(_token_key(safe_token), ttl_seconds)


@dataclass(frozen=True)
class AuthenticatedUser:
    username: str
    id_usuario: int | None = None
    nome: str = ""
    sobrenome: str = ""
    cargo: str = ""
    email: str = ""
    perfil: str = ROLE_ADMIN
    perfil_nome: str = "Administrador"
    nivel: str = "Completo"
    permissions: frozenset[str] = field(default_factory=lambda: frozenset(get_role_permissions(ROLE_ADMIN)))
    status: str = "Ativo"
    avatar_ilustrado: str = ""
    provedor_autenticacao: str = ""
    # Achado SEC-002: escopo de operação, aditivo. Vazio == sem restrição
    # (comportamento de hoje, preservado para todo usuário existente) — só
    # passa a restringir quando alguém atribuir operações a este usuário em
    # dbo.usuarios_operacoes.
    operacoes: frozenset[str] = field(default_factory=frozenset)
    # Vertente Monitoria: senha definida pelo criador do usuário; até trocá-la
    # no primeiro acesso, nenhuma rota (fora /auth/*) é liberada.
    deve_trocar_senha: bool = False

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions

    def has_any_permission(self, *permissions: str) -> bool:
        return any(permission in self.permissions for permission in permissions)

    def allows_operacao(self, operacao: str | None) -> bool:
        """True se o usuário pode acessar um recurso desta operação.

        Sem escopo atribuído (`operacoes` vazio) = sem restrição. Recurso sem
        operação identificável (`operacao` vazio/None) = nada a restringir
        (ex.: recurso global, não pertence a nenhuma operação específica)."""
        if not self.operacoes:
            return True
        if not operacao:
            return True
        return operacao in self.operacoes


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def _sign(payload: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return _b64encode(digest)


def _build_user_payload(user: AuthenticatedUser) -> dict:
    return {
        "sub": user.username,
        "uid": user.id_usuario,
        "name": user.nome,
        "sobrenome": user.sobrenome,
        "cargo": user.cargo,
        "email": user.email,
        "role": user.perfil,
        "role_name": user.perfil_nome,
        "level": user.nivel,
        "permissions": sorted(user.permissions),
        "status": user.status,
        "avatar": user.avatar_ilustrado,
        "provedor_autenticacao": user.provedor_autenticacao,
        "operacoes": sorted(user.operacoes),
        "pwd": bool(user.deve_trocar_senha),
    }


def _build_token(user: AuthenticatedUser) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.auth_token_ttl_minutes)
    token_payload = {
        **_build_user_payload(user),
        "exp": int(expires_at.timestamp()),
    }
    payload = _b64encode(
        json.dumps(
            token_payload,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    return f"{payload}.{_sign(payload, settings.auth_token_secret)}"


def reissue_token(user: AuthenticatedUser) -> str:
    # O token carrega os dados do usuário em si (sem consulta ao banco a cada
    # requisição), então mudanças de perfil (ex.: avatar) exigem reemissão.
    return _build_token(user)


def _build_env_admin_user(usuario: str | None = None) -> AuthenticatedUser:
    settings = get_settings()
    safe_user = normalize_text(usuario) or settings.auth_user
    role = get_role_definition(ROLE_ADMIN)
    return AuthenticatedUser(
        username=safe_user,
        nome=safe_user,
        email=safe_user,
        perfil=role.id,
        perfil_nome=role.name,
        nivel=role.level,
        permissions=frozenset(get_role_permissions(role.id)),
        status="Ativo",
    )


def _user_from_record(record: dict | None) -> AuthenticatedUser:
    safe_record = record or {}
    role = get_role_definition(safe_record.get("perfil") or safe_record.get("perfil_id") or ROLE_ADMIN)
    permissions = sanitize_permissions(safe_record.get("permissoes") or safe_record.get("permissions"))
    if not permissions:
        permissions = get_role_permissions(role.id)
    return AuthenticatedUser(
        username=normalize_text(safe_record.get("login") or safe_record.get("usuario") or safe_record.get("email")),
        id_usuario=safe_record.get("id_usuario"),
        nome=normalize_text(safe_record.get("nome")) or normalize_text(safe_record.get("login")),
        sobrenome=normalize_text(safe_record.get("sobrenome")),
        cargo=normalize_text(safe_record.get("cargo")),
        email=normalize_text(safe_record.get("email")),
        perfil=role.id,
        perfil_nome=normalize_text(safe_record.get("perfil_nome")) or role.name,
        nivel=normalize_text(safe_record.get("nivel")) or role.level,
        permissions=frozenset(permissions),
        status=normalize_text(safe_record.get("status")) or "Ativo",
        avatar_ilustrado=normalize_text(safe_record.get("avatar_ilustrado")),
        provedor_autenticacao=normalize_text(safe_record.get("provedor_autenticacao")),
        operacoes=frozenset(
            normalize_text(item) for item in (safe_record.get("operacoes") or []) if normalize_text(item)
        ),
        deve_trocar_senha=bool(safe_record.get("deve_trocar_senha")),
    )


def create_session_for_user_record(record: dict | None) -> tuple[str, AuthenticatedUser]:
    """Emite a sessão bearer atual do Conecta para um usuário já autorizado."""
    user = _user_from_record(record)
    if normalize_text(user.status).lower() != "ativo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seu acesso ao Conecta está desativado.",
        )
    return _build_token(user), user


def authenticate_credentials(usuario: str, senha: str) -> str:
    settings = get_settings()
    safe_user = normalize_text(usuario)
    if (
        not settings.auth_password
        or safe_user != settings.auth_user
        or senha != settings.auth_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha inválidos.",
        )

    return _build_token(_build_env_admin_user(safe_user))


def authenticate_session(
    usuario: str,
    senha: str,
    *,
    repository=None,
    origem: str = "",
    mfa_code: str = "",
) -> tuple[str, AuthenticatedUser]:
    safe_user = normalize_text(usuario)
    if repository is not None:
        try:
            record = repository.authenticate_system_user(
                safe_user,
                senha,
                origem=origem,
                mfa_code=mfa_code,
            )
            return create_session_for_user_record(record)
        except HTTPException:
            settings = get_settings()
            if (
                not settings.auth_password
                or safe_user != settings.auth_user
                or senha != settings.auth_password
            ):
                raise
        except Exception as exc:
            # Fallback intencional para manter compatibilidade quando o banco ainda
            # não possui as tabelas novas ou está indisponível durante manutenção.
            logger.debug("Autenticação via repositório falhou, usando fallback de credenciais de ambiente: %s", exc)

    token = authenticate_credentials(safe_user, senha)
    return token, _build_env_admin_user(safe_user)


def validate_access_token(token: str) -> AuthenticatedUser:
    settings = get_settings()
    try:
        payload, signature = normalize_text(token).split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.") from exc

    expected_signature = _sign(payload, settings.auth_token_secret)
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.")

    if _token_denylist.is_revoked(_token_key(normalize_text(token))):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão encerrada. Faça login novamente.")

    try:
        data = json.loads(_b64decode(payload).decode("utf-8"))
        username = normalize_text(data.get("sub"))
        expires_at = int(data.get("exp") or 0)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.") from exc

    if not username or expires_at < int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada.")

    role = get_role_definition(data.get("role") or data.get("perfil") or ROLE_ADMIN)
    permissions = sanitize_permissions(data.get("permissions") or data.get("permissoes"))
    if not permissions:
        permissions = get_role_permissions(role.id)

    return AuthenticatedUser(
        username=username,
        id_usuario=data.get("uid"),
        nome=normalize_text(data.get("name")) or username,
        sobrenome=normalize_text(data.get("sobrenome")),
        cargo=normalize_text(data.get("cargo")),
        email=normalize_text(data.get("email")),
        perfil=role.id,
        perfil_nome=normalize_text(data.get("role_name")) or role.name,
        nivel=normalize_text(data.get("level")) or role.level,
        permissions=frozenset(permissions),
        status=normalize_text(data.get("status")) or "Ativo",
        avatar_ilustrado=normalize_text(data.get("avatar")),
        provedor_autenticacao=normalize_text(data.get("provedor_autenticacao")),
        operacoes=frozenset(
            normalize_text(item) for item in (data.get("operacoes") or []) if normalize_text(item)
        ),
        deve_trocar_senha=bool(data.get("pwd")),
    )

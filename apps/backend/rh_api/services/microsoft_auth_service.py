from __future__ import annotations

from urllib.parse import urlparse

import msal

from ..config import Settings, get_settings


MICROSOFT_SCOPES = ("User.Read",)
_DISALLOWED_TENANTS = {"common", "organizations", "consumers"}


class MicrosoftAuthConfigurationError(RuntimeError):
    """Configuração ausente ou insegura para iniciar o login Microsoft."""


def validate_microsoft_auth_configuration(settings: Settings) -> None:
    required_values = {
        "MICROSOFT_CLIENT_ID": settings.microsoft_client_id,
        "MICROSOFT_TENANT_ID": settings.microsoft_tenant_id,
        "MICROSOFT_CLIENT_SECRET": settings.microsoft_client_secret,
        "MICROSOFT_AUTHORITY": settings.microsoft_authority,
        "MICROSOFT_REDIRECT_URI": settings.microsoft_redirect_uri,
    }
    missing = [name for name, value in required_values.items() if not str(value or "").strip()]
    if missing:
        raise MicrosoftAuthConfigurationError(
            "Autenticação Microsoft não configurada. Variáveis ausentes: "
            + ", ".join(missing)
            + "."
        )

    tenant_id = settings.microsoft_tenant_id.strip()
    if tenant_id.lower() in _DISALLOWED_TENANTS:
        raise MicrosoftAuthConfigurationError(
            "MICROSOFT_TENANT_ID deve identificar especificamente o tenant da organização."
        )

    expected_authority = f"https://login.microsoftonline.com/{tenant_id}"
    if settings.microsoft_authority.rstrip("/").lower() != expected_authority.lower():
        raise MicrosoftAuthConfigurationError(
            "MICROSOFT_AUTHORITY deve usar o MICROSOFT_TENANT_ID configurado."
        )

    redirect_uri = urlparse(settings.microsoft_redirect_uri)
    if redirect_uri.scheme not in {"http", "https"} or not redirect_uri.netloc:
        raise MicrosoftAuthConfigurationError("MICROSOFT_REDIRECT_URI é inválida.")

    if tuple(settings.microsoft_scopes) != MICROSOFT_SCOPES:
        raise MicrosoftAuthConfigurationError(
            "A autenticação Microsoft deve usar somente o escopo mínimo User.Read."
        )


# O MSAL consulta a Microsoft (descoberta de autoridade) ao criar o cliente: refazer isso a cada login/callback
# custava segundos em rede lenta. O cliente é reutilizável; o fluxo de cada usuário vive na sessão, não nele.
_microsoft_clients: dict[tuple[str, str, str], msal.ConfidentialClientApplication] = {}


def create_microsoft_client(
    settings: Settings | None = None,
) -> msal.ConfidentialClientApplication:
    resolved_settings = settings or get_settings()
    validate_microsoft_auth_configuration(resolved_settings)
    chave = (
        resolved_settings.microsoft_client_id,
        resolved_settings.microsoft_authority,
        resolved_settings.microsoft_client_secret,
    )
    cliente = _microsoft_clients.get(chave)
    if cliente is None:
        cliente = msal.ConfidentialClientApplication(
            client_id=resolved_settings.microsoft_client_id,
            authority=resolved_settings.microsoft_authority,
            client_credential=resolved_settings.microsoft_client_secret,
        )
        _microsoft_clients[chave] = cliente
    return cliente

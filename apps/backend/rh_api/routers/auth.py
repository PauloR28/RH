from __future__ import annotations

import hmac
import logging
import re
from dataclasses import replace
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from ..auth import (
    AuthenticatedUser,
    authenticate_session,
    create_session_for_user_record,
    reissue_token,
    revoke_access_token,
)
from ..dependencies import audit_action, get_current_user, get_repository
from ..rbac import get_role_definition, get_role_permissions
from ..repositories import DatabaseRepository
from ..schemas.auth import (
    ActivateLocalLoginRequest,
    AppEmailLoginRequest,
    E2ETestLoginRequest,
    LoginRequest,
    LoginResponse,
    MfaCodeRequest,
    MfaSetupResponse,
    RequestEmailChangeRequest,
    SessionResponse,
    UpdateAuthProviderRequest,
    UpdateAvatarRequest,
    UpdateCargoRequest,
    UpdateNameRequest,
    UpdateOwnPasswordRequest,
    UpdateSurnameRequest,
)
from ..schemas.common import SuccessResponse
from ..config import get_settings
from ..services.microsoft_auth_service import (
    MicrosoftAuthConfigurationError,
    create_microsoft_client,
)
from conecta.infrastructure.security.rate_limit import InMemoryRateLimiter


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
login_limiter = InMemoryRateLimiter()
MICROSOFT_FLOW_SESSION_KEY = "microsoft_auth_flow"
MICROSOFT_USER_SESSION_KEY = "microsoft_user_id"
MICROSOFT_ERROR_SESSION_KEY = "microsoft_auth_error"
MICROSOFT_PROVIDER_SESSION_KEY = "auth_provider"
MICROSOFT_LOGIN_RESULT_URL = "/login?microsoft=complete"
_SENSITIVE_LOG_PARAMETER = re.compile(
    r"(?i)\b(access_token|id_token|refresh_token|client_secret|password|pwd|code)\s*=\s*([^&;\s]+)"
)
_URL_WITH_QUERY = re.compile(r"(https?://[^\s?]+)\?[^\s]+", re.IGNORECASE)
_MSAL_ERROR_DIAGNOSIS = {
    "70002": "Credenciais do aplicativo inválidas.",
    "7000215": "Client Secret inválido.",
    "700016": "Client ID incorreto ou aplicativo não encontrado no tenant.",
    "50011": "URI de redirecionamento diferente da cadastrada.",
    "65001": "Consentimento não concedido.",
    "90094": "Consentimento de administrador necessário.",
    "53003": "Acesso bloqueado por política de Acesso Condicional.",
}


def _sanitize_microsoft_log_value(value, *, limit: int = 500) -> str:
    text = re.sub(r"[\r\n\t]+", " ", str(value or "")).strip()
    text = _SENSITIVE_LOG_PARAMETER.sub(r"\1=[REDACTED]", text)
    text = _URL_WITH_QUERY.sub(r"\1?[REDACTED]", text)
    return text[:limit]


def _normalize_msal_error_codes(value) -> tuple[str, ...]:
    raw_codes = value if isinstance(value, (list, tuple, set)) else [value]
    codes = []
    for raw_code in raw_codes:
        safe_code = re.sub(r"[^A-Za-z0-9_-]", "", str(raw_code or ""))[:32]
        if safe_code:
            codes.append(safe_code)
        if len(codes) >= 10:
            break
    return tuple(codes)


def _diagnose_msal_error(error: str, error_codes: tuple[str, ...]) -> str:
    if error.lower() == "access_denied":
        return "Usuário cancelou ou recusou o login."
    for error_code in error_codes:
        normalized_code = error_code.upper().removeprefix("AADSTS")
        if normalized_code in _MSAL_ERROR_DIAGNOSIS:
            return _MSAL_ERROR_DIAGNOSIS[normalized_code]
    if error.lower() == "invalid_client":
        return "Credencial do aplicativo rejeitada pela Microsoft."
    return "Erro Microsoft não classificado."


def _log_msal_error(result: dict) -> tuple[str, tuple[str, ...]]:
    error = _sanitize_microsoft_log_value(result.get("error"), limit=80) or "resultado_invalido"
    error_codes = _normalize_msal_error_codes(result.get("error_codes"))
    logger.error(
        (
            "Falha na autenticação Microsoft: error=%s | error_codes=%s | "
            "correlation_id=%s | trace_id=%s | description=%s | diagnostico=%s"
        ),
        error,
        error_codes,
        _sanitize_microsoft_log_value(result.get("correlation_id"), limit=120),
        _sanitize_microsoft_log_value(result.get("trace_id"), limit=120),
        _sanitize_microsoft_log_value(result.get("error_description")),
        _diagnose_msal_error(error, error_codes),
    )
    return error, error_codes


def _request_origin(request: Request | None) -> str:
    if request and request.client:
        return request.client.host
    return ""


def _audit_microsoft_event(
    repository,
    *,
    action: str,
    request: Request | None,
    success: bool,
    user=None,
    entity_id: str = "",
    reason: str = "",
) -> None:
    if not hasattr(repository, "record_audit_log"):
        return
    try:
        repository.record_audit_log(
            user=user,
            modulo="Autenticação",
            acao=action,
            entidade="usuario",
            entidade_id=entity_id,
            justificativa=reason,
            origem=_request_origin(request),
            sucesso=success,
        )
    except Exception:
        return


def _redirect_microsoft_result(request: Request, message: str = "") -> RedirectResponse:
    if message:
        request.session[MICROSOFT_ERROR_SESSION_KEY] = message
    return RedirectResponse(MICROSOFT_LOGIN_RESULT_URL, status_code=status.HTTP_302_FOUND)


def _build_login_response(token: str, user: AuthenticatedUser) -> LoginResponse:
    return LoginResponse(
        access_token=token,
        usuario=user.username,
        nome=user.nome,
        sobrenome=user.sobrenome,
        cargo=user.cargo,
        email=user.email,
        perfil=user.perfil,
        perfil_nome=user.perfil_nome,
        nivel=user.nivel,
        permissoes=sorted(user.permissions),
        avatar_ilustrado=user.avatar_ilustrado,
        provedor_autenticacao=user.provedor_autenticacao,
    )


# Correções.txt (rodada 16/set/2026): "o Operador não terá acesso a
# plataforma web, somente ao aplicativo" — bloqueia depois de autenticado
# (não antes) para não vazar, por diferença de mensagem, se um login/e-mail
# existe ou não.
_PERFIS_SEM_ACESSO_WEB = {"operador"}


def _bloquear_perfil_sem_acesso_web(user: AuthenticatedUser) -> None:
    if user.perfil in _PERFIS_SEM_ACESSO_WEB:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este perfil acessa só pelo aplicativo Conecta, não pela plataforma web.",
        )


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    request: Request = None,
    repository: DatabaseRepository = Depends(get_repository),
) -> LoginResponse:
    origem = request.client.host if request and request.client else ""
    settings = get_settings()
    limiter_key = f"{origem}:{payload.usuario.strip().lower()}"
    if request is not None and not login_limiter.allow(
        limiter_key,
        limit=settings.auth_login_rate_limit,
        window_seconds=settings.auth_login_rate_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de login. Aguarde e tente novamente.",
        )
    token, user = authenticate_session(
        payload.usuario,
        payload.senha,
        repository=repository,
        origem=origem,
        mfa_code=payload.mfa_code,
    )
    _bloquear_perfil_sem_acesso_web(user)
    login_limiter.reset(limiter_key)
    return _build_login_response(token, user)


@router.post("/app/login-email", response_model=LoginResponse)
def login_app_email(
    payload: AppEmailLoginRequest,
    request: Request = None,
    repository: DatabaseRepository = Depends(get_repository),
) -> LoginResponse:
    """Correções.txt (rodada 16/set/2026): login do app-treinamento-
    colaborador — só e-mail, sem senha, restrito a perfis operador/
    funcionario (ver repositories/security.py, authenticate_app_email)."""
    origem = request.client.host if request and request.client else ""
    settings = get_settings()
    limiter_key = f"app-email:{origem}:{payload.email.strip().lower()}"
    if request is not None and not login_limiter.allow(
        limiter_key,
        limit=settings.auth_login_rate_limit,
        window_seconds=settings.auth_login_rate_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de login. Aguarde e tente novamente.",
        )
    record = repository.authenticate_app_email(payload.email, origem=origem)
    token, user = create_session_for_user_record(record)
    login_limiter.reset(limiter_key)
    return _build_login_response(token, user)


@router.post("/e2e-login", response_model=LoginResponse, include_in_schema=False)
def e2e_test_login(payload: E2ETestLoginRequest) -> LoginResponse:
    """Achado QA-001/S-23: bypass de autenticação exclusivo para a suíte E2E
    (Playwright, `tests-e2e/fixtures/auth.js`). Nunca disponível em produção
    e desabilitado por padrão em qualquer ambiente — só responde se AMBAS as
    condições forem verdadeiras:

    1. `RH_APP_ENV` não é produção (`settings.is_production`);
    2. `RH_E2E_TEST_LOGIN_SECRET` foi definido explicitamente (vazio por
       padrão) e o `secret` enviado bate com ele.

    Sem as duas condições, responde 404 — não 403 — para não revelar nem a
    existência da rota em ambiente onde ela deve estar inerte.
    """
    settings = get_settings()
    configured_secret = settings.e2e_test_login_secret
    if settings.is_production or not configured_secret or not hmac.compare_digest(
        payload.secret, configured_secret
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Não encontrado.")

    role = get_role_definition(payload.perfil)
    user = AuthenticatedUser(
        username=payload.usuario or "e2e.teste",
        nome="Usuário de teste E2E",
        email=f"{payload.usuario or 'e2e.teste'}@e2e.invalid",
        perfil=role.id,
        perfil_nome=role.name,
        nivel=role.level,
        permissions=frozenset(get_role_permissions(role.id)),
        status="Ativo",
    )
    token = reissue_token(user)
    logger.warning(
        "Login de teste E2E emitido (ambiente=%s, usuario=%s, perfil=%s) — só deve acontecer em dev/hml/CI.",
        settings.app_env,
        user.username,
        user.perfil,
    )
    return _build_login_response(token, user)


@router.get("/microsoft/login", include_in_schema=False)
def microsoft_login(
    request: Request,
    repository: DatabaseRepository = Depends(get_repository),
):
    settings = get_settings()
    callback_url = urlparse(settings.microsoft_redirect_uri)
    request_host = str(request.url.hostname or "").strip().lower()
    callback_host = str(callback_url.hostname or "").strip().lower()
    if (
        settings.is_development
        and request_host == "127.0.0.1"
        and callback_host == "localhost"
    ):
        canonical_login_url = (
            f"{callback_url.scheme}://{callback_url.netloc}/auth/microsoft/login"
        )
        logger.info(
            "Normalizando origem do login Microsoft para o host do callback configurado."
        )
        return RedirectResponse(canonical_login_url, status_code=status.HTTP_302_FOUND)

    request.session.pop(MICROSOFT_FLOW_SESSION_KEY, None)
    request.session.pop(MICROSOFT_USER_SESSION_KEY, None)
    request.session.pop(MICROSOFT_ERROR_SESSION_KEY, None)
    try:
        logger.info(
            (
                "Configuração Microsoft carregada: client_id_presente=%s | "
                "tenant_id_presente=%s | client_secret_presente=%s | "
                "authority_presente=%s | redirect_uri=%s"
            ),
            bool(settings.microsoft_client_id),
            bool(settings.microsoft_tenant_id),
            bool(settings.microsoft_client_secret),
            bool(settings.microsoft_authority),
            settings.microsoft_redirect_uri,
        )
        client = create_microsoft_client(settings)
        flow = client.initiate_auth_code_flow(
            scopes=list(settings.microsoft_scopes),
            redirect_uri=settings.microsoft_redirect_uri,
        )
        if not isinstance(flow, dict) or not flow.get("auth_uri"):
            raise RuntimeError("Fluxo MSAL sem URL de autorização.")
        request.session[MICROSOFT_FLOW_SESSION_KEY] = flow
        logger.info(
            "Login Microsoft iniciado: flow_salvo=%s | host=%s | scheme=%s",
            MICROSOFT_FLOW_SESSION_KEY in request.session,
            request.url.netloc,
            request.url.scheme,
        )
        _audit_microsoft_event(
            repository,
            action="login_microsoft_iniciado",
            request=request,
            success=True,
        )
        return RedirectResponse(flow["auth_uri"], status_code=status.HTTP_302_FOUND)
    except MicrosoftAuthConfigurationError as exc:
        logger.warning("Login Microsoft indisponível por configuração: %s", exc)
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Configuração Microsoft incompleta ou inválida.",
        )
        return _redirect_microsoft_result(
            request,
            "O login Microsoft ainda não está configurado neste ambiente.",
        )
    except Exception as exc:
        logger.error(
            "Falha ao iniciar login Microsoft (%s).",
            type(exc).__name__,
        )
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Falha ao iniciar o fluxo MSAL.",
        )
        return _redirect_microsoft_result(
            request,
            "A autenticação Microsoft não foi concluída.",
        )


@router.get("/microsoft/callback", include_in_schema=False)
def microsoft_callback(
    request: Request,
    repository: DatabaseRepository = Depends(get_repository),
):
    flow = request.session.get(MICROSOFT_FLOW_SESSION_KEY)
    logger.info(
        "Callback Microsoft recebido: flow_encontrado=%s | host=%s | scheme=%s",
        isinstance(flow, dict),
        request.url.netloc,
        request.url.scheme,
    )
    if not isinstance(flow, dict):
        _audit_microsoft_event(
            repository,
            action="login_microsoft_fluxo_expirado",
            request=request,
            success=False,
            reason="Fluxo Microsoft ausente ou expirado.",
        )
        return _redirect_microsoft_result(
            request,
            "O fluxo de autenticação expirou. Tente novamente.",
        )

    settings = get_settings()
    try:
        client = create_microsoft_client(settings)
        result = client.acquire_token_by_auth_code_flow(
            flow,
            dict(request.query_params),
        )
    except ValueError:
        request.session.pop(MICROSOFT_FLOW_SESSION_KEY, None)
        logger.warning("Retorno Microsoft recusado por state, nonce ou código inválido.")
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Retorno MSAL inválido.",
        )
        return _redirect_microsoft_result(
            request,
            "Não foi possível validar o retorno da Microsoft.",
        )
    except Exception as exc:
        request.session.pop(MICROSOFT_FLOW_SESSION_KEY, None)
        logger.error(
            "Falha técnica no callback Microsoft: tipo=%s | detalhe=%s",
            type(exc).__name__,
            _sanitize_microsoft_log_value(exc),
        )
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Falha técnica no callback MSAL.",
        )
        return _redirect_microsoft_result(
            request,
            "A autenticação Microsoft não foi concluída.",
        )

    request.session.pop(MICROSOFT_FLOW_SESSION_KEY, None)

    if not isinstance(result, dict) or result.get("error"):
        safe_result = result if isinstance(result, dict) else {"error": "resultado_invalido"}
        error_code, error_codes = _log_msal_error(safe_result)
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason=(
                f"MSAL retornou erro {error_code}; "
                f"códigos={','.join(error_codes) or 'ausentes'}."
            ),
        )
        return _redirect_microsoft_result(
            request,
            "O login Microsoft foi cancelado."
            if error_code.lower() == "access_denied"
            else "A autenticação Microsoft não foi concluída.",
        )

    claims = result.get("id_token_claims")
    if not isinstance(claims, dict):
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Retorno Microsoft sem claims de identidade.",
        )
        return _redirect_microsoft_result(
            request,
            "Não foi possível identificar sua conta Microsoft.",
        )

    microsoft_oid = str(claims.get("oid") or "").strip()
    microsoft_tenant_id = str(claims.get("tid") or "").strip()
    if not microsoft_oid or not microsoft_tenant_id:
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Retorno Microsoft sem OID ou tenant.",
        )
        return _redirect_microsoft_result(
            request,
            "Não foi possível identificar sua conta Microsoft.",
        )
    if not hmac.compare_digest(
        microsoft_tenant_id.lower(),
        settings.microsoft_tenant_id.strip().lower(),
    ):
        logger.warning("Login Microsoft recusado por tenant diferente do configurado.")
        _audit_microsoft_event(
            repository,
            action="login_microsoft_tenant_negado",
            request=request,
            success=False,
            reason="Tenant diferente do tenant autorizado.",
        )
        return _redirect_microsoft_result(
            request,
            "Esta conta não pertence à organização autorizada.",
        )

    email = str(claims.get("email") or claims.get("preferred_username") or "").strip()
    name = str(claims.get("name") or "").strip()
    try:
        user_record = repository.authenticate_microsoft_user(
            microsoft_oid=microsoft_oid,
            microsoft_tenant_id=microsoft_tenant_id,
            email=email,
            nome=name,
            origem=_request_origin(request),
        )
    except HTTPException as exc:
        return _redirect_microsoft_result(request, str(exc.detail))
    except Exception as exc:
        logger.error(
            "Falha ao autorizar usuário Microsoft no Conecta: tipo=%s | detalhe=%s",
            type(exc).__name__,
            _sanitize_microsoft_log_value(exc),
        )
        _audit_microsoft_event(
            repository,
            action="login_microsoft_falha_tecnica",
            request=request,
            success=False,
            reason="Falha interna ao autorizar usuário Microsoft.",
        )
        return _redirect_microsoft_result(
            request,
            "A autenticação Microsoft não foi concluída.",
        )

    request.session[MICROSOFT_USER_SESSION_KEY] = int(user_record["id_usuario"])
    request.session[MICROSOFT_PROVIDER_SESSION_KEY] = "microsoft"
    logger.info(
        "Login Microsoft concluído para o usuário interno %s.",
        user_record.get("id_usuario"),
    )
    return _redirect_microsoft_result(request)


@router.post("/microsoft/complete", response_model=LoginResponse)
def complete_microsoft_login(
    request: Request,
    repository: DatabaseRepository = Depends(get_repository),
) -> LoginResponse:
    error_message = str(request.session.pop(MICROSOFT_ERROR_SESSION_KEY, "") or "")
    if error_message:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=error_message)

    id_usuario = request.session.pop(MICROSOFT_USER_SESSION_KEY, None)
    if not id_usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="O fluxo de autenticação expirou. Tente novamente.",
        )

    user_record = repository.get_system_user_for_session(int(id_usuario))
    token, user = create_session_for_user_record(user_record)
    _bloquear_perfil_sem_acesso_web(user)
    return _build_login_response(token, user)


@router.get("/me", response_model=SessionResponse)
def me(user: AuthenticatedUser = Depends(get_current_user)) -> SessionResponse:
    return SessionResponse(
        usuario=user.username,
        nome=user.nome,
        sobrenome=user.sobrenome,
        cargo=user.cargo,
        email=user.email,
        perfil=user.perfil,
        perfil_nome=user.perfil_nome,
        nivel=user.nivel,
        permissoes=sorted(user.permissions),
        avatar_ilustrado=user.avatar_ilustrado,
        provedor_autenticacao=user.provedor_autenticacao,
    )


def _build_session_response(user: AuthenticatedUser) -> SessionResponse:
    return SessionResponse(
        usuario=user.username,
        nome=user.nome,
        sobrenome=user.sobrenome,
        cargo=user.cargo,
        email=user.email,
        perfil=user.perfil,
        perfil_nome=user.perfil_nome,
        nivel=user.nivel,
        permissoes=sorted(user.permissions),
        avatar_ilustrado=user.avatar_ilustrado,
        provedor_autenticacao=user.provedor_autenticacao,
        access_token=reissue_token(user),
    )


@router.put("/me/avatar", response_model=SessionResponse)
def update_my_avatar(
    payload: UpdateAvatarRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SessionResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para salvar preferências.")
    repository.update_own_avatar(user.id_usuario, payload.avatar_ilustrado)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="atualizar_avatar_ilustrado",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
        valor_novo={"avatar_ilustrado": payload.avatar_ilustrado},
    )
    usuario_atualizado = replace(user, avatar_ilustrado=payload.avatar_ilustrado)
    return _build_session_response(usuario_atualizado)


@router.put("/me/nome", response_model=SessionResponse)
def update_my_name(
    payload: UpdateNameRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SessionResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para salvar preferências.")
    repository.update_own_name(user.id_usuario, payload.nome)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="atualizar_nome_usuario",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
        valor_novo={"nome": payload.nome},
    )
    usuario_atualizado = replace(user, nome=payload.nome)
    return _build_session_response(usuario_atualizado)


@router.put("/me/sobrenome", response_model=SessionResponse)
def update_my_surname(
    payload: UpdateSurnameRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SessionResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para salvar preferências.")
    repository.update_own_surname(user.id_usuario, payload.sobrenome)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="atualizar_sobrenome_usuario",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
        valor_novo={"sobrenome": payload.sobrenome},
    )
    usuario_atualizado = replace(user, sobrenome=payload.sobrenome)
    return _build_session_response(usuario_atualizado)


@router.put("/me/cargo", response_model=SessionResponse)
def update_my_cargo(
    payload: UpdateCargoRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SessionResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para salvar preferências.")
    repository.update_own_cargo(user.id_usuario, payload.cargo)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="atualizar_cargo_usuario",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
        valor_novo={"cargo": payload.cargo},
    )
    usuario_atualizado = replace(user, cargo=payload.cargo)
    return _build_session_response(usuario_atualizado)


@router.put("/me/email", response_model=SuccessResponse)
def request_my_email_change(
    payload: RequestEmailChangeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SuccessResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para solicitar alterações.")
    repository.create_email_change_request(user.id_usuario, user.email, payload.email_novo)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="solicitar_alteracao_email",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
        valor_novo={"email_novo": payload.email_novo},
    )
    return SuccessResponse(message="Alteração enviada para aprovação do administrador.")


@router.post("/me/ativar-login-local", response_model=SessionResponse)
def activate_my_local_login(
    payload: ActivateLocalLoginRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SessionResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para alterar o acesso.")
    repository.activate_local_login(user.id_usuario, payload.nova_senha)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="ativar_login_local",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
    )
    usuario_atualizado = replace(user, provedor_autenticacao="local")
    return _build_session_response(usuario_atualizado)


@router.put("/me/provedor-autenticacao", response_model=SessionResponse)
def update_my_auth_provider(
    payload: UpdateAuthProviderRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SessionResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para alterar o acesso.")
    repository.update_own_auth_provider(user.id_usuario, payload.provedor)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="atualizar_provedor_autenticacao",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
        valor_novo={"provedor_autenticacao": payload.provedor},
    )
    usuario_atualizado = replace(user, provedor_autenticacao=payload.provedor)
    return _build_session_response(usuario_atualizado)


@router.put("/me/senha", response_model=SuccessResponse)
def update_my_password(
    payload: UpdateOwnPasswordRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SuccessResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="Este usuário não possui cadastro para alterar a senha.")
    repository.update_own_password(user.id_usuario, payload.senha_atual, payload.nova_senha)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="alterar_propria_senha",
        entidade="usuario",
        entidade_id=str(user.id_usuario),
    )
    return SuccessResponse(message="Senha atualizada.")


@router.post("/mfa/setup", response_model=MfaSetupResponse)
def setup_mfa(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> MfaSetupResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="MFA exige um usuário persistido no banco.")
    return MfaSetupResponse(**repository.begin_mfa_enrollment(user.id_usuario, actor=user))


@router.post("/mfa/enable", response_model=SuccessResponse)
def enable_mfa(
    payload: MfaCodeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SuccessResponse:
    if user.id_usuario is None:
        raise HTTPException(status_code=400, detail="MFA exige um usuário persistido no banco.")
    result = repository.enable_mfa(user.id_usuario, payload.code, actor=user)
    return SuccessResponse(message=result.get("message") or "MFA ativado.")


@router.post("/logout", response_model=SuccessResponse)
def logout(
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> SuccessResponse:
    for key in (
        MICROSOFT_FLOW_SESSION_KEY,
        MICROSOFT_USER_SESSION_KEY,
        MICROSOFT_ERROR_SESSION_KEY,
        MICROSOFT_PROVIDER_SESSION_KEY,
    ):
        request.session.pop(key, None)
    authorization_header = request.headers.get("authorization") or ""
    if authorization_header.lower().startswith("bearer "):
        revoke_access_token(authorization_header[7:])
    logger.info("Logout solicitado para o usuario '%s'.", user.username)
    if hasattr(repository, "record_audit_log"):
        repository.record_audit_log(
            user=user,
            modulo="Autenticação",
            acao="logout",
            entidade="sessao",
            entidade_id=user.username,
            sucesso=True,
        )
    return SuccessResponse(message="Sessao encerrada.")

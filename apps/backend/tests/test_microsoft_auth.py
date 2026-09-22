from __future__ import annotations

from dataclasses import replace
from http.cookies import SimpleCookie
import inspect
import logging

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from starlette.middleware.sessions import SessionMiddleware

from rh_api.config import get_settings
from rh_api.dependencies import get_repository
from rh_api.repositories.security import SecurityRepositoryMixin
from rh_api.routers import auth as auth_routes
from rh_api.services.microsoft_auth_service import (
    MicrosoftAuthConfigurationError,
    validate_microsoft_auth_configuration,
)


TENANT_ID = "tenant-conecta"
AUTH_COLUMNS = [
    "id_usuario",
    "login",
    "nome",
    "email",
    "perfil_id",
    "perfil_nome",
    "nivel",
    "status",
    "microsoft_oid",
    "microsoft_tenant_id",
    "provedor_autenticacao",
    "ultimo_login_microsoft",
    "criado_em",
    "ultimo_acesso_em",
    "criado_por",
    "atualizado_por",
    "atualizado_em",
]


def _user_record(**overrides) -> dict:
    record = {
        "id_usuario": 7,
        "login": "ana@empresa.com.br",
        "nome": "Ana",
        "email": "ana@empresa.com.br",
        "perfil_id": "rh",
        "perfil_nome": "RH",
        "nivel": "Operacional",
        "status": "Ativo",
        "microsoft_oid": None,
        "microsoft_tenant_id": None,
        "provedor_autenticacao": "local",
        "ultimo_login_microsoft": None,
        "criado_em": None,
        "ultimo_acesso_em": None,
        "criado_por": "admin",
        "atualizado_por": "admin",
        "atualizado_em": None,
        "permissoes": ["usuarios.visualizar"],
    }
    record.update(overrides)
    return record


class FakeMicrosoftClient:
    def __init__(self, result: dict | None = None, error: Exception | None = None):
        self.result = result or {}
        self.error = error
        self.initiated = []
        self.acquired = []

    def initiate_auth_code_flow(self, *, scopes, redirect_uri):
        self.initiated.append({"scopes": scopes, "redirect_uri": redirect_uri})
        return {
            "auth_uri": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
            "state": "state-123",
            "nonce": "nonce-123",
        }

    def acquire_token_by_auth_code_flow(self, flow, query):
        self.acquired.append({"flow": flow, "query": query})
        if self.error:
            raise self.error
        return self.result


class FakeRouteRepository:
    def __init__(self, auth_result: dict | None = None, auth_error: HTTPException | None = None):
        self.auth_result = auth_result or _user_record()
        self.auth_error = auth_error
        self.microsoft_calls = []
        self.audit_calls = []

    def record_audit_log(self, **payload):
        self.audit_calls.append(payload)
        return {"success": True}

    def authenticate_microsoft_user(self, **payload):
        self.microsoft_calls.append(payload)
        if self.auth_error:
            raise self.auth_error
        return self.auth_result

    def get_system_user_for_session(self, id_usuario: int):
        assert id_usuario == self.auth_result["id_usuario"]
        return self.auth_result


def _create_test_client(
    repository: FakeRouteRepository,
    *,
    base_url: str = "http://localhost:8000",
) -> TestClient:
    app = FastAPI()
    app.add_middleware(
        SessionMiddleware,
        secret_key="session-secret-for-tests",
        path="/",
        same_site="lax",
        https_only=False,
        domain=None,
    )
    app.include_router(auth_routes.router)
    app.dependency_overrides[get_repository] = lambda: repository

    @app.get("/_test/session")
    def inspect_session(request: Request):
        return dict(request.session)

    return TestClient(app, base_url=base_url, follow_redirects=False)


@pytest.fixture(autouse=True)
def microsoft_environment(monkeypatch):
    values = {
        "RH_APP_ENV": "development",
        "RH_AUTH_TOKEN_SECRET": "auth-secret-for-tests",
        "FLASK_SECRET_KEY": "session-secret-for-tests",
        "MICROSOFT_CLIENT_ID": "client-id",
        "MICROSOFT_TENANT_ID": TENANT_ID,
        "MICROSOFT_CLIENT_SECRET": "client-secret",
        "MICROSOFT_AUTHORITY": f"https://login.microsoftonline.com/{TENANT_ID}",
        "MICROSOFT_REDIRECT_URI": "http://localhost:8000/auth/microsoft/callback",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_missing_microsoft_configuration_does_not_break_settings_startup():
    settings = replace(
        get_settings(),
        microsoft_client_id="",
        microsoft_client_secret="",
    )
    assert settings.microsoft_auth_configured is False
    with pytest.raises(MicrosoftAuthConfigurationError):
        validate_microsoft_auth_configuration(settings)


def test_rejects_multitenant_authority_aliases():
    settings = replace(
        get_settings(),
        microsoft_tenant_id="common",
        microsoft_authority="https://login.microsoftonline.com/common",
    )
    with pytest.raises(MicrosoftAuthConfigurationError):
        validate_microsoft_auth_configuration(settings)


def test_session_secret_is_fixed_between_settings_loads():
    first_secret = get_settings().session_secret_key
    get_settings.cache_clear()
    second_secret = get_settings().session_secret_key
    assert first_secret
    assert first_secret == second_secret


def test_web_session_rejects_missing_fixed_secret():
    from rh_api.config import ConfigurationError
    from rh_api.main import validate_web_session_configuration

    with pytest.raises(ConfigurationError):
        validate_web_session_configuration(
            replace(get_settings(), session_secret_key="")
        )


def test_session_cookie_secure_only_outside_development():
    from rh_api.main import session_cookie_secure

    settings = get_settings()
    assert session_cookie_secure(replace(settings, app_env="dev")) is False
    assert session_cookie_secure(replace(settings, app_env="prod")) is True


def test_microsoft_login_redirects_and_keeps_state_and_nonce(monkeypatch):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient()
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(repository)

    response = client.get("/auth/microsoft/login")
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://login.microsoftonline.com/")

    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    session_cookie = cookie["session"]
    assert session_cookie["httponly"] is True
    assert session_cookie["samesite"].lower() == "lax"
    assert session_cookie["secure"] == ""
    assert session_cookie["domain"] == ""
    assert session_cookie["path"] == "/"

    session_payload = client.get("/_test/session").json()
    flow = session_payload[auth_routes.MICROSOFT_FLOW_SESSION_KEY]
    assert flow["state"] == "state-123"
    assert flow["nonce"] == "nonce-123"
    assert microsoft_client.initiated == [
        {
            "scopes": ["User.Read"],
            "redirect_uri": "http://localhost:8000/auth/microsoft/callback",
        }
    ]


def test_microsoft_login_normalizes_host_to_match_callback(monkeypatch):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient()
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(
        repository,
        base_url="http://127.0.0.1:8000",
    )

    response = client.get("/auth/microsoft/login")
    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:8000/auth/microsoft/login"
    assert microsoft_client.initiated == []


def test_microsoft_login_does_not_canonicalize_host_in_production(monkeypatch):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient()
    production_settings = replace(get_settings(), app_env="prod")
    monkeypatch.setattr(auth_routes, "get_settings", lambda: production_settings)
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(
        repository,
        base_url="http://127.0.0.1:8000",
    )

    response = client.get("/auth/microsoft/login")
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://login.microsoftonline.com/")
    assert len(microsoft_client.initiated) == 1


def test_callback_without_flow_returns_friendly_error():
    client = _create_test_client(FakeRouteRepository())
    response = client.get("/auth/microsoft/callback")
    assert response.status_code == 302
    assert response.headers["location"] == auth_routes.MICROSOFT_LOGIN_RESULT_URL

    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert "fluxo de autenticação expirou" in completion.json()["detail"].lower()


def test_callback_value_error_returns_validation_message(monkeypatch):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient(error=ValueError("invalid state"))
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    client.get("/auth/microsoft/callback?code=code&state=wrong")
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert completion.json()["detail"] == "Não foi possível validar o retorno da Microsoft."


def test_callback_invalid_client_logs_safe_diagnostics(monkeypatch, caplog):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient(
        result={
            "error": "invalid_client",
            "error_codes": [7000215],
            "correlation_id": "correlation-test",
            "trace_id": "trace-test",
            "error_description": (
                "AADSTS7000215 client_secret=super-secret-value\n"
                "https://example.test/callback?code=authorization-code"
            ),
        }
    )
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    caplog.set_level(logging.ERROR, logger=auth_routes.logger.name)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    client.get("/auth/microsoft/callback?code=code&state=state-123")
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert completion.json()["detail"] == "A autenticação Microsoft não foi concluída."
    assert "7000215" in caplog.text
    assert "correlation-test" in caplog.text
    assert "trace-test" in caplog.text
    assert "Client Secret inválido" in caplog.text
    assert "super-secret-value" not in caplog.text
    assert "authorization-code" not in caplog.text
    assert "super-secret-value" not in completion.text


def test_callback_redirect_mismatch_logs_aadsts50011(monkeypatch, caplog):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient(
        result={
            "error": "invalid_grant",
            "error_codes": [50011],
            "error_description": "AADSTS50011 redirect URI mismatch",
        }
    )
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    caplog.set_level(logging.ERROR, logger=auth_routes.logger.name)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    client.get("/auth/microsoft/callback?code=code&state=state-123")
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert completion.json()["detail"] == "A autenticação Microsoft não foi concluída."
    assert "50011" in caplog.text
    assert "URI de redirecionamento diferente" in caplog.text


def test_callback_access_denied_returns_cancelled_message(monkeypatch):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient(
        result={"error": "access_denied", "error_description": "User cancelled."}
    )
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    client.get("/auth/microsoft/callback?error=access_denied&state=state-123")
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert completion.json()["detail"] == "O login Microsoft foi cancelado."


def test_callback_reads_flow_before_removing_it():
    source = inspect.getsource(auth_routes.microsoft_callback)
    assert source.index("request.session.get(MICROSOFT_FLOW_SESSION_KEY)") < source.index(
        "client.acquire_token_by_auth_code_flow"
    )
    assert source.index("client.acquire_token_by_auth_code_flow") < source.index(
        "request.session.pop(MICROSOFT_FLOW_SESSION_KEY"
    )


@pytest.mark.parametrize(
    ("error_code", "expected"),
    [
        ("70002", "Credenciais do aplicativo inválidas"),
        ("7000215", "Client Secret inválido"),
        ("700016", "Client ID incorreto"),
        ("50011", "URI de redirecionamento diferente"),
        ("65001", "Consentimento não concedido"),
        ("90094", "Consentimento de administrador necessário"),
        ("53003", "Acesso bloqueado por política"),
    ],
)
def test_known_aadsts_codes_have_safe_diagnosis(error_code, expected):
    assert expected in auth_routes._diagnose_msal_error("invalid_grant", (error_code,))


def test_callback_blocks_different_tenant(monkeypatch):
    repository = FakeRouteRepository()
    microsoft_client = FakeMicrosoftClient(
        result={"id_token_claims": {"oid": "oid-1", "tid": "outro-tenant", "preferred_username": "ana@empresa.com.br"}}
    )
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    client.get("/auth/microsoft/callback?code=code&state=state-123")
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert completion.json()["detail"] == "Esta conta não pertence à organização autorizada."
    assert repository.microsoft_calls == []


@pytest.mark.parametrize(
    "message",
    [
        "Sua conta Microsoft foi autenticada, mas não possui autorização de acesso ao Conecta.",
        "Seu acesso ao Conecta está desativado.",
    ],
)
def test_callback_preserves_repository_denial_message(monkeypatch, message):
    repository = FakeRouteRepository(
        auth_error=HTTPException(status_code=403, detail=message),
    )
    microsoft_client = FakeMicrosoftClient(
        result={
            "id_token_claims": {
                "oid": "oid-1",
                "tid": TENANT_ID,
                "name": "Ana",
                "preferred_username": "ANA@EMPRESA.COM.BR",
            }
        }
    )
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    client.get("/auth/microsoft/callback?code=code&state=state-123")
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 401
    assert completion.json()["detail"] == message


def test_successful_callback_issues_existing_conecta_session(monkeypatch):
    record = _user_record(perfil_id="rh", nivel="Operacional", permissoes=["usuarios.visualizar"])
    repository = FakeRouteRepository(auth_result=record)
    microsoft_client = FakeMicrosoftClient(
        result={
            "access_token": "microsoft-token-must-not-be-returned",
            "id_token_claims": {
                "oid": "oid-1",
                "tid": TENANT_ID,
                "name": "Ana",
                "email": "ANA@EMPRESA.COM.BR",
            },
        }
    )
    monkeypatch.setattr(auth_routes, "create_microsoft_client", lambda settings: microsoft_client)
    client = _create_test_client(repository)
    client.get("/auth/microsoft/login")

    callback = client.get("/auth/microsoft/callback?code=code&state=state-123")
    assert callback.status_code == 302
    completion = client.post("/auth/microsoft/complete")
    assert completion.status_code == 200
    payload = completion.json()
    assert payload["access_token"]
    assert payload["access_token"] != "microsoft-token-must-not-be-returned"
    assert payload["perfil"] == "rh"
    assert payload["nivel"] == "Operacional"
    assert payload["permissoes"] == ["usuarios.visualizar"]
    assert repository.microsoft_calls[0]["microsoft_oid"] == "oid-1"
    assert repository.microsoft_calls[0]["email"] == "ANA@EMPRESA.COM.BR"


class FakeCursor:
    def __init__(self, *, oid_user=None, email_user=None, permissions=None):
        self.oid_user = oid_user
        self.email_user = email_user
        self.permissions = permissions or ["usuarios.visualizar"]
        self.description = []
        self.current_row = None
        self.current_rows = []
        self.executions = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split()).lower()
        self.executions.append((normalized, tuple(params or ())))
        self.current_row = None
        self.current_rows = []
        if "select top 1" in normalized and "usuarios.microsoft_oid = ?" in normalized:
            self.description = [(column,) for column in AUTH_COLUMNS]
            self.current_row = self._row(self.oid_user)
        elif "select top 1" in normalized and "lower(ltrim(rtrim(usuarios.email)))" in normalized:
            self.description = [(column,) for column in AUTH_COLUMNS]
            self.current_row = self._row(self.email_user)
        elif "select top 1" in normalized and "where usuarios.id_usuario = ?" in normalized:
            self.description = [(column,) for column in AUTH_COLUMNS]
            self.current_row = self._row(self.email_user or self.oid_user)
        elif "select chave_permissao" in normalized:
            self.description = [("chave_permissao",), ("permitido",)]
            self.current_rows = [(permission, 1) for permission in self.permissions]
        elif "output inserted.id_usuario" in normalized:
            self.current_row = (7,)
        return self

    @staticmethod
    def _row(record):
        if record is None:
            return None
        return tuple(record.get(column) for column in AUTH_COLUMNS)

    def fetchone(self):
        return self.current_row

    def fetchall(self):
        return list(self.current_rows)


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class FakeSecurityRepository(SecurityRepositoryMixin):
    def __init__(self, cursor):
        self.connection = FakeConnection(cursor)
        self.settings = get_settings()
        self.logger = auth_routes.logger

    def _connect(self):
        return self.connection


def test_first_microsoft_login_links_by_normalized_email_and_preserves_access():
    cursor = FakeCursor(email_user=_user_record())
    repository = FakeSecurityRepository(cursor)
    result = repository.authenticate_microsoft_user(
        microsoft_oid="oid-1",
        microsoft_tenant_id=TENANT_ID,
        email="  ANA@EMPRESA.COM.BR  ",
        nome="Ana Microsoft",
    )

    assert result["id_usuario"] == 7
    assert result["perfil"] == "rh"
    assert result["nivel"] == "Operacional"
    assert result["permissoes"] == ["usuarios.visualizar"]
    update = next(sql for sql, _ in cursor.executions if sql.startswith("update usuarios"))
    assert "microsoft_oid = ?" in update
    assert repository.connection.commits == 1


def test_next_microsoft_login_finds_user_by_oid_and_tenant_first():
    linked = _user_record(
        microsoft_oid="oid-1",
        microsoft_tenant_id=TENANT_ID,
        provedor_autenticacao="microsoft",
    )
    cursor = FakeCursor(oid_user=linked)
    repository = FakeSecurityRepository(cursor)
    result = repository.authenticate_microsoft_user(
        microsoft_oid="oid-1",
        microsoft_tenant_id=TENANT_ID,
        email="outro@empresa.com.br",
    )

    assert result["id_usuario"] == 7
    assert not any("lower(ltrim(rtrim(usuarios.email)))" in sql for sql, _ in cursor.executions)


def test_microsoft_login_does_not_create_unknown_user():
    cursor = FakeCursor()
    repository = FakeSecurityRepository(cursor)
    with pytest.raises(HTTPException, match="não possui autorização"):
        repository.authenticate_microsoft_user(
            microsoft_oid="oid-unknown",
            microsoft_tenant_id=TENANT_ID,
            email="unknown@empresa.com.br",
        )
    assert not any(sql.startswith("insert into usuarios") for sql, _ in cursor.executions)


def test_microsoft_login_blocks_inactive_user_without_linking():
    cursor = FakeCursor(email_user=_user_record(status="Inativo"))
    repository = FakeSecurityRepository(cursor)
    with pytest.raises(HTTPException, match="desativado"):
        repository.authenticate_microsoft_user(
            microsoft_oid="oid-1",
            microsoft_tenant_id=TENANT_ID,
            email="ana@empresa.com.br",
        )
    assert not any(sql.startswith("update usuarios") for sql, _ in cursor.executions)


def test_microsoft_login_does_not_overwrite_conflicting_link():
    cursor = FakeCursor(
        email_user=_user_record(
            microsoft_oid="outro-oid",
            microsoft_tenant_id=TENANT_ID,
            provedor_autenticacao="microsoft",
        )
    )
    repository = FakeSecurityRepository(cursor)
    with pytest.raises(HTTPException, match="Contate o administrador"):
        repository.authenticate_microsoft_user(
            microsoft_oid="oid-1",
            microsoft_tenant_id=TENANT_ID,
            email="ana@empresa.com.br",
        )
    assert not any(sql.startswith("update usuarios") for sql, _ in cursor.executions)


def test_microsoft_user_can_be_created_without_fake_password():
    cursor = FakeCursor()
    repository = FakeSecurityRepository(cursor)
    result = repository.create_system_user(
        {
            "nome": "Ana",
            "email": " ANA@EMPRESA.COM.BR ",
            "perfil": "rh",
            "status": "Ativo",
            "provedor_autenticacao": "microsoft",
            "senha": "",
        }
    )
    assert result["id_usuario"] == 7
    insert_params = next(params for sql, params in cursor.executions if sql.startswith("insert into usuarios"))
    # Ordem do INSERT: login, nome, sobrenome, email, perfil_id, cargo, status, senha_hash, provedor.
    assert insert_params[3] == "ana@empresa.com.br"
    assert insert_params[7] is None
    assert insert_params[8] == "microsoft"


def test_local_user_still_requires_password():
    repository = FakeSecurityRepository(FakeCursor())
    with pytest.raises(HTTPException, match="senha é obrigatória"):
        repository.create_system_user(
            {
                "nome": "Ana",
                "email": "ana@empresa.com.br",
                "provedor_autenticacao": "local",
                "senha": "",
            }
        )


def test_user_edit_preserves_microsoft_identifiers():
    linked = _user_record(
        microsoft_oid="oid-1",
        microsoft_tenant_id=TENANT_ID,
        provedor_autenticacao="microsoft",
    )
    cursor = FakeCursor(email_user=linked)
    repository = FakeSecurityRepository(cursor)
    repository.update_system_user(
        7,
        {
            "nome": "Ana Atualizada",
            "email": "ANA.NOVA@EMPRESA.COM.BR",
            "perfil": "rh",
            "status": "Ativo",
            "provedor_autenticacao": "microsoft",
        },
    )
    update_sql = next(sql for sql, _ in cursor.executions if sql.startswith("update usuarios"))
    assert "microsoft_oid" not in update_sql
    assert "microsoft_tenant_id" not in update_sql

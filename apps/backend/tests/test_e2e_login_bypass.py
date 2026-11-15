from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rh_api.auth import validate_access_token
from rh_api.config import get_settings
from rh_api.routers import auth as auth_routes

ENV_VARS = (
    "RH_APP_ENV",
    "RH_E2E_TEST_LOGIN_SECRET",
    "RH_SQL_ENCRYPT",
    "RH_SQL_TRUST_SERVER_CERTIFICATE",
    "RH_SCHEMA_BOOTSTRAP_ENABLED",
)


@pytest.fixture()
def env_sandbox():
    original = {key: os.environ.get(key) for key in ENV_VARS}
    yield
    for key, value in original.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    get_settings.cache_clear()


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_routes.router)
    return TestClient(app)


def test_e2e_login_returns_404_when_secret_not_configured(env_sandbox):
    os.environ["RH_APP_ENV"] = "dev"
    os.environ.pop("RH_E2E_TEST_LOGIN_SECRET", None)
    get_settings.cache_clear()

    resposta = _client().post("/auth/e2e-login", json={"secret": "qualquer-coisa"})
    assert resposta.status_code == 404


def test_e2e_login_returns_404_in_production_even_with_matching_secret(env_sandbox):
    os.environ["RH_APP_ENV"] = "production"
    os.environ["RH_E2E_TEST_LOGIN_SECRET"] = "segredo-e2e"
    # Satisfaz validate_production_security (achado não relacionado a este
    # teste) para que get_settings() consiga carregar como "prod" de verdade.
    os.environ["RH_SQL_ENCRYPT"] = "yes"
    os.environ["RH_SQL_TRUST_SERVER_CERTIFICATE"] = "false"
    os.environ["RH_SCHEMA_BOOTSTRAP_ENABLED"] = "false"
    get_settings.cache_clear()

    resposta = _client().post("/auth/e2e-login", json={"secret": "segredo-e2e"})
    assert resposta.status_code == 404


def test_e2e_login_returns_404_when_secret_does_not_match(env_sandbox):
    os.environ["RH_APP_ENV"] = "dev"
    os.environ["RH_E2E_TEST_LOGIN_SECRET"] = "segredo-e2e"
    get_settings.cache_clear()

    resposta = _client().post("/auth/e2e-login", json={"secret": "segredo-errado"})
    assert resposta.status_code == 404


def test_e2e_login_issues_a_valid_token_when_properly_configured(env_sandbox):
    os.environ["RH_APP_ENV"] = "dev"
    os.environ["RH_E2E_TEST_LOGIN_SECRET"] = "segredo-e2e"
    get_settings.cache_clear()

    resposta = _client().post(
        "/auth/e2e-login",
        json={"secret": "segredo-e2e", "usuario": "e2e.rh", "perfil": "rh"},
    )
    assert resposta.status_code == 200
    payload = resposta.json()
    assert payload["usuario"] == "e2e.rh"
    assert payload["perfil"] == "rh"

    usuario_validado = validate_access_token(payload["access_token"])
    assert usuario_validado.username == "e2e.rh"
    assert usuario_validado.perfil == "rh"


def test_e2e_login_works_in_homologation_not_only_dev(env_sandbox):
    os.environ["RH_APP_ENV"] = "hml"
    os.environ["RH_E2E_TEST_LOGIN_SECRET"] = "segredo-e2e"
    get_settings.cache_clear()

    resposta = _client().post("/auth/e2e-login", json={"secret": "segredo-e2e"})
    assert resposta.status_code == 200

from __future__ import annotations

import pytest
from conecta.domain.candidatos import CandidateStatus, decide_candidate_status
from conecta.domain.permissoes import AuthorizationPolicy
from conecta.infrastructure.security.rate_limit import InMemoryRateLimiter
from conecta.infrastructure.security.totp import generate_code, verify_code

from rh_api.config import (
    ConfigurationError,
    get_settings,
    validate_environment_database,
    validate_production_security,
)
from rh_api.rbac import ROLE_CANDIDATE, ROLE_DEFINITIONS, ROLE_RH


def test_blocks_non_production_environment_from_production_database():
    with pytest.raises(ConfigurationError):
        validate_environment_database("hml", "Conecta_PROD")


def test_allows_production_database_only_in_production():
    validate_environment_database("prod", "Conecta_PROD")
    validate_environment_database("dev", "Conecta_DEV")


def test_production_requires_encrypted_sql_and_disabled_bootstrap():
    settings = get_settings()
    insecure = type(settings)(
        **{
            **settings.__dict__,
            "app_env": "prod",
            "auth_token_secret": "x" * 32,
            "sql_encrypt": "no",
            "sql_trust_server_certificate": False,
            "schema_bootstrap_enabled": False,
        }
    )
    with pytest.raises(ConfigurationError):
        validate_production_security(insecure)


def test_totp_matches_rfc_vector_reduced_to_six_digits():
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert generate_code(secret, timestamp=59) == "287082"
    assert verify_code(secret, "287082", timestamp=59, valid_window=0)
    assert not verify_code(secret, "000000", timestamp=59, valid_window=0)


def test_authorization_policy_supports_any_and_all():
    policy = AuthorizationPolicy({"candidatos.visualizar", "candidatos.editar"})
    assert policy.allows("candidatos.visualizar")
    assert policy.allows("inexistente", "candidatos.editar")
    assert not policy.allows("inexistente", "candidatos.editar", require_all=True)


def test_candidate_elimination_requires_reason():
    with pytest.raises(ValueError):
        decide_candidate_status(CandidateStatus.ELIMINATED)


def test_minimum_role_matrix_contains_rh_and_candidate():
    assert ROLE_RH in ROLE_DEFINITIONS
    assert ROLE_CANDIDATE in ROLE_DEFINITIONS


def test_rate_limiter_rejects_request_over_window_limit():
    limiter = InMemoryRateLimiter()
    assert limiter.allow("login:test", limit=2, window_seconds=60)
    assert limiter.allow("login:test", limit=2, window_seconds=60)
    assert not limiter.allow("login:test", limit=2, window_seconds=60)
    limiter.reset("login:test")
    assert limiter.allow("login:test", limit=2, window_seconds=60)

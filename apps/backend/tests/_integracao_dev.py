"""Apoio aos testes de integração contra o banco de DESENVOLVIMENTO.

Os testes que usam `repositorio_dev()` são pulados quando não há banco
configurado no .env (mesma regra de test_monitoria_fluxo_integration.py)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))


def repositorio_dev():
    try:
        from dotenv import load_dotenv

        load_dotenv(API_DIR.parents[1] / ".env")
    except Exception:
        pass
    if (os.getenv("RH_ENVIRONMENT") or os.getenv("ENVIRONMENT") or "dev").lower() not in {"dev", "development", "local"}:
        pytest.skip("Testes de integração só rodam em ambiente de desenvolvimento.")
    try:
        from rh_api.config import get_settings
        from rh_api.repositories import DatabaseRepository

        repositorio = DatabaseRepository(get_settings())
        conn = repositorio._connect()
        conn.cursor().execute("SELECT 1")
        conn.close()
    except Exception as exc:
        pytest.skip(f"Banco de desenvolvimento indisponível: {exc}")
    return repositorio

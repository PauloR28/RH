from __future__ import annotations

import json
import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from conecta.infrastructure.observability.context import request_id_var
from conecta.interfaces.http.middlewares.request_context import (
    RequestContextMiddleware,
    REQUEST_ID_PATTERN,
)
from rh_api.logging_config import JsonFormatter, configure_logging


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/probe")
    def probe():
        return {"request_id_in_context": request_id_var.get()}

    return app


def test_request_context_middleware_generates_and_propagates_request_id():
    client = TestClient(_build_app())

    response = client.get("/probe")

    assert response.status_code == 200
    header_request_id = response.headers.get("X-Request-ID")
    assert header_request_id
    assert REQUEST_ID_PATTERN.fullmatch(header_request_id)
    # The value seen inside the endpoint (via the contextvar) must match the
    # id returned to the client, proving propagation through the request.
    assert response.json()["request_id_in_context"] == header_request_id


def test_request_context_middleware_honours_valid_incoming_request_id():
    client = TestClient(_build_app())

    response = client.get("/probe", headers={"X-Request-ID": "meu-id-123"})

    assert response.headers["X-Request-ID"] == "meu-id-123"
    assert response.json()["request_id_in_context"] == "meu-id-123"


def test_request_context_middleware_rejects_malformed_incoming_request_id():
    client = TestClient(_build_app())

    response = client.get("/probe", headers={"X-Request-ID": "id com espaco/ruim"})

    generated = response.headers["X-Request-ID"]
    assert generated != "id com espaco/ruim"
    assert REQUEST_ID_PATTERN.fullmatch(generated)


def test_json_formatter_emits_valid_json_with_expected_fields():
    formatter = JsonFormatter(service="conecta-api-test", environment="test", version="0.0.0")
    record = logging.LogRecord(
        name="conecta.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="evento de teste",
        args=(),
        exc_info=None,
    )

    payload = json.loads(formatter.format(record))

    assert payload["level"] == "INFO"
    assert payload["service"] == "conecta-api-test"
    assert payload["logger"] == "conecta.test"
    assert payload["message"] == "evento de teste"
    assert "timestamp" in payload
    assert "request_id" in payload


def test_configure_logging_installs_json_formatter_on_root_logger():
    configure_logging()

    root = logging.getLogger()
    assert root.handlers, "configure_logging deve instalar ao menos um handler"
    assert isinstance(root.handlers[0].formatter, JsonFormatter)


def test_file_handler_desativado_sem_rh_log_dir(monkeypatch):
    from rh_api.logging_config import _build_file_handler

    monkeypatch.delenv("RH_LOG_DIR", raising=False)
    assert _build_file_handler(logging.Formatter()) is None


def test_file_handler_grava_json_em_arquivo_diario(monkeypatch, tmp_path):
    from rh_api.logging_config import _build_file_handler

    monkeypatch.setenv("RH_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("RH_LOG_RETENTION_DAYS", "30")
    handler = _build_file_handler(JsonFormatter(service="s", environment="t", version="1"))
    assert handler is not None
    assert handler.backupCount == 30
    logger = logging.getLogger("teste.arquivo")
    logger.addHandler(handler)
    try:
        logger.warning("mensagem de teste", extra={"client_ip": "10.0.0.1", "log_user_id": "42"})
    finally:
        logger.removeHandler(handler)
        handler.close()
    linha = (tmp_path / "logs" / "conecta.log").read_text(encoding="utf-8").strip()
    payload = json.loads(linha)
    assert payload["message"] == "mensagem de teste"
    assert payload["client_ip"] == "10.0.0.1"
    assert payload["user_id"] == "42"


def test_file_handler_degrada_quando_pasta_invalida(monkeypatch, tmp_path):
    from rh_api.logging_config import _build_file_handler

    arquivo = tmp_path / "nao-e-pasta"
    arquivo.write_text("x")
    monkeypatch.setenv("RH_LOG_DIR", str(arquivo / "logs"))
    assert _build_file_handler(logging.Formatter()) is None


def test_log_de_acesso_registra_ip_e_usuario_sem_query_string(caplog):
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/probe")
    def probe(request: __import__("fastapi").Request):
        request.state.log_user_id = "7"
        return {}

    client = TestClient(app)
    with caplog.at_level(logging.INFO, logger="conecta.http"):
        client.get("/probe?token=segredo", headers={"x-forwarded-for": "203.0.113.9, 10.0.0.1"})
    registro = next(r for r in caplog.records if r.getMessage() == "request_completed")
    assert registro.action == "GET /probe"
    assert registro.client_ip == "203.0.113.9"
    assert registro.log_user_id == "7"
    assert "segredo" not in registro.action

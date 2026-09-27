from __future__ import annotations

import logging
import logging.handlers
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .config import get_settings
from conecta.infrastructure.observability.context import (
    request_id_var,
    user_id_var,
)


class JsonFormatter(logging.Formatter):
    def __init__(self, *, service: str, environment: str, version: str) -> None:
        super().__init__()
        self.service = service
        self.environment = environment
        self.version = version

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self.service,
            "environment": self.environment,
            "version": self.version,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
            "user_id": getattr(record, "log_user_id", "") or user_id_var.get(),
            "action": getattr(record, "action", ""),
            "status": getattr(record, "status", ""),
        }
        if hasattr(record, "duration_ms"):
            payload["duration_ms"] = record.duration_ms
        if getattr(record, "client_ip", ""):
            payload["client_ip"] = record.client_ip
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    settings = get_settings()
    level_name = settings.log_level.upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)
    if getattr(root, "_conecta_configured", False):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        JsonFormatter(
            service=settings.service_name,
            environment=settings.app_env,
            version=settings.app_version,
        )
    )
    root.handlers.clear()
    root.addHandler(handler)
    file_handler = _build_file_handler(handler.formatter)
    if file_handler is not None:
        root.addHandler(file_handler)
    root._conecta_configured = True


def _build_file_handler(formatter: logging.Formatter) -> logging.Handler | None:
    """Log técnico e de acesso em arquivo diário (opcional e degradável).

    RH_LOG_DIR             pasta dos logs; vazio = só console (comportamento anterior).
    RH_LOG_RETENTION_DAYS  dias mantidos (padrão 90). Arquivo atual: conecta.log;
                           dias anteriores: conecta.log.AAAA-MM-DD.
    Se a pasta não puder ser criada/gravada, a aplicação segue só com o console.
    """
    log_dir = os.getenv("RH_LOG_DIR", "").strip()
    if not log_dir:
        return None
    try:
        retencao = max(1, int(os.getenv("RH_LOG_RETENTION_DAYS", "").strip() or 90))
    except ValueError:
        retencao = 90
    try:
        pasta = Path(log_dir).expanduser()
        pasta.mkdir(parents=True, exist_ok=True)
        file_handler = logging.handlers.TimedRotatingFileHandler(
            pasta / "conecta.log",
            when="midnight",
            backupCount=retencao,
            encoding="utf-8",
            delay=True,
        )
    except OSError as exc:
        logging.getLogger(__name__).warning("Log em arquivo desativado (RH_LOG_DIR=%s): %s", log_dir, exc)
        return None
    file_handler.setFormatter(formatter)
    return file_handler

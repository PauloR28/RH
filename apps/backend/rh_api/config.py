from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class ConfigurationError(RuntimeError):
    """Configuração insegura ou inconsistente detectada antes do startup."""


def _normalize_environment(value: str) -> str:
    aliases = {
        "local": "dev",
        "development": "dev",
        "desenvolvimento": "dev",
        "homologation": "hml",
        "homologacao": "hml",
        "homologação": "hml",
        "production": "prod",
        "producao": "prod",
        "produção": "prod",
    }
    normalized = str(value or "dev").strip().lower()
    return aliases.get(normalized, normalized)


def validate_environment_database(
    app_env: str,
    database: str,
    connection_string: str | None = None,
) -> None:
    """Impede que DEV/HML se conectem acidentalmente ao banco de produção."""

    environment = _normalize_environment(app_env)
    target = f"{database};{connection_string or ''}".lower()
    production_markers = ("conecta_prod", "conecta-prod", "database=prod", "database=production")
    if environment != "prod" and any(marker in target for marker in production_markers):
        raise ConfigurationError(
            f"Ambiente '{environment}' não pode apontar para um banco de produção."
        )


def validate_production_security(settings: "Settings") -> None:
    if _normalize_environment(settings.app_env) != "prod":
        return
    if len(settings.auth_token_secret) < 32:
        raise ConfigurationError("RH_AUTH_TOKEN_SECRET deve ter ao menos 32 caracteres em PROD.")
    if str(settings.sql_encrypt).strip().lower() not in {"yes", "true", "mandatory", "strict"}:
        raise ConfigurationError("A conexão SQL deve usar criptografia em PROD.")
    if settings.sql_trust_server_certificate:
        raise ConfigurationError("RH_SQL_TRUST_SERVER_CERTIFICATE deve ser false em PROD.")
    if settings.schema_bootstrap_enabled:
        raise ConfigurationError("Bootstrap automático de schema é proibido em PROD.")


def _load_dotenv() -> None:
    """Carrega .env sem sobrescrever variáveis já definidas pelo processo."""
    for dotenv_path in (BACKEND_ROOT / ".env", PROJECT_ROOT / ".env"):
        if not dotenv_path.is_file():
            continue

        for line in dotenv_path.read_text(encoding="utf-8-sig").splitlines():
            item = line.strip()
            if not item or item.startswith("#") or "=" not in item:
                continue

            key, raw_value = item.split("=", 1)
            key = key.strip()
            if not key:
                continue
            value = raw_value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return default


def _read_bool_env(*names: str, default: bool = False) -> bool:
    raw_value = _env(*names)
    if not raw_value:
        return default
    normalized = raw_value.lower()
    if normalized in {"1", "true", "yes", "y", "on", "sim", "s"}:
        return True
    if normalized in {"0", "false", "no", "n", "off", "nao", "não"}:
        return False
    return default


def _read_int_env(
    *names: str,
    default: int,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    raw_value = _env(*names)
    try:
        value = int(raw_value) if raw_value else default
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _split_csv(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def _resolve_project_path(value: str, default_relative: str) -> str:
    path = Path(value or default_relative).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return str(path.resolve())


@dataclass(frozen=True)
class Settings:
    service_name: str
    app_version: str
    app_env: str
    server_host: str
    server_port: int
    server_reload: bool
    schema_bootstrap_enabled: bool
    serve_frontend: bool
    frontend_dir: str
    frontend_bundle: bool
    frontend_api_base_url: str
    process_dossier_ai_endpoint: str
    sql_server: str
    sql_database: str
    sql_driver: str
    sql_connection_string: str | None
    sql_username: str
    sql_password: str
    sql_trusted_connection: bool
    sql_encrypt: str
    sql_trust_server_certificate: bool
    sql_timeout_seconds: int
    auth_user: str
    auth_password: str
    auth_token_secret: str
    auth_token_ttl_minutes: int
    auth_login_rate_limit: int
    auth_login_rate_window_seconds: int
    exam_access_rate_limit: int
    exam_access_rate_window_seconds: int
    email_send_rate_limit: int
    email_send_rate_window_seconds: int
    e2e_test_login_secret: str
    session_secret_key: str
    microsoft_client_id: str
    microsoft_tenant_id: str
    microsoft_client_secret: str
    microsoft_authority: str
    microsoft_redirect_uri: str
    microsoft_scopes: tuple[str, ...]
    mfa_issuer: str
    mfa_encryption_key: str
    cors_allow_origins: list[str]
    cors_allow_origin_regex: str | None
    log_level: str
    public_frontend_base_url: str
    public_candidate_base_url: str
    public_cv_upload_dir: str
    doc_converter: str
    libreoffice_path: str
    training_upload_dir: str
    training_upload_max_pptx_mb: int
    training_upload_max_video_mb: int
    training_upload_max_document_mb: int
    email_inbox_enabled: bool
    email_inbox_mode: str
    email_inbox_path: str
    email_inbox_provider: str
    email_inbox_protocol: str
    email_inbox_address: str
    email_inbox_imap_host: str
    email_inbox_imap_port: int
    email_inbox_username: str
    email_inbox_auth_mode: str
    email_inbox_password_env: str
    email_inbox_mailbox: str
    email_inbox_tenant_id: str
    email_inbox_client_id: str
    email_inbox_client_secret_env: str
    email_inbox_oauth_scope: str
    email_inbox_attachments_dir: str
    email_inbox_max_messages: int
    email_inbox_max_attachment_mb: int
    email_graph_tenant_id: str
    email_graph_client_id: str
    email_graph_client_secret_env: str
    email_graph_mailbox: str
    email_graph_scope: str
    email_graph_base_url: str
    email_send_client_secret_env: str
    sharepoint_site_id: str
    sharepoint_drive_id: str
    sharepoint_tenant_id: str
    sharepoint_client_id: str
    sharepoint_client_secret_env: str
    sharepoint_scope: str
    sharepoint_graph_base_url: str
    email_smtp_enabled: bool
    email_smtp_host: str
    email_smtp_port: int
    email_smtp_username: str
    email_smtp_password_env: str
    email_smtp_from: str
    email_smtp_use_tls: bool
    email_smtp_use_ssl: bool
    ai_enabled: bool
    ai_provider: str
    ai_model: str
    openai_api_key: str
    openai_base_url: str
    ai_timeout_seconds: int
    ai_max_curriculo_chars: int
    ai_duplicate_window_seconds: int
    scheduler_enabled: bool
    scheduler_inactivity_interval_hours: int
    scheduler_inactivity_dias_sem_movimentacao: int
    scheduler_inactivity_dias_realerta: int
    email_inactivity_alert_recipients: tuple[str, ...]
    redis_url: str

    @property
    def is_development(self) -> bool:
        return _normalize_environment(self.app_env) == "dev"

    @property
    def is_production(self) -> bool:
        return _normalize_environment(self.app_env) == "prod"

    @property
    def ai_available(self) -> bool:
        return (
            self.ai_enabled
            and self.ai_provider.lower() == "openai"
            and bool(self.openai_api_key)
            and bool(self.ai_model)
        )

    @property
    def microsoft_auth_configured(self) -> bool:
        return all(
            (
                self.microsoft_client_id,
                self.microsoft_tenant_id,
                self.microsoft_client_secret,
                self.microsoft_authority,
                self.microsoft_redirect_uri,
            )
        )

    @property
    def email_send_client_secret(self) -> str:
        env_name = self.email_send_client_secret_env
        return os.getenv(env_name, "") if env_name else ""

    @property
    def sharepoint_client_secret(self) -> str:
        env_name = self.sharepoint_client_secret_env
        return os.getenv(env_name, "") if env_name else ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_dotenv()
    email_inbox_protocol = _env("RH_EMAIL_INBOX_PROTOCOL", default="imap")
    auth_token_secret = _env("RH_AUTH_TOKEN_SECRET") or secrets.token_urlsafe(32)
    microsoft_tenant_id = _env("MICROSOFT_TENANT_ID")
    microsoft_authority = _env("MICROSOFT_AUTHORITY")
    if microsoft_tenant_id:
        microsoft_authority = f"https://login.microsoftonline.com/{microsoft_tenant_id}"

    settings = Settings(
        service_name=_env("RH_SERVICE_NAME", default="conecta-api"),
        app_version=_env("RH_APP_VERSION", "APP_VERSION", default="0.1.0"),
        app_env=_normalize_environment(_env("RH_APP_ENV", "APP_ENV", "ENV", default="dev")),
        server_host=_env("RH_API_HOST", "RH_SERVER_HOST", "HOST", default="127.0.0.1"),
        server_port=_read_int_env(
            "RH_API_PORT", "RH_SERVER_PORT", "PORT", default=8000, minimum=1, maximum=65535
        ),
        server_reload=_read_bool_env("RH_SERVER_RELOAD", default=False),
        schema_bootstrap_enabled=_read_bool_env(
            "RH_SCHEMA_BOOTSTRAP_ENABLED", default=True
        ),
        serve_frontend=_read_bool_env(
            "RH_FRONT_SERVE_STATIC", "RH_SERVE_FRONTEND", default=True
        ),
        frontend_dir=_resolve_project_path(_env("RH_FRONTEND_DIR"), "apps/frontend"),
        frontend_bundle=_read_bool_env("RH_FRONTEND_BUNDLE", default=False),
        frontend_api_base_url=_env("RH_FRONTEND_API_BASE_URL"),
        process_dossier_ai_endpoint=_env("RH_PROCESS_DOSSIER_AI_ENDPOINT"),
        sql_server=_env("RH_SQL_SERVER"),
        sql_database=_env("RH_SQL_DATABASE", default="RH_Provas"),
        sql_driver=_env("RH_SQL_DRIVER", default="ODBC Driver 18 for SQL Server"),
        sql_connection_string=_env("RH_SQL_CONNECTION_STRING") or None,
        sql_username=_env("RH_SQL_USERNAME"),
        sql_password=os.getenv("RH_SQL_PASSWORD", ""),
        sql_trusted_connection=_read_bool_env("RH_SQL_TRUSTED_CONNECTION", default=True),
        sql_encrypt=_env("RH_SQL_ENCRYPT", default="no"),
        sql_trust_server_certificate=_read_bool_env(
            "RH_SQL_TRUST_SERVER_CERTIFICATE", default=True
        ),
        sql_timeout_seconds=_read_int_env(
            "RH_SQL_TIMEOUT_SECONDS", default=5, minimum=1, maximum=120
        ),
        auth_user=_env("RH_AUTH_USER", default="rh"),
        auth_password=os.getenv("RH_AUTH_PASSWORD", ""),
        auth_token_secret=auth_token_secret,
        auth_token_ttl_minutes=_read_int_env(
            "RH_AUTH_TOKEN_TTL_MINUTES", default=480, minimum=1
        ),
        auth_login_rate_limit=_read_int_env(
            "RH_AUTH_LOGIN_RATE_LIMIT", default=5, minimum=1, maximum=100
        ),
        auth_login_rate_window_seconds=_read_int_env(
            "RH_AUTH_LOGIN_RATE_WINDOW_SECONDS", default=60, minimum=10, maximum=3600
        ),
        exam_access_rate_limit=_read_int_env(
            "RH_EXAM_ACCESS_RATE_LIMIT", default=5, minimum=1, maximum=100
        ),
        exam_access_rate_window_seconds=_read_int_env(
            "RH_EXAM_ACCESS_RATE_WINDOW_SECONDS", default=60, minimum=10, maximum=3600
        ),
        email_send_rate_limit=_read_int_env(
            "RH_EMAIL_SEND_RATE_LIMIT", default=20, minimum=1, maximum=1000
        ),
        email_send_rate_window_seconds=_read_int_env(
            "RH_EMAIL_SEND_RATE_WINDOW_SECONDS", default=60, minimum=10, maximum=3600
        ),
        # Achado SEC-002/QA-001: bypass de login só para a suíte E2E, nunca
        # em produção. Vazio por padrão = desabilitado (nenhum ambiente tem
        # isso ligado a menos que alguém defina explicitamente em dev/CI).
        e2e_test_login_secret=_env("RH_E2E_TEST_LOGIN_SECRET", default=""),
        session_secret_key=_env("FLASK_SECRET_KEY", "RH_SESSION_SECRET_KEY"),
        microsoft_client_id=_env("MICROSOFT_CLIENT_ID"),
        microsoft_tenant_id=microsoft_tenant_id,
        microsoft_client_secret=os.getenv("MICROSOFT_CLIENT_SECRET", "").strip(),
        microsoft_authority=microsoft_authority.rstrip("/"),
        microsoft_redirect_uri=_env("MICROSOFT_REDIRECT_URI"),
        microsoft_scopes=("User.Read",),
        mfa_issuer=_env("RH_MFA_ISSUER", default="Conecta"),
        mfa_encryption_key=os.getenv("RH_MFA_ENCRYPTION_KEY", "").strip(),
        cors_allow_origins=_split_csv(_env("RH_CORS_ALLOW_ORIGINS")),
        cors_allow_origin_regex=_env("RH_CORS_ALLOW_ORIGIN_REGEX") or None,
        log_level=_env("RH_LOG_LEVEL", default="INFO"),
        public_frontend_base_url=_env("RH_PUBLIC_FRONTEND_BASE_URL"),
        public_candidate_base_url=_env(
            "RH_PUBLIC_CANDIDATE_BASE_URL", "PUBLIC_CANDIDATE_BASE_URL"
        ),
        public_cv_upload_dir=_resolve_project_path(
            _env("RH_PUBLIC_CV_UPLOAD_DIR"), "data/private/public-cvs"
        ),
        doc_converter=_env("DOC_CONVERTER", "RH_CV_DOC_CONVERTER", default="auto"),
        libreoffice_path=_env("LIBREOFFICE_PATH", "RH_LIBREOFFICE_PATH"),
        training_upload_dir=_resolve_project_path(
            _env("RH_TRAINING_UPLOAD_DIR"), "data/private/training-uploads"
        ),
        training_upload_max_pptx_mb=_read_int_env(
            "RH_TRAINING_UPLOAD_MAX_PPTX_MB", default=50, minimum=1, maximum=500
        ),
        training_upload_max_video_mb=_read_int_env(
            "RH_TRAINING_UPLOAD_MAX_VIDEO_MB", default=200, minimum=1, maximum=2000
        ),
        training_upload_max_document_mb=_read_int_env(
            "RH_TRAINING_UPLOAD_MAX_DOCUMENT_MB", default=10, minimum=1, maximum=200
        ),
        email_inbox_enabled=_read_bool_env("RH_EMAIL_INBOX_ENABLED", default=False),
        email_inbox_mode=_env("RH_EMAIL_INBOX_MODE", default=email_inbox_protocol),
        email_inbox_path=_env("RH_EMAIL_INBOX_PATH"),
        email_inbox_provider=_env("RH_EMAIL_INBOX_PROVIDER", default="microsoft365"),
        email_inbox_protocol=email_inbox_protocol,
        email_inbox_address=_env("RH_EMAIL_INBOX_ADDRESS"),
        email_inbox_imap_host=_env(
            "RH_EMAIL_INBOX_IMAP_HOST", default="outlook.office365.com"
        ),
        email_inbox_imap_port=_read_int_env(
            "RH_EMAIL_INBOX_IMAP_PORT", default=993, minimum=1, maximum=65535
        ),
        email_inbox_username=_env("RH_EMAIL_INBOX_USERNAME"),
        email_inbox_auth_mode=_env("RH_EMAIL_INBOX_AUTH_MODE", default="oauth2"),
        email_inbox_password_env=_env(
            "RH_EMAIL_INBOX_PASSWORD_ENV", default="RH_EMAIL_PASSWORD"
        ),
        email_inbox_mailbox=_env("RH_EMAIL_INBOX_MAILBOX", default="INBOX"),
        email_inbox_tenant_id=_env(
            "RH_EMAIL_INBOX_TENANT_ID", "RH_EMAIL_GRAPH_TENANT_ID"
        ),
        email_inbox_client_id=_env(
            "RH_EMAIL_INBOX_CLIENT_ID", "RH_EMAIL_GRAPH_CLIENT_ID"
        ),
        email_inbox_client_secret_env=_env(
            "RH_EMAIL_INBOX_CLIENT_SECRET_ENV", default="RH_EMAIL_CLIENT_SECRET"
        ),
        email_inbox_oauth_scope=_env(
            "RH_EMAIL_INBOX_SCOPES",
            "RH_EMAIL_INBOX_OAUTH_SCOPE",
            default="https://outlook.office365.com/.default",
        ),
        email_inbox_attachments_dir=_resolve_project_path(
            _env("RH_EMAIL_INBOX_ATTACHMENTS_DIR"), "data/private/email_attachments"
        ),
        email_inbox_max_messages=_read_int_env(
            "RH_EMAIL_INBOX_MAX_MESSAGES", default=50, minimum=1, maximum=500
        ),
        email_inbox_max_attachment_mb=_read_int_env(
            "RH_EMAIL_INBOX_MAX_ATTACHMENT_MB", default=10, minimum=1, maximum=100
        ),
        email_graph_tenant_id=_env("RH_EMAIL_GRAPH_TENANT_ID"),
        email_graph_client_id=_env("RH_EMAIL_GRAPH_CLIENT_ID"),
        email_graph_client_secret_env=_env(
            "RH_EMAIL_GRAPH_CLIENT_SECRET_ENV", default="RH_EMAIL_GRAPH_CLIENT_SECRET"
        ),
        email_graph_mailbox=_env("RH_EMAIL_GRAPH_MAILBOX"),
        email_graph_scope=_env(
            "RH_EMAIL_GRAPH_SCOPE", default="https://graph.microsoft.com/.default"
        ),
        email_graph_base_url=_env(
            "RH_EMAIL_GRAPH_BASE_URL", default="https://graph.microsoft.com/v1.0"
        ),
        email_send_client_secret_env=_env(
            "RH_EMAIL_SEND_CLIENT_SECRET_ENV", default="RH_EMAIL_GRAPH_CLIENT_SECRET"
        ),
        sharepoint_site_id=_env("RH_SHAREPOINT_SITE_ID"),
        sharepoint_drive_id=_env("RH_SHAREPOINT_DRIVE_ID"),
        sharepoint_tenant_id=_env("RH_SHAREPOINT_TENANT_ID", "MICROSOFT_TENANT_ID"),
        sharepoint_client_id=_env("RH_SHAREPOINT_CLIENT_ID", "MICROSOFT_CLIENT_ID"),
        sharepoint_client_secret_env=_env(
            "RH_SHAREPOINT_CLIENT_SECRET_ENV", default="MICROSOFT_CLIENT_SECRET"
        ),
        sharepoint_scope=_env(
            "RH_SHAREPOINT_SCOPE", default="https://graph.microsoft.com/.default"
        ),
        sharepoint_graph_base_url=_env(
            "RH_SHAREPOINT_GRAPH_BASE_URL", default="https://graph.microsoft.com/v1.0"
        ),
        email_smtp_enabled=_read_bool_env("RH_EMAIL_SMTP_ENABLED", default=False),
        email_smtp_host=_env("RH_EMAIL_SMTP_HOST"),
        email_smtp_port=_read_int_env(
            "RH_EMAIL_SMTP_PORT", default=587, minimum=1, maximum=65535
        ),
        email_smtp_username=_env("RH_EMAIL_SMTP_USERNAME"),
        email_smtp_password_env=_env(
            "RH_EMAIL_SMTP_PASSWORD_ENV", default="RH_EMAIL_APP_PASSWORD"
        ),
        email_smtp_from=_env("RH_EMAIL_SMTP_FROM"),
        email_smtp_use_tls=_read_bool_env("RH_EMAIL_SMTP_USE_TLS", default=True),
        email_smtp_use_ssl=_read_bool_env("RH_EMAIL_SMTP_USE_SSL", default=False),
        ai_enabled=_read_bool_env("AI_ENABLED", default=False),
        ai_provider=_env("AI_PROVIDER", default="openai").lower(),
        ai_model=_env("AI_MODEL"),
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        openai_base_url=_env(
            "OPENAI_BASE_URL", default="https://api.openai.com/v1"
        ).rstrip("/"),
        ai_timeout_seconds=_read_int_env(
            "AI_TIMEOUT_SECONDS", default=60, minimum=5, maximum=300
        ),
        ai_max_curriculo_chars=_read_int_env(
            "AI_MAX_CURRICULO_CHARS", default=30000, minimum=1000, maximum=100000
        ),
        ai_duplicate_window_seconds=_read_int_env(
            "AI_DUPLICATE_WINDOW_SECONDS", default=30, minimum=0, maximum=600
        ),
        scheduler_enabled=_read_bool_env("RH_SCHEDULER_ENABLED", default=True),
        scheduler_inactivity_interval_hours=_read_int_env(
            "RH_SCHEDULER_INACTIVITY_INTERVAL_HORAS", default=1, minimum=1, maximum=168
        ),
        scheduler_inactivity_dias_sem_movimentacao=_read_int_env(
            "RH_SCHEDULER_INACTIVITY_DIAS", default=30, minimum=1, maximum=365
        ),
        scheduler_inactivity_dias_realerta=_read_int_env(
            "RH_SCHEDULER_INACTIVITY_REALERTA_DIAS", default=7, minimum=1, maximum=365
        ),
        email_inactivity_alert_recipients=tuple(
            _split_csv(_env("RH_EMAIL_INACTIVITY_ALERT_RECIPIENTS"))
        ),
        # Redis é infraestrutura leve e opcional/degradável (CLAUDE.md,
        # roadmap "cache de queries" e "fila de tarefas assíncronas"): vazio
        # por padrão, o que desativa cache (rh_api/cache.py) e enfileiramento
        # (rh_api/task_queue.py) sem quebrar nada.
        redis_url=_env("RH_REDIS_URL", default=""),
    )
    validate_environment_database(
        settings.app_env,
        settings.sql_database,
        settings.sql_connection_string,
    )
    validate_production_security(settings)
    return settings

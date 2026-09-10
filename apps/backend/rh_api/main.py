from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import pyodbc
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .config import ConfigurationError, get_settings
from .logging_config import configure_logging
from .repositories import (
    bootstrap_runtime_schema,
    describe_database_error,
    is_deadlock_error,
)
from .routers.analytics import router as analytics_router
from .routers.auth import router as auth_router
from .routers.calendar import events_router as calendar_events_router, router as calendar_router
from .routers.curriculos_ia import router as curriculos_ia_router
from .routers.disc import public_router as disc_public_router
from .routers.disc import router as disc_router
from .routers.document_templates import router as document_templates_router
from .routers.documentos_biblioteca import router as documentos_biblioteca_router
from .routers.email_inbox import router as email_inbox_router
from .routers.email_send import router as email_send_router
from .routers.exam_analytics import router as exam_analytics_router
from .routers.fit_cultural import public_router as fit_cultural_public_router
from .routers.fit_cultural import router as fit_cultural_router
from .routers.generated_exams import public_router as generated_exams_public_router
from .routers.generated_exams import router as generated_exams_router
from .routers.history import router as history_router
from .routers.interviews import router as interviews_router
from .routers.onboarding import router as onboarding_router
from .routers.onedrive_files import router as onedrive_files_router
from .routers.notifications import router as notifications_router
from .routers.operations import router as operations_router
from .routers.pipeline import router as pipeline_router
from .routers.policies import router as policies_router
from .routers.processes import router as processes_router
from .routers.public_candidacy import router as public_candidacy_router
from .routers.raciocinio_logico import public_router as raciocinio_logico_public_router
from .routers.raciocinio_logico import router as raciocinio_logico_router
from .routers.scorecards import router as scorecards_router
from .routers.settings import router as settings_router
from .routers.sistema import router as sistema_router
from .routers.system import build_system_status, router as system_router
from .scheduler import start_scheduler, stop_scheduler
from conecta.interfaces.http.middlewares.request_context import (
    RequestContextMiddleware,
)


configure_logging()
logger = logging.getLogger(__name__)
FRONTEND_ASSET_DIRS = ("estilos", "fonte", "Exames")


def validate_web_session_configuration(settings) -> None:
    if not settings.session_secret_key:
        raise ConfigurationError(
            "FLASK_SECRET_KEY ou RH_SESSION_SECRET_KEY deve ser definida para a aplicação Web."
        )


def session_cookie_secure(settings) -> bool:
    return not settings.is_development


def _serialize_validation_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, dict):
        return {
            str(key): _serialize_validation_value(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple, set)):
        return [_serialize_validation_value(item) for item in value]

    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def _serialize_validation_error(error: dict) -> dict:
    return {
        str(key): _serialize_validation_value(value)
        for key, value in error.items()
    }


def _get_validation_message(error: dict) -> str:
    ctx = error.get("ctx")
    if isinstance(ctx, dict) and ctx.get("error"):
        return str(ctx["error"])
    return error.get("msg") or "Dados inválidos."


def _client_prefers_html(request: Request) -> bool:
    accept = request.headers.get("accept", "").lower()
    return "text/html" in accept


def _resolve_frontend_root(frontend_dir: str) -> Path:
    return Path(frontend_dir).expanduser().resolve()


def _is_frontend_available(frontend_root: Path) -> bool:
    return frontend_root.is_dir() and (frontend_root / "index.html").is_file()


def _resolve_frontend_file(frontend_root: Path, requested_path: str) -> Path | None:
    try:
        target = (frontend_root / requested_path).resolve()
        target.relative_to(frontend_root)
    except (OSError, ValueError):
        return None

    if target.is_file():
        return target
    return None


def _index_html_response(index_file: Path) -> FileResponse:
    # index.html referencia os assets versionados (?v=...); sem revalidar a
    # cada acesso, o navegador pode servir do cache heuristico um HTML antigo
    # apontando para JS/CSS que ja mudaram (ou paths ja corrigidos), causando
    # 404 e a tela em branco de "Nao foi possivel renderizar a interface
    # principal". FileResponse nao define Cache-Control por padrao.
    return FileResponse(index_file, headers={"Cache-Control": "no-cache"})


def _runtime_config_response(settings) -> Response:
    runtime_config = {
        "API_BASE_URL": settings.frontend_api_base_url,
        "PUBLIC_CANDIDATE_BASE_URL": settings.public_candidate_base_url,
        "PROCESS_DOSSIER_AI_ENDPOINT": settings.process_dossier_ai_endpoint,
        "APP_ENV": settings.app_env,
        "APP_VERSION": settings.app_version,
    }
    runtime_json = json.dumps(runtime_config, ensure_ascii=False, sort_keys=True)
    content = (
        f"window.RUNTIME_CONFIG = {{...(window.RUNTIME_CONFIG || {{}}), ...{runtime_json}}};\n"
        "window.__RH_API_BASE__ = window.RUNTIME_CONFIG.API_BASE_URL || '';\n"
        "window.__RH_PUBLIC_CANDIDATE_BASE_URL__ = "
        "window.RUNTIME_CONFIG.PUBLIC_CANDIDATE_BASE_URL || '';\n"
        "window.__RH_PROCESS_DOSSIER_AI_ENDPOINT__ = "
        "window.RUNTIME_CONFIG.PROCESS_DOSSIER_AI_ENDPOINT || '';\n"
    )
    return Response(
        content=content,
        media_type="application/javascript; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )


def _register_frontend_routes(app: FastAPI, settings) -> None:
    if not settings.serve_frontend:
        logger.info("Servico do frontend desativado por configuracao.")

        @app.get("/", include_in_schema=False)
        def root_status():
            return build_system_status(settings)

        return

    frontend_root = _resolve_frontend_root(settings.frontend_dir)
    if not _is_frontend_available(frontend_root):
        logger.warning(
            "Interface web não localizada em '%s'. A raiz continuará respondendo status da API.",
            frontend_root,
        )

        @app.get("/", include_in_schema=False)
        def root_status_without_frontend():
            return build_system_status(settings)

        return

    index_file = frontend_root / "index.html"

    for asset_dir in FRONTEND_ASSET_DIRS:
        directory = frontend_root / asset_dir
        if directory.is_dir():
            app.mount(
                f"/{asset_dir}",
                StaticFiles(directory=str(directory)),
                name=f"frontend_{asset_dir.lower()}",
            )

    @app.get("/", include_in_schema=False)
    def root_entrypoint(request: Request):
        if _client_prefers_html(request):
            return _index_html_response(index_file)
        return JSONResponse(build_system_status(settings))

    @app.get("/index.html", include_in_schema=False)
    def frontend_index():
        return _index_html_response(index_file)

    @app.get("/runtime-config.js", include_in_schema=False)
    def runtime_config():
        return _runtime_config_response(settings)

    @app.get("/Front/runtime-config.js", include_in_schema=False)
    def legacy_runtime_config():
        return _runtime_config_response(settings)

    app.mount(
        "/Front",
        StaticFiles(directory=str(frontend_root), html=True),
        name="frontend_legacy_front",
    )

    @app.get("/{frontend_path:path}", include_in_schema=False)
    def frontend_fallback(frontend_path: str, request: Request):
        static_file = _resolve_frontend_file(frontend_root, frontend_path)
        if static_file:
            return FileResponse(static_file)

        if _client_prefers_html(request) and not Path(frontend_path).suffix:
            return _index_html_response(index_file)

        raise HTTPException(status_code=404, detail="Tela não encontrada.")


def create_app() -> FastAPI:
    settings = get_settings()
    validate_web_session_configuration(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.schema_bootstrap_enabled:
            try:
                bootstrap_runtime_schema(settings)
            except pyodbc.Error as exc:
                logger.exception(
                    "Falha ao preparar o schema complementar do RH na inicialização: %s",
                    describe_database_error(exc),
                )
            except Exception as exc:
                logger.exception(
                    "Falha ao preparar o schema complementar do RH na inicialização: %s",
                    exc,
                )
        else:
            logger.info("Bootstrap automático de schema desativado; use migrations versionadas.")

        scheduler = start_scheduler(settings)
        try:
            yield
        finally:
            stop_scheduler(scheduler)

    app = FastAPI(title="Conecta C24h API", lifespan=lifespan)

    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret_key,
        session_cookie="conecta_microsoft_session",
        max_age=600,
        path="/",
        same_site="lax",
        https_only=session_cookie_secure(settings),
        domain=None,
    )
    @app.middleware("http")
    async def disable_frontend_cache(request: Request, call_next):
        response = await call_next(request)
        if request.method == "GET" and any(
            request.url.path == f"/{asset_dir}" or request.url.path.startswith(f"/{asset_dir}/")
            for asset_dir in (*FRONTEND_ASSET_DIRS, "Front")
        ):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_origin_regex=settings.cors_allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(_: Request, exc: HTTPException):
        message = exc.detail if isinstance(exc.detail, str) else "Falha ao processar a requisicao."
        logger.warning("Falha HTTP %s: %s", exc.status_code, message)
        return JSONResponse(
            status_code=exc.status_code,
            content={"success": False, "message": message},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_exception(_: Request, exc: RequestValidationError):
        errors = [_serialize_validation_error(error) for error in exc.errors()]
        first_error = errors[0] if errors else {}
        loc = ".".join(str(item) for item in first_error.get("loc", []) if item not in {"body", "query", "path"})
        message = _get_validation_message(first_error)
        if loc:
            message = f"{loc}: {message}"

        logger.warning("Falha de validação na API: %s", errors)
        return JSONResponse(
            status_code=422,
            content={"success": False, "message": message, "details": errors},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(_: Request, exc: Exception):
        logger.exception("Erro não tratado na API: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": "Erro interno do servidor."},
        )

    @app.exception_handler(pyodbc.Error)
    async def handle_database_exception(_: Request, exc: pyodbc.Error):
        detailed_message = describe_database_error(exc)
        if is_deadlock_error(exc):
            logger.warning(
                "Deadlock não tratado interceptado pela API: %s",
                detailed_message,
            )
            return JSONResponse(
                status_code=503,
                content={
                    "success": False,
                    "message": "O banco de dados ficou temporariamente indisponível por conflito de concorrência. Tente novamente em instantes.",
                },
            )

        logger.exception(
            "Erro de banco de dados não tratado: %s",
            detailed_message,
        )
        message = "Falha ao acessar o banco de dados."
        if settings.is_development and detailed_message:
            message = f"{message} {detailed_message}"
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": message},
        )

    app.include_router(system_router)
    app.include_router(auth_router)
    app.include_router(curriculos_ia_router)
    app.include_router(history_router)
    app.include_router(email_inbox_router)
    app.include_router(generated_exams_router)
    app.include_router(generated_exams_public_router)
    app.include_router(exam_analytics_router)
    app.include_router(processes_router)
    app.include_router(scorecards_router)
    app.include_router(public_candidacy_router)
    app.include_router(interviews_router)
    app.include_router(analytics_router)
    app.include_router(pipeline_router)
    app.include_router(policies_router)
    app.include_router(calendar_router)
    app.include_router(calendar_events_router)
    app.include_router(onboarding_router)
    app.include_router(notifications_router)
    app.include_router(document_templates_router)
    app.include_router(documentos_biblioteca_router)
    app.include_router(disc_router)
    app.include_router(disc_public_router)
    app.include_router(fit_cultural_router)
    app.include_router(fit_cultural_public_router)
    app.include_router(raciocinio_logico_router)
    app.include_router(raciocinio_logico_public_router)
    app.include_router(settings_router)
    app.include_router(sistema_router)
    app.include_router(operations_router)
    app.include_router(onedrive_files_router)
    app.include_router(email_send_router)
    _register_frontend_routes(app, settings)

    logger.info(
        "Aplicação inicializada no ambiente '%s' com banco '%s/%s'.",
        settings.app_env,
        settings.sql_server,
        settings.sql_database,
    )
    return app


app = create_app()

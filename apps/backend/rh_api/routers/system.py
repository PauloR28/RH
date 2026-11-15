from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..config import Settings, get_settings
from ..db import get_connection
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository

router = APIRouter(tags=["system"])


def build_system_status(settings: Settings | None = None) -> dict:
    active_settings = settings or get_settings()
    return {
        "status": "ok",
        "message": "API RH Provas online",
        "server": active_settings.sql_server,
        "database": active_settings.sql_database,
        "environment": active_settings.app_env,
    }


@router.get("/api/status", dependencies=[Depends(get_current_user)])
def api_status():
    return build_system_status()


@router.get("/health")
def health():
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.service_name,
        "environment": settings.app_env,
    }


@router.get("/ready")
def ready():
    settings = get_settings()
    try:
        connection = get_connection(settings)
        try:
            cursor = connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
        finally:
            connection.close()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dependência de banco indisponível.",
        ) from exc
    return {"status": "ready", "service": settings.service_name}


@router.get("/version", dependencies=[Depends(get_current_user)])
def version():
    settings = get_settings()
    return {
        "service": settings.service_name,
        "version": settings.app_version,
        "environment": settings.app_env,
    }


@router.get("/metrics", include_in_schema=False)
def metrics():
    settings = get_settings()
    content = (
        "# HELP conecta_info Informações estáticas da aplicação.\n"
        "# TYPE conecta_info gauge\n"
        f'conecta_info{{service="{settings.service_name}",environment="{settings.app_env}",version="{settings.app_version}"}} 1\n'
    )
    return Response(content=content, media_type="text/plain; version=0.0.4")


@router.get("/debug/gabaritos-columns", dependencies=[Depends(require_permissions("logs.visualizar"))])
def debug_gabaritos_columns(
    repository: DatabaseRepository = Depends(get_repository),
    _user=Depends(get_current_user),
):
    return repository.get_gabaritos_columns()


@router.get("/debug/historico-provas-columns", dependencies=[Depends(require_permissions("logs.visualizar"))])
def debug_historico_provas_columns(
    repository: DatabaseRepository = Depends(get_repository),
    _user=Depends(get_current_user),
):
    settings = get_settings()
    if not settings.is_development:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Endpoint disponível apenas em ambiente de desenvolvimento.",
        )

    return repository.get_history_columns()

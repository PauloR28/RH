from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.exam_analytics import AnalyticalCategoryMappingsRequest, AnalyticalWeightsRequest, IdealProfileRequest

router = APIRouter(
    prefix="/processes/{process_id}/analytical-results",
    tags=["exam-analytics"],
    dependencies=[Depends(get_current_user)],
)

ProcessId = Annotated[str, Path(min_length=1, max_length=220)]
CandidateId = Annotated[str, Path(min_length=1, max_length=180)]


def _user_label(user: AuthenticatedUser) -> str:
    return user.nome or user.usuario or user.email or "RH"


@router.get("", dependencies=[Depends(require_permissions("provas.visualizar"))])
def list_results(
    process_id: ProcessId,
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=5, le=100),
    search: str = Query(default="", max_length=180),
    status_filter: str = Query(default="", alias="status", max_length=40),
    stage: str = Query(default="", max_length=120),
    category: str = Query(default="", max_length=120),
    flag: str = Query(default="", max_length=120),
    score_min: float | None = Query(default=None, ge=0, le=100),
    score_max: float | None = Query(default=None, ge=0, le=100),
    adherence_min: float | None = Query(default=None, ge=0, le=100),
    adherence_max: float | None = Query(default=None, ge=0, le=100),
    pending_analysis: bool | None = Query(default=None),
    comparable: bool | None = Query(default=None),
    manual_correction: bool | None = Query(default=None),
    sort: str = Query(default="ranking", max_length=40),
    direction: str = Query(default="desc", pattern="^(?i:asc|desc)$"),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.list_process_analytical_results(
        process_id,
        {
            "page": page, "page_size": page_size, "search": search, "status": status_filter,
            "stage": stage, "category": category, "flag": flag,
            "score_min": score_min, "score_max": score_max,
            "adherence_min": adherence_min, "adherence_max": adherence_max,
            "pending_analysis": pending_analysis, "comparable": comparable,
            "manual_correction": manual_correction, "sort": sort, "direction": direction,
        },
    )
    audit_action(repository, user, modulo="Provas", acao="consultar_resultados_analiticos", entidade="processo", entidade_id=process_id, valor_novo={"page": page, "filtersApplied": bool(search or status_filter or stage or category or flag or score_min is not None or score_max is not None or adherence_min is not None or adherence_max is not None or pending_analysis is not None or comparable is not None or manual_correction is not None)}, request=request)
    return result


@router.get("/status", dependencies=[Depends(require_permissions("provas.visualizar"))])
def get_status(process_id: ProcessId, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_process_analytical_status(process_id)


@router.get("/configuration", dependencies=[Depends(require_permissions("provas.visualizar"))])
def get_configuration(process_id: ProcessId, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_process_analytics_configuration(process_id)


@router.put("/weights", dependencies=[Depends(require_permissions("provas.configurar_pesos"))])
def update_weights(
    process_id: ProcessId,
    payload: AnalyticalWeightsRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_process_analytics_weights(process_id, payload.model_dump(), updated_by=_user_label(user))
    audit_action(repository, user, modulo="Provas", acao="configurar_pesos_analiticos", entidade="processo", entidade_id=process_id, valor_novo={"version": result.get("version"), "categoryCount": len(payload.weights)}, request=request)
    return result


@router.put("/ideal-profile", dependencies=[Depends(require_permissions("provas.configurar_pesos"))])
def update_ideal_profile(
    process_id: ProcessId,
    payload: IdealProfileRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_process_ideal_profile(process_id, payload.model_dump(), updated_by=_user_label(user))
    audit_action(repository, user, modulo="Provas", acao="configurar_perfil_ideal_analitico", entidade="processo", entidade_id=process_id, valor_novo={"version": result.get("version"), "categoryCount": len(payload.ideal_profile)}, request=request)
    return result


@router.put("/categories", dependencies=[Depends(require_permissions("provas.configurar_pesos"))])
def update_category_mappings(
    process_id: ProcessId,
    payload: AnalyticalCategoryMappingsRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_process_category_mappings(process_id, payload.model_dump(), updated_by=_user_label(user))
    audit_action(repository, user, modulo="Provas", acao="configurar_categorias_analiticas", entidade="processo", entidade_id=process_id, valor_novo={"version": result.get("version"), "mappingCount": len(payload.mappings)}, request=request)
    return result


@router.get("/compare", dependencies=[Depends(require_permissions("provas.visualizar"))])
def compare_candidates(
    process_id: ProcessId,
    request: Request,
    candidate_ids: list[str] = Query(default=[]),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.compare_process_candidates(process_id, candidate_ids)
    audit_action(repository, user, modulo="Provas", acao="comparar_resultados_analiticos", entidade="processo", entidade_id=process_id, valor_novo={"candidateCount": len(candidate_ids)}, request=request)
    return result


@router.get("/candidates/{candidate_id}", dependencies=[Depends(require_permissions("provas.visualizar"))])
def get_candidate_detail(
    process_id: ProcessId,
    candidate_id: CandidateId,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.get_candidate_analytical_detail(process_id, candidate_id)
    audit_action(repository, user, modulo="Provas", acao="consultar_detalhe_analitico", entidade="candidato_processo", entidade_id=f"{process_id}:{candidate_id}", request=request)
    return result

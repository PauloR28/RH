from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.pipeline import PipelineCardCreateRequest, PipelineCardMoveRequest

router = APIRouter(tags=["pipeline"], dependencies=[Depends(get_current_user)])


@router.get("/candidate-pipeline", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def get_candidate_pipeline(
    id_processo: str = Query(default=""),
    search: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_pipeline_cards(id_processo=id_processo, search=search)


@router.post("/candidate-pipeline", dependencies=[Depends(require_permissions("candidatos.criar"))])
def create_candidate_pipeline_card(
    payload: PipelineCardCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_pipeline_candidate(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="criar_card_pipeline",
        entidade="pipeline",
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/candidate-pipeline/{id_registro}/stage", dependencies=[Depends(require_permissions("candidatos.mover_etapa"))])
def move_candidate_pipeline_card(
    id_registro: int,
    payload: PipelineCardMoveRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.move_pipeline_card(id_registro, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="mover_pipeline",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/candidate-pipeline/{id_registro}", dependencies=[Depends(require_permissions("candidatos.excluir"))])
def delete_candidate_pipeline_card(
    id_registro: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_pipeline_card(id_registro)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="excluir_card_pipeline",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
    )
    return result

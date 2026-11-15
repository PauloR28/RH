from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.interviews import (
    InterviewCreateRequest,
    InterviewSlotCreateRequest,
    InterviewSlotUpdateRequest,
    InterviewUpdateRequest,
)

router = APIRouter(tags=["interviews"], dependencies=[Depends(get_current_user)])


@router.get("/interviews", dependencies=[Depends(require_permissions("entrevistas.visualizar"))])
def get_interviews(
    id_processo: str = Query(default=""),
    status_entrevista: str = Query(default=""),
    search: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_interviews(
        id_processo=id_processo,
        status_entrevista=status_entrevista,
        search=search,
    )


@router.get("/interview-slots", dependencies=[Depends(require_permissions("entrevistas.visualizar"))])
def get_interview_slots(
    id_processo: str = Query(default=""),
    date: str = Query(default=""),
    status_slot: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_interview_slots(
        id_processo=id_processo,
        date=date,
        status_slot=status_slot,
    )


@router.post("/interview-slots", dependencies=[Depends(require_permissions("entrevistas.configurar"))])
def create_interview_slots(
    payload: InterviewSlotCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_interview_slots(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Entrevistas",
        acao="criar_horarios_entrevista",
        entidade="entrevista_slots",
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/interview-slots/{id_slot}", dependencies=[Depends(require_permissions("entrevistas.configurar"))])
def update_interview_slot(
    id_slot: int,
    payload: InterviewSlotUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_interview_slot(id_slot, payload.model_dump(exclude_none=True), user=user)
    audit_action(
        repository,
        user,
        modulo="Entrevistas",
        acao="editar_horario_entrevista",
        entidade="entrevista_slot",
        entidade_id=str(id_slot),
        valor_novo=payload.model_dump(exclude_none=True),
    )
    return result


@router.delete("/interview-slots/{id_slot}", dependencies=[Depends(require_permissions("entrevistas.configurar"))])
def delete_interview_slot(
    id_slot: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_interview_slot(id_slot)
    audit_action(
        repository,
        user,
        modulo="Entrevistas",
        acao="excluir_horario_entrevista",
        entidade="entrevista_slot",
        entidade_id=str(id_slot),
    )
    return result


@router.post("/interviews", dependencies=[Depends(require_permissions("entrevistas.criar"))])
def create_interview(
    payload: InterviewCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_interview(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Entrevistas",
        acao="agendar_entrevista",
        entidade="entrevista",
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/interviews/{id_entrevista}", dependencies=[Depends(require_permissions("entrevistas.editar", "entrevistas.cancelar", "entrevistas.marcar_presenca"))])
def update_interview(
    id_entrevista: int,
    payload: InterviewUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_interview(id_entrevista, payload.model_dump(exclude_none=True))
    audit_action(
        repository,
        user,
        modulo="Entrevistas",
        acao="atualizar_entrevista",
        entidade="entrevista",
        entidade_id=str(id_entrevista),
        valor_novo=payload.model_dump(exclude_none=True),
    )
    return result

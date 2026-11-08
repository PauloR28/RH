from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.policies import PolicyCreateRequest, PolicyUpdateRequest

router = APIRouter(prefix="/policies", tags=["policies"], dependencies=[Depends(get_current_user)])


@router.get("", dependencies=[Depends(require_permissions("politicas.visualizar", "politicas.editar"))])
def list_policies(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_policies()


@router.post("", dependencies=[Depends(require_permissions("politicas.editar"))])
def create_policy(
    payload: PolicyCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_policy(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Políticas",
        acao="criar_politica",
        entidade="politica",
        entidade_id=str(result.get("id_politica") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/{id_politica}", dependencies=[Depends(require_permissions("politicas.editar"))])
def update_policy(
    id_politica: int,
    payload: PolicyUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_policy(id_politica, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Políticas",
        acao="editar_politica",
        entidade="politica",
        entidade_id=str(id_politica),
        valor_novo=payload.model_dump(),
    )
    return result


@router.get("/pending")
def get_pending_policy(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    politica = repository.get_pending_policy_for_user(
        id_usuario=user.id_usuario,
        usuario_login=user.username,
    )
    return politica or {}


@router.post("/{id_politica}/confirm")
def confirm_policy_reading(
    id_politica: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.confirm_policy_reading(
        id_politica,
        id_usuario=user.id_usuario,
        usuario_login=user.username,
        usuario_nome=user.nome,
    )
    audit_action(
        repository,
        user,
        modulo="Políticas",
        acao="confirmar_leitura_politica",
        entidade="politica",
        entidade_id=str(id_politica),
    )
    return result

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..repositories.scorecards import SCORECARD_CRITERIOS_PADRAO
from ..schemas.scorecards import ScorecardSaveRequest

router = APIRouter(tags=["scorecards"], dependencies=[Depends(get_current_user)])


@router.get(
    "/process-candidates/{id_registro}/scorecard/criterios",
    dependencies=[Depends(require_permissions("candidatos.visualizar"))],
)
def get_scorecard_criterios_padrao():
    """Critérios padrão do scorecard (fixos nesta v1 - ver nota no repositório)."""
    return {"criterios": SCORECARD_CRITERIOS_PADRAO}


@router.get(
    "/process-candidates/{id_registro}/scorecard",
    dependencies=[Depends(require_permissions("candidatos.visualizar"))],
)
def get_candidate_scorecard_history(
    id_registro: int,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_candidate_scorecards(id_registro)


@router.put(
    "/process-candidates/{id_registro}/scorecard",
    dependencies=[Depends(require_permissions("candidatos.mover_etapa", "candidatos.editar", "candidatos.editar_basico"))],
)
def save_candidate_scorecard(
    id_registro: int,
    payload: ScorecardSaveRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.save_candidate_scorecard(
        id_registro,
        payload.model_dump(),
        avaliado_por=user.username if isinstance(user, AuthenticatedUser) else "",
    )
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="salvar_scorecard",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload.model_dump(),
    )
    return result

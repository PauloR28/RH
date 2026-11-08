from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.fit_cultural import (
    FitCulturalResponderRequest,
    ValorEmpresaCreateRequest,
    ValorEmpresaUpdateRequest,
)

router = APIRouter(prefix="/fit-cultural", tags=["fit-cultural"], dependencies=[Depends(get_current_user)])
public_router = APIRouter(prefix="/fit-cultural-api", tags=["fit-cultural-public"])


@router.get("/valores", dependencies=[Depends(require_permissions("fit_cultural.visualizar", "fit_cultural.editar"))])
def list_valores_empresa(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_valores_empresa()


@router.post("/valores", dependencies=[Depends(require_permissions("fit_cultural.editar"))])
def create_valor_empresa(
    payload: ValorEmpresaCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_valor_empresa(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Fit Cultural",
        acao="criar_valor_empresa",
        entidade="valor_empresa",
        entidade_id=str(result.get("id_valor") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/valores/{id_valor}", dependencies=[Depends(require_permissions("fit_cultural.editar"))])
def update_valor_empresa(
    id_valor: int,
    payload: ValorEmpresaUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_valor_empresa(id_valor, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Fit Cultural",
        acao="editar_valor_empresa",
        entidade="valor_empresa",
        entidade_id=str(id_valor),
        valor_novo=payload.model_dump(),
    )
    return result


@router.get(
    "/candidatos/{candidato_processo_id}/resultado",
    dependencies=[Depends(require_permissions("fit_cultural.visualizar", "fit_cultural.editar"))],
)
def get_fit_cultural_resultado(candidato_processo_id: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_fit_cultural_resultado(candidato_processo_id)


# ----------------------------------------------------------------------
# Rotas públicas (resposta do candidato ao questionário de fit cultural)
# ----------------------------------------------------------------------
@public_router.get("/frases")
def public_list_fit_cultural_frases(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_fit_cultural_frases_ativas()


@public_router.post("/respostas")
def public_submit_fit_cultural_respostas(
    payload: FitCulturalResponderRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.submit_fit_cultural_respostas(payload.model_dump())

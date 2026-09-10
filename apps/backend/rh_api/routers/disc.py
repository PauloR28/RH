from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.disc import (
    DiscAplicacaoCreateRequest,
    DiscBlocoCreateRequest,
    DiscBlocoUpdateRequest,
    DiscFinalizarRequest,
)


router = APIRouter(prefix="/disc", tags=["disc"], dependencies=[Depends(get_current_user)])
public_router = APIRouter(prefix="/disc-api", tags=["disc-public"])


@router.get("/blocos", dependencies=[Depends(require_permissions("provas.visualizar"))])
def list_disc_blocos(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_disc_blocos()


@router.post("/blocos", dependencies=[Depends(require_permissions("provas.questoes_criar"))])
def create_disc_bloco(
    payload: DiscBlocoCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_disc_bloco(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - DISC",
        acao="criar_bloco_disc",
        entidade="disc_bloco",
        entidade_id=str(result.get("id_bloco") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/blocos/{id_bloco}", dependencies=[Depends(require_permissions("provas.questoes_criar"))])
def update_disc_bloco(
    id_bloco: int,
    payload: DiscBlocoUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_disc_bloco(id_bloco, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - DISC",
        acao="editar_bloco_disc",
        entidade="disc_bloco",
        entidade_id=str(id_bloco),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post("/aplicacoes", dependencies=[Depends(require_permissions("provas.enviar"))])
def create_disc_aplicacao(
    payload: DiscAplicacaoCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_disc_aplicacao(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - DISC",
        acao="gerar_aplicacao_disc",
        entidade="disc_aplicacao",
        entidade_id=str(result.get("id_aplicacao") or ""),
        valor_novo={"id_teste": payload.id_teste},
    )
    return result


@router.get("/aplicacoes/{id_aplicacao}", dependencies=[Depends(require_permissions("provas.visualizar"))])
def get_disc_aplicacao(id_aplicacao: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_disc_aplicacao(id_aplicacao)


@router.get("/candidatos/{id_teste}/resultado", dependencies=[Depends(require_permissions("provas.visualizar"))])
def get_disc_resultado_candidato(id_teste: str, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_disc_resultado_candidato(id_teste)


# ----------------------------------------------------------------------
# Rotas públicas (aplicação do teste pelo candidato, sem autenticação de RH)
# ----------------------------------------------------------------------
@public_router.get("/aplicacoes/{id_aplicacao}")
def public_get_disc_aplicacao(id_aplicacao: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_disc_aplicacao(id_aplicacao)


@public_router.post("/aplicacoes/{id_aplicacao}/finalizar")
def public_finalize_disc_aplicacao(
    id_aplicacao: int,
    payload: DiscFinalizarRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.finalize_disc_aplicacao(id_aplicacao, payload.model_dump())

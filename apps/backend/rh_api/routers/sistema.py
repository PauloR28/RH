from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..rbac import ACCESS_DENIED_MESSAGE, ROLE_ADMIN
from ..repositories import DatabaseRepository
from ..schemas.sistema import (
    AmbienteSharePointRequest,
    ParametroSistemaRequest,
    ResetarDadosConectaRequest,
)


router = APIRouter(prefix="/sistema", tags=["sistema"])


@router.get("/parametros", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def get_parametros_sistema(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_parametros_sistema()


@router.put("/parametros/{chave}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def put_parametro_sistema(
    chave: str,
    payload: ParametroSistemaRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.upsert_parametro_sistema(chave, payload.model_dump(), actor=user)


@router.get(
    "/parametros/infraestrutura",
    dependencies=[Depends(require_permissions("configuracoes.visualizar"))],
)
def get_parametros_infraestrutura(repository: DatabaseRepository = Depends(get_repository)):
    return repository.describe_infraestrutura_credenciais()


@router.get(
    "/ambientes-sharepoint",
    dependencies=[Depends(require_permissions("configuracoes.visualizar"))],
)
def get_ambientes_sharepoint(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_ambientes_sharepoint()


@router.post(
    "/ambientes-sharepoint",
    dependencies=[Depends(require_permissions("configuracoes.editar"))],
)
def post_ambiente_sharepoint(
    payload: AmbienteSharePointRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.criar_ambiente_sharepoint(payload.model_dump(), actor=user)


@router.put(
    "/ambientes-sharepoint/{id_ambiente}",
    dependencies=[Depends(require_permissions("configuracoes.editar"))],
)
def put_ambiente_sharepoint(
    id_ambiente: int,
    payload: AmbienteSharePointRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.atualizar_ambiente_sharepoint(id_ambiente, payload.model_dump(), actor=user)


@router.post(
    "/ambientes-sharepoint/{id_ambiente}/testar",
    dependencies=[Depends(require_permissions("configuracoes.editar"))],
)
def post_testar_ambiente_sharepoint(
    id_ambiente: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.testar_ambiente_sharepoint(id_ambiente, actor=user)


@router.delete(
    "/ambientes-sharepoint/{id_ambiente}",
    dependencies=[Depends(require_permissions("configuracoes.editar"))],
)
def delete_ambiente_sharepoint(
    id_ambiente: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.excluir_ambiente_sharepoint(id_ambiente, actor=user, justificativa=justificativa)


@router.post("/resetar", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def resetar_dados_conecta(
    payload: ResetarDadosConectaRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    # Restrito ao papel Administrador em código — não pode ser delegado via a
    # tela de Perfis e permissões, mesmo que alguém marque a permissão acima
    # para outro papel (Correções.txt: "botão... fica restrito ao ADM apenas").
    if user.perfil != ROLE_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCESS_DENIED_MESSAGE)
    return repository.resetar_dados_conecta(actor=user, confirmacao=payload.confirmacao)

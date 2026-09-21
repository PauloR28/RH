from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.documentos_biblioteca import (
    DocumentoBibliotecaCreateRequest,
    DocumentoBibliotecaUpdateRequest,
)


router = APIRouter(prefix="/documentos-biblioteca", tags=["documentos-biblioteca"], dependencies=[Depends(get_current_user)])


@router.get("", dependencies=[Depends(require_permissions("documentos_biblioteca.visualizar"))])
def list_documentos_biblioteca(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_documentos_biblioteca()


@router.post("", dependencies=[Depends(require_permissions("documentos_biblioteca.editar"))])
def create_documento_biblioteca(
    payload: DocumentoBibliotecaCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_documento_biblioteca(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Central de Ajuda",
        acao="criar_documento_biblioteca",
        entidade="documento_biblioteca",
        entidade_id=str(result.get("id_documento") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/{id_documento}", dependencies=[Depends(require_permissions("documentos_biblioteca.editar"))])
def update_documento_biblioteca(
    id_documento: int,
    payload: DocumentoBibliotecaUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_documento_biblioteca(id_documento, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Central de Ajuda",
        acao="editar_documento_biblioteca",
        entidade="documento_biblioteca",
        entidade_id=str(id_documento),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/{id_documento}", dependencies=[Depends(require_permissions("documentos_biblioteca.editar"))])
def delete_documento_biblioteca(
    id_documento: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_documento_biblioteca(id_documento)
    audit_action(
        repository,
        user,
        modulo="Central de Ajuda",
        acao="excluir_documento_biblioteca",
        entidade="documento_biblioteca",
        entidade_id=str(id_documento),
    )
    return result

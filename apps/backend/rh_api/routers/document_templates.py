from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.document_templates import (
    DocumentTemplateCreateRequest,
    DocumentTemplateUpdateRequest,
    GenerateDocumentRequest,
)
from ..services.document_template_engine import SUPPORTED_VARIABLES

router = APIRouter(prefix="/document-templates", tags=["document-templates"], dependencies=[Depends(get_current_user)])


@router.get("/variables", dependencies=[Depends(require_permissions("documentos_templates.visualizar", "documentos_templates.editar"))])
def list_supported_variables():
    return [{"variavel": chave, "descricao": descricao} for chave, descricao in SUPPORTED_VARIABLES.items()]


@router.get("", dependencies=[Depends(require_permissions("documentos_templates.visualizar", "documentos_templates.editar"))])
def list_document_templates(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_document_templates()


@router.get("/{id_template}", dependencies=[Depends(require_permissions("documentos_templates.visualizar", "documentos_templates.editar"))])
def get_document_template(id_template: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_document_template(id_template)


@router.post("", dependencies=[Depends(require_permissions("documentos_templates.editar"))])
def create_document_template(
    payload: DocumentTemplateCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_document_template(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Templates de Documentos",
        acao="criar_template_documento",
        entidade="template_documento",
        entidade_id=str(result.get("id_template") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/{id_template}", dependencies=[Depends(require_permissions("documentos_templates.editar"))])
def update_document_template(
    id_template: int,
    payload: DocumentTemplateUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_document_template(id_template, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Templates de Documentos",
        acao="editar_template_documento",
        entidade="template_documento",
        entidade_id=str(id_template),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/{id_template}", dependencies=[Depends(require_permissions("documentos_templates.editar"))])
def delete_document_template(
    id_template: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_document_template(id_template)
    audit_action(
        repository,
        user,
        modulo="Templates de Documentos",
        acao="excluir_template_documento",
        entidade="template_documento",
        entidade_id=str(id_template),
    )
    return result


@router.post("/gerar", dependencies=[Depends(require_permissions("documentos_templates.visualizar", "documentos_templates.editar"))])
def generate_document(
    payload: GenerateDocumentRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.generate_document(
        payload.template_id,
        payload.id_registro,
        variaveis_extra=payload.variaveis_extra,
    )
    audit_action(
        repository,
        user,
        modulo="Templates de Documentos",
        acao="gerar_documento",
        entidade="documento_gerado",
        entidade_id=str(payload.id_registro),
        valor_novo={"template_id": payload.template_id},
    )
    return result

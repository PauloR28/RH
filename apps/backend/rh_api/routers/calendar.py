from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from ..auth import AuthenticatedUser
from ..config import Settings, get_settings
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.calendar import CelebratoryDateCreateRequest, CelebratoryDateUpdateRequest
from ..services.training_uploads import CATEGORIA_IMAGEM, save_training_upload, validate_training_upload


router = APIRouter(prefix="/celebratory-dates", tags=["calendar"], dependencies=[Depends(get_current_user)])
events_router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[Depends(get_current_user)])

# Imagem do evento: sem exigir login na leitura (mesmo motivo do Mural — uma
# tag <img> do navegador não manda o header Authorization). Nome de arquivo é
# um token aleatório, não sequencial.
public_router = APIRouter(prefix="/celebratory-dates", tags=["calendar-imagens-publicas"])
_NOME_ARQUIVO_IMAGEM_PATTERN = re.compile(r"^[a-z0-9]{4,20}\.(png|jpg|jpeg)$")


@router.get("")
def list_celebratory_dates(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_celebratory_dates()


@router.get("/ambientes", dependencies=[Depends(require_permissions("calendario.editar"))])
def list_celebratory_dates_ambientes(repository: DatabaseRepository = Depends(get_repository)):
    """Intranets (SharePoint) já conectadas — mesmo catálogo usado pelo Mural
    (dbo.ambientes_sharepoint), reaproveitado aqui para o seletor de destino
    do evento (Correções.txt item 10)."""
    return {"itens": repository.list_mural_ambientes_disponiveis()}


@router.get("/endereco-empresa", dependencies=[Depends(require_permissions("calendario.editar"))])
def get_endereco_empresa(repository: DatabaseRepository = Depends(get_repository)):
    """Endereço principal da empresa, para sugerir no campo "Local" do
    evento — ver resposta do RH no Correções.txt item 10."""
    return {"endereco": repository.get_endereco_empresa_formatado()}


@router.post("/imagens", dependencies=[Depends(require_permissions("calendario.editar"))])
async def upload_celebratory_date_imagem(
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    content = await arquivo.read()
    upload = validate_training_upload(
        original_filename=arquivo.filename or "imagem.png",
        content=content,
        categoria=CATEGORIA_IMAGEM,
        max_bytes=settings.training_upload_max_document_mb * 1024 * 1024,
    )
    save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="calendario-imagens")
    audit_action(
        repository,
        user,
        modulo="Calendário",
        acao="upload_imagem_evento",
        entidade="data_comemorativa",
        entidade_id="",
        valor_novo={"nome_arquivo": upload.original_filename},
    )
    return {"url": f"/celebratory-dates/imagens/{upload.stored_filename}", "nome_arquivo": upload.original_filename}


@public_router.get("/imagens/{nome_arquivo}")
def baixar_celebratory_date_imagem(nome_arquivo: str, settings: Settings = Depends(get_settings)):
    if not _NOME_ARQUIVO_IMAGEM_PATTERN.fullmatch(nome_arquivo):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagem não encontrada.")
    caminho = Path(settings.training_upload_dir) / "calendario-imagens" / nome_arquivo
    if not caminho.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagem não encontrada.")
    return FileResponse(caminho)


@events_router.get("/events")
def list_calendar_events(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_calendar_events(include_interviews=user.has_permission("entrevistas.visualizar"))


@router.post("", dependencies=[Depends(require_permissions("calendario.editar"))])
def create_celebratory_date(
    payload: CelebratoryDateCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_celebratory_date(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Calendário",
        acao="criar_data_comemorativa",
        entidade="data_comemorativa",
        entidade_id=str(result.get("id_data") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/{id_data}", dependencies=[Depends(require_permissions("calendario.editar"))])
def update_celebratory_date(
    id_data: int,
    payload: CelebratoryDateUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_celebratory_date(id_data, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Calendário",
        acao="editar_data_comemorativa",
        entidade="data_comemorativa",
        entidade_id=str(id_data),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/{id_data}", dependencies=[Depends(require_permissions("calendario.editar"))])
def delete_celebratory_date(
    id_data: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_celebratory_date(id_data, actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Calendário",
        acao="excluir_data_comemorativa",
        entidade="data_comemorativa",
        entidade_id=str(id_data),
        justificativa=justificativa,
    )
    return result

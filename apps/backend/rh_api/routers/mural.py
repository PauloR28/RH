from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from ..auth import AuthenticatedUser
from ..config import Settings, get_settings
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.mural import (
    MuralPublicacaoCreateRequest,
    MuralPublicacaoUpdateRequest,
    MuralPublicarRequest,
)
from ..services.training_uploads import (
    CATEGORIA_IMAGEM,
    save_training_upload,
    validate_training_upload,
)

router = APIRouter(prefix="/mural", tags=["mural"], dependencies=[Depends(get_current_user)])

# Sem exigir login: uma tag <img src="..."> do navegador não envia o header
# Authorization (o token do Conecta fica em sessionStorage, não em cookie),
# então servir a imagem atrás de get_current_user quebraria toda publicação
# com imagem — nem no editor, nem no feed, a tag carregaria. O nome do
# arquivo é um token aleatório (12 chars, ver services/training_uploads.py),
# não sequencial: listar o conteúdo por tentativa não é viável.
public_router = APIRouter(prefix="/mural", tags=["mural-imagens-publicas"])

_NOME_ARQUIVO_IMAGEM_PATTERN = re.compile(r"^[a-z0-9]{4,20}\.(png|jpg|jpeg)$")


@router.get("", dependencies=[Depends(require_permissions("mural.visualizar"))])
def list_mural(status_filtro: str = "", repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.list_mural_publicacoes(status_filtro)}


@router.get("/ambientes", dependencies=[Depends(require_permissions("mural.criar", "mural.editar"))])
def list_mural_ambientes(repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.list_mural_ambientes_disponiveis()}


@router.get("/{id_publicacao}", dependencies=[Depends(require_permissions("mural.visualizar"))])
def get_mural(id_publicacao: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_mural_publicacao(id_publicacao)


@router.post("", dependencies=[Depends(require_permissions("mural.criar"))])
def create_mural(
    payload: MuralPublicacaoCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_mural_publicacao(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="criar_publicacao_mural",
        entidade="mural_publicacao",
        entidade_id=str(result.get("id_publicacao") or ""),
        valor_novo={"titulo": payload.titulo, "categoria": payload.categoria},
    )
    return result


@router.put("/{id_publicacao}", dependencies=[Depends(require_permissions("mural.editar"))])
def update_mural(
    id_publicacao: int,
    payload: MuralPublicacaoUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_mural_publicacao(id_publicacao, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="editar_publicacao_mural",
        entidade="mural_publicacao",
        entidade_id=str(id_publicacao),
        valor_novo={"titulo": payload.titulo, "categoria": payload.categoria},
    )
    return result


@router.post("/{id_publicacao}/arquivar", dependencies=[Depends(require_permissions("mural.editar"))])
def arquivar_mural(
    id_publicacao: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.set_mural_publicacao_status(id_publicacao, "arquivado", actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="arquivar_publicacao_mural",
        entidade="mural_publicacao",
        entidade_id=str(id_publicacao),
    )
    return result


@router.post("/{id_publicacao}/restaurar", dependencies=[Depends(require_permissions("mural.editar"))])
def restaurar_mural(
    id_publicacao: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.set_mural_publicacao_status(id_publicacao, "rascunho", actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="restaurar_publicacao_mural",
        entidade="mural_publicacao",
        entidade_id=str(id_publicacao),
    )
    return result


@router.post("/{id_publicacao}/publicar", dependencies=[Depends(require_permissions("mural.criar", "mural.editar"))])
def publicar_mural(
    id_publicacao: int,
    payload: MuralPublicarRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.publicar_mural_publicacao(id_publicacao, payload.ambientes, actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="publicar_mural",
        entidade="mural_publicacao",
        entidade_id=str(id_publicacao),
        valor_novo={"ambientes": payload.ambientes},
    )
    return result


@router.delete("/{id_publicacao}", dependencies=[Depends(require_permissions("mural.excluir"))])
def delete_mural(
    id_publicacao: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_mural_publicacao(id_publicacao)
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="excluir_publicacao_mural",
        entidade="mural_publicacao",
        entidade_id=str(id_publicacao),
    )
    return result


@router.post("/imagens", dependencies=[Depends(require_permissions("mural.criar"))])
async def upload_mural_imagem(
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    """Imagem embutida/anexada a uma publicação do Mural. Mesmo padrão de
    validação e armazenamento local já usado pela Central de Treinamentos
    (services/training_uploads.py) — o arquivo em disco é a fonte da
    verdade, a URL retornada entra na lista `imagens` da publicação."""
    content = await arquivo.read()
    upload = validate_training_upload(
        original_filename=arquivo.filename or "imagem.png",
        content=content,
        categoria=CATEGORIA_IMAGEM,
        max_bytes=settings.training_upload_max_document_mb * 1024 * 1024,
    )
    save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="mural-imagens")
    audit_action(
        repository,
        user,
        modulo="Mural",
        acao="upload_imagem_mural",
        entidade="mural_publicacao",
        entidade_id="",
        valor_novo={"nome_arquivo": upload.original_filename},
    )
    return {"url": f"/mural/imagens/{upload.stored_filename}", "nome_arquivo": upload.original_filename}


@public_router.get("/imagens/{nome_arquivo}")
def baixar_mural_imagem(nome_arquivo: str, settings: Settings = Depends(get_settings)):
    if not _NOME_ARQUIVO_IMAGEM_PATTERN.fullmatch(nome_arquivo):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagem não encontrada.")
    caminho = Path(settings.training_upload_dir) / "mural-imagens" / nome_arquivo
    if not caminho.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagem não encontrada.")
    return FileResponse(caminho)

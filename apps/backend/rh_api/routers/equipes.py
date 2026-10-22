"""Controle de Equipes e Turnos — rotas (Supervisor sobre a própria equipe).

Presença, escala e horários da equipe reaproveitam as rotas /wfm (já com escopo de operação/equipe no servidor).
Aqui ficam só o que é novo: a equipe (operadores), as monitorias da equipe e o Mural da operação."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Request, UploadFile

from ..auth import AuthenticatedUser
from ..config import Settings, get_settings
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.equipes import EquipeOperadorRequest, EquipeRemoverRequest
from ..schemas.mural import MuralPublicacaoCreateRequest, MuralPublicacaoUpdateRequest, MuralPublicarRequest
from ..services.training_uploads import CATEGORIA_IMAGEM, save_training_upload, validate_training_upload

router = APIRouter(prefix="/equipes", tags=["equipes"], dependencies=[Depends(get_current_user)])

_VER = "equipes.controle.visualizar"
_MEMBROS = "equipes.membros.editar"
_MURAL = "equipes.mural.publicar"


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


@router.get("/contexto", dependencies=[Depends(require_permissions(_VER))])
def contexto(
    id_supervisor: int | None = None,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.eq_contexto(user, id_supervisor)


@router.get("/candidatos", dependencies=[Depends(require_permissions(_MEMBROS))])
def candidatos(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.eq_candidatos(user)}


@router.get("/supervisores-destino", dependencies=[Depends(require_permissions(_MEMBROS))])
def supervisores_destino(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.eq_supervisores_destino(user)}


@router.post("/operadores", dependencies=[Depends(require_permissions(_MEMBROS))])
def adicionar_operador(
    payload: EquipeOperadorRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.eq_adicionar_operador(user, payload.id_operador, ip=client_ip(request))


@router.post("/operadores/{id_operador}/remover", dependencies=[Depends(require_permissions(_MEMBROS))])
def remover_operador(
    id_operador: int,
    payload: EquipeRemoverRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.eq_remover_operador(user, id_operador, payload.id_novo_supervisor, ip=client_ip(request))


@router.get("/monitorias", dependencies=[Depends(require_permissions(_VER))])
def monitorias(
    id_supervisor: int | None = None,
    dias: int = 90,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.eq_monitorias(user, id_supervisor, dias=dias)


# ---------------------------------------------------------------- Mural da operação
@router.get("/mural/ambientes", dependencies=[Depends(require_permissions(_MURAL))])
def mural_ambientes(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.eq_mural_ambientes(user)}


@router.get("/mural", dependencies=[Depends(require_permissions(_MURAL))])
def mural_listar(
    status_filtro: str = "",
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return {"itens": repository.eq_mural_listar(user, status_filtro)}


@router.post("/mural", dependencies=[Depends(require_permissions(_MURAL))])
def mural_criar(
    payload: MuralPublicacaoCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    resultado = repository.eq_mural_salvar(user, payload.model_dump())
    audit_action(
        repository, user, modulo="Mural", acao="criar_publicacao_mural_equipe", entidade="mural_publicacao",
        entidade_id=str(resultado.get("id_publicacao") or ""), valor_novo={"titulo": payload.titulo, "ambientes": payload.ambientes},
    )
    return resultado


@router.put("/mural/{id_publicacao}", dependencies=[Depends(require_permissions(_MURAL))])
def mural_atualizar(
    id_publicacao: int,
    payload: MuralPublicacaoUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    resultado = repository.eq_mural_salvar(user, payload.model_dump(), id_publicacao)
    audit_action(
        repository, user, modulo="Mural", acao="editar_publicacao_mural_equipe", entidade="mural_publicacao",
        entidade_id=str(id_publicacao), valor_novo={"titulo": payload.titulo, "ambientes": payload.ambientes},
    )
    return resultado


@router.post("/mural/{id_publicacao}/publicar", dependencies=[Depends(require_permissions(_MURAL))])
def mural_publicar(
    id_publicacao: int,
    payload: MuralPublicarRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    resultado = repository.eq_mural_publicar(user, id_publicacao, payload.ambientes)
    audit_action(
        repository, user, modulo="Mural", acao="publicar_mural_equipe", entidade="mural_publicacao",
        entidade_id=str(id_publicacao), valor_novo={"ambientes": payload.ambientes},
    )
    return resultado


@router.post("/mural/{id_publicacao}/arquivar", dependencies=[Depends(require_permissions(_MURAL))])
def mural_arquivar(id_publicacao: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    repository.eq_mural_exigir(user, id_publicacao)
    resultado = repository.set_mural_publicacao_status(id_publicacao, "arquivado", actor=user.username)
    audit_action(repository, user, modulo="Mural", acao="arquivar_publicacao_mural_equipe", entidade="mural_publicacao", entidade_id=str(id_publicacao))
    return resultado


@router.post("/mural/{id_publicacao}/restaurar", dependencies=[Depends(require_permissions(_MURAL))])
def mural_restaurar(id_publicacao: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    repository.eq_mural_exigir(user, id_publicacao)
    resultado = repository.set_mural_publicacao_status(id_publicacao, "rascunho", actor=user.username)
    audit_action(repository, user, modulo="Mural", acao="restaurar_publicacao_mural_equipe", entidade="mural_publicacao", entidade_id=str(id_publicacao))
    return resultado


@router.delete("/mural/{id_publicacao}", dependencies=[Depends(require_permissions(_MURAL))])
def mural_excluir(id_publicacao: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    repository.eq_mural_exigir(user, id_publicacao)
    resultado = repository.delete_mural_publicacao(id_publicacao)
    audit_action(repository, user, modulo="Mural", acao="excluir_publicacao_mural_equipe", entidade="mural_publicacao", entidade_id=str(id_publicacao))
    return resultado


@router.post("/mural/imagens", dependencies=[Depends(require_permissions(_MURAL))])
async def mural_upload_imagem(
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    """Mesma validação/armazenamento do Mural do RH; a imagem é servida pela rota pública /mural/imagens/{nome}."""
    content = await arquivo.read()
    upload = validate_training_upload(
        original_filename=arquivo.filename or "imagem.png",
        content=content,
        categoria=CATEGORIA_IMAGEM,
        max_bytes=settings.training_upload_max_document_mb * 1024 * 1024,
    )
    save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="mural-imagens")
    audit_action(
        repository, user, modulo="Mural", acao="upload_imagem_mural_equipe", entidade="mural_publicacao", entidade_id="",
        valor_novo={"nome_arquivo": upload.original_filename},
    )
    return {"url": f"/mural/imagens/{upload.stored_filename}", "nome_arquivo": upload.original_filename}

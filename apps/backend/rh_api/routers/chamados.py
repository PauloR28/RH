"""Chamados (Suporte TI) — rotas. Cada rota exige a permissão da ação; o acesso ao chamado em si (solicitante, operação,
atendente) é verificado no repositório. O frontend só esconde botões: o backend decide."""

from __future__ import annotations

import json
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.chamados import (
    AtribuirRequest,
    CategoriaRequest,
    ChamadoCriarRequest,
    ConfigRequest,
    MensagemRequest,
    MotivoRequest,
    StatusRequest,
    UrgenciaRequest,
)
from ..services.chamados_storage import MIMES_INLINE

router = APIRouter(prefix="/chamados", tags=["chamados"], dependencies=[Depends(get_current_user)])

_QUALQUER = ("chamados.abrir", "chamados.ver_operacao", "chamados.atender", "chamados.atribuir", "chamados.dashboard", "chamados.configurar")
MAX_ARQUIVOS = 10
_LEITURA_MAX = 101 * 1024 * 1024  # o limite real vem de chamado_config; isto só protege a memória


async def _ler(arquivos: list[UploadFile] | None) -> list[tuple[str, bytes]]:
    arquivos = [a for a in (arquivos or []) if a and a.filename]
    if len(arquivos) > MAX_ARQUIVOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Envie no máximo {MAX_ARQUIVOS} arquivos por vez.")
    return [(a.filename or "arquivo", await a.read(_LEITURA_MAX)) for a in arquivos]


@router.get("/meta", dependencies=[Depends(require_permissions(*_QUALQUER))])
def meta(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_meta(user)


@router.get("", dependencies=[Depends(require_permissions("chamados.abrir", "chamados.ver_operacao"))])
def listar(
    escopo: str = Query("meus", pattern="^(meus|operacao)$"),
    fase: str | None = Query(None, pattern="^(aberto|resolvidos|historico)$"),
    status_: str | None = Query(None, alias="status"),
    urgencia: str | None = None,
    categoria_id: int | None = None,
    operacao: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    filtros = {"fase": fase, "status": status_, "urgencia": urgencia, "categoria_id": categoria_id, "operacao": operacao, "q": q}
    return repository.ch_listar(user, filtros, escopo=escopo, page=page, page_size=page_size)


@router.get("/fila", dependencies=[Depends(require_permissions("chamados.atender"))])
def fila(
    status_: str | None = Query(None, alias="status"),
    urgencia: str | None = None,
    categoria_id: int | None = None,
    operacao: str | None = None,
    responsavel_id: int | None = None,
    sem_responsavel: bool = False,
    vencidos: bool = False,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    filtros = {"status": status_, "urgencia": urgencia, "categoria_id": categoria_id, "operacao": operacao, "responsavel_id": responsavel_id,
               "sem_responsavel": sem_responsavel, "vencidos": vencidos, "q": q}
    return repository.ch_fila(user, filtros, page=page, page_size=page_size)


@router.post("", dependencies=[Depends(require_permissions("chamados.abrir"))])
async def criar(
    request: Request,
    dados: str = Form(...),
    arquivos: list[UploadFile] | None = File(None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    try:
        payload = ChamadoCriarRequest(**json.loads(dados))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Dados do chamado inválidos.") from exc
    resultado = repository.ch_criar(user, payload.model_dump(), await _ler(arquivos))
    audit_action(repository, user, modulo="Chamados", acao="chamado_aberto", entidade="chamado", entidade_id=str(resultado["id"]), request=request)
    return resultado


@router.get("/agentes", dependencies=[Depends(require_permissions("chamados.abrir"))])
def buscar_agentes(operacao: str, q: str = "", limite: int = Query(10, ge=1, le=20),
                   user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.ch_buscar_agentes(user, operacao, q, limite)}


@router.get("/atendentes", dependencies=[Depends(require_permissions("chamados.atribuir"))])
def buscar_atendentes(q: str = "", repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.ch_buscar_atendentes(q)}


@router.get("/dashboard", dependencies=[Depends(require_permissions("chamados.dashboard"))])
def dashboard(dias: int = Query(30), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_dashboard(dias)


@router.get("/config", dependencies=[Depends(require_permissions("chamados.configurar"))])
def config_obter(repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_config_obter()


@router.put("/config", dependencies=[Depends(require_permissions("chamados.configurar"))])
def config_salvar(payload: ConfigRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                  repository: DatabaseRepository = Depends(get_repository)):
    anterior = repository.ch_config_obter()["config"]
    resultado = repository.ch_config_salvar(user, payload.valores)
    audit_action(repository, user, modulo="Chamados", acao="config_alterada", entidade="chamado_config",
                 valor_anterior={k: anterior.get(k) for k in resultado["config"]}, valor_novo=resultado["config"], request=request)
    return resultado


@router.post("/config/categorias", dependencies=[Depends(require_permissions("chamados.configurar"))])
def categoria_criar(payload: CategoriaRequest, repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_categoria_salvar(payload.model_dump())


@router.put("/config/categorias/{id_categoria}", dependencies=[Depends(require_permissions("chamados.configurar"))])
def categoria_atualizar(id_categoria: int, payload: CategoriaRequest, repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_categoria_salvar(payload.model_dump(), id_categoria)


@router.get("/anexos/{id_anexo}/download")
def baixar_anexo(id_anexo: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    arquivo, nome, mime = repository.ch_anexo_abrir(user, id_anexo)
    disposicao = "inline" if mime in MIMES_INLINE else "attachment"
    return StreamingResponse(
        iter(lambda: arquivo.read(1024 * 256), b""),
        media_type=mime,
        headers={"Content-Disposition": f"{disposicao}; filename*=UTF-8''{quote(nome)}", "X-Content-Type-Options": "nosniff",
                 "Cache-Control": "private, no-store"},
    )


@router.delete("/anexos/{id_anexo}")
def excluir_anexo(id_anexo: int, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                  repository: DatabaseRepository = Depends(get_repository)):
    resultado = repository.ch_anexo_excluir(user, id_anexo)
    audit_action(repository, user, modulo="Chamados", acao="anexo_removido", entidade="chamado_anexo", entidade_id=str(id_anexo), request=request)
    return resultado


@router.get("/{id_chamado}")
def detalhe(id_chamado: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_detalhe(user, id_chamado)


@router.get("/{id_chamado}/eventos")
def eventos(id_chamado: int, antes_de: int | None = None, limite: int = Query(50, ge=1, le=200),
            user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_eventos(user, id_chamado, antes_de=antes_de, limite=limite)


@router.post("/{id_chamado}/mensagens")
async def enviar_mensagem(
    id_chamado: int,
    conteudo: str = Form(""),
    arquivos: list[UploadFile] | None = File(None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    MensagemRequest(conteudo=conteudo)
    return repository.ch_mensagem(user, id_chamado, conteudo, await _ler(arquivos))


@router.post("/{id_chamado}/assumir", dependencies=[Depends(require_permissions("chamados.atender"))])
def assumir(id_chamado: int, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    resultado = repository.ch_assumir(user, id_chamado)
    audit_action(repository, user, modulo="Chamados", acao="chamado_assumido", entidade="chamado", entidade_id=str(id_chamado), request=request)
    return resultado


@router.post("/{id_chamado}/atribuir", dependencies=[Depends(require_permissions("chamados.atribuir"))])
def atribuir(id_chamado: int, payload: AtribuirRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
             repository: DatabaseRepository = Depends(get_repository)):
    resultado = repository.ch_atribuir(user, id_chamado, payload.responsavel_id)
    audit_action(repository, user, modulo="Chamados", acao="chamado_atribuido", entidade="chamado", entidade_id=str(id_chamado),
                 valor_novo={"responsavel_id": payload.responsavel_id}, request=request)
    return resultado


@router.put("/{id_chamado}/status", dependencies=[Depends(require_permissions("chamados.atender"))])
def mudar_status(id_chamado: int, payload: StatusRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                 repository: DatabaseRepository = Depends(get_repository)):
    resultado = repository.ch_mudar_status(user, id_chamado, payload.status, payload.justificativa)
    audit_action(repository, user, modulo="Chamados", acao="chamado_status", entidade="chamado", entidade_id=str(id_chamado),
                 valor_novo={"status": resultado["status"]}, justificativa=payload.justificativa, request=request)
    return resultado


@router.put("/{id_chamado}/urgencia", dependencies=[Depends(require_permissions("chamados.atender"))])
def mudar_urgencia(id_chamado: int, payload: UrgenciaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                   repository: DatabaseRepository = Depends(get_repository)):
    resultado = repository.ch_mudar_urgencia(user, id_chamado, payload.urgencia, payload.justificativa)
    audit_action(repository, user, modulo="Chamados", acao="chamado_urgencia", entidade="chamado", entidade_id=str(id_chamado),
                 valor_novo={"urgencia": resultado["urgencia"]}, justificativa=payload.justificativa, request=request)
    return resultado


@router.post("/{id_chamado}/cancelar")
def cancelar(id_chamado: int, payload: MotivoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_cancelar(user, id_chamado, payload.motivo)


@router.post("/{id_chamado}/confirmar-encerramento")
def confirmar(id_chamado: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_confirmar(user, id_chamado)


@router.post("/{id_chamado}/reabrir")
def reabrir(id_chamado: int, payload: MotivoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.ch_reabrir(user, id_chamado, payload.motivo)

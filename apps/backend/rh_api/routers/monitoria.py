"""Central de Monitoria — rotas (promt.txt, rodada 20/set/2026).

Toda rota passa por permissão de módulo E por escopo de operação/equipe/perfil
(services/monitoria_scope.py). Fluxo, matriz, dashboards e relatórios são
acrescentados nas fases seguintes (C2–C4) neste mesmo router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.monitoria import (
    CatalogoRequest,
    EquipeRequest,
    TemaRequest,
    TransferirSupervisaoRequest,
    UsuarioMonitoriaRequest,
)

router = APIRouter(prefix="/monitoria", tags=["monitoria"], dependencies=[Depends(get_current_user)])


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


# ---------------------------------------------------------------------------
# Contexto / organização
# ---------------------------------------------------------------------------
@router.get("/contexto", dependencies=[Depends(require_permissions("sessao.monitoria.acessar", "monitoria.visualizar"))])
def get_contexto(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_contexto(user)


@router.put("/tema")
def escolher_tema(
    payload: TemaRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_set_tema(user, payload.operacao, ip=client_ip(request))


@router.get("/equipes", dependencies=[Depends(require_permissions("monitoria.equipes", "monitoria.visualizar"))])
def listar_equipes(
    operacao: str = "",
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return {"itens": repository.mon_list_equipes(user, operacao)}


@router.post("/equipes", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def criar_equipe(
    payload: EquipeRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_equipe(user, payload.model_dump(), ip=client_ip(request))


@router.put("/equipes/{id_equipe}", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def atualizar_equipe(
    id_equipe: int,
    payload: EquipeRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_equipe(user, payload.model_dump(), id_equipe, ip=client_ip(request))


@router.get("/catalogo", dependencies=[Depends(require_permissions("sessao.monitoria.acessar", "monitoria.visualizar"))])
def listar_catalogo(
    tipo: str,
    operacao: str = "",
    incluir_inativos: bool = False,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    from ..services.monitoria_scope import pode_ver_operacao

    if operacao and not pode_ver_operacao(user.perfil, user.operacoes, operacao):
        return {"itens": []}
    return {"itens": repository.mon_list_catalogo(tipo, operacao, incluir_inativos=incluir_inativos)}


@router.post("/catalogo", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def criar_item_catalogo(
    payload: CatalogoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_catalogo(user, payload.model_dump(), ip=client_ip(request))


@router.put("/catalogo/{id_item}", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def atualizar_item_catalogo(
    id_item: int,
    payload: CatalogoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_catalogo(user, payload.model_dump(), id_item, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Usuários (hierarquia da Monitoria) e supervisão
# ---------------------------------------------------------------------------
@router.get("/usuarios", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def listar_usuarios(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_list_usuarios(user)}


@router.post("/usuarios", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def criar_usuario(
    payload: UsuarioMonitoriaRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_create_usuario(user, payload.model_dump(), ip=client_ip(request))


@router.put("/usuarios/{id_usuario}", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def atualizar_usuario(
    id_usuario: int,
    payload: UsuarioMonitoriaRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_update_usuario(user, id_usuario, payload.model_dump(exclude_unset=True), ip=client_ip(request))


@router.post("/supervisao/transferir", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def transferir_supervisao(
    payload: TransferirSupervisaoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_transferir_supervisao(
        user,
        operacao=payload.operacao,
        id_de=payload.id_de,
        id_para=payload.id_para,
        justificativa=payload.justificativa,
        ip=client_ip(request),
    )


@router.post("/usuarios/{id_usuario}/liberar-design", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def liberar_troca_design(
    id_usuario: int,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_liberar_tema(user, id_usuario, ip=client_ip(request))

"""Central de notificações in-app (Prompt.txt, rodada 06/set/2026).

Não existia nenhuma persistência de notificação antes desta rodada — ver
docs/central-treinamentos/01-plano-tecnico.md §1.5/§5. `notificacoes.visualizar`
já era uma chave de permissão concedida à maioria dos papéis (`rbac.py`); só
faltava a rota."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository


router = APIRouter(prefix="/notificacoes", tags=["notificacoes"], dependencies=[Depends(get_current_user)])


@router.get("", dependencies=[Depends(require_permissions("notificacoes.visualizar"))])
def list_notificacoes(
    apenas_nao_lidas: bool = False,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_notificacoes(papel=user.perfil, usuario=user.username, email=user.email, apenas_nao_lidas=apenas_nao_lidas)


@router.post("/{id_notificacao}/marcar-lida", dependencies=[Depends(require_permissions("notificacoes.visualizar"))])
def marcar_notificacao_lida(id_notificacao: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.marcar_notificacao_lida(id_notificacao)


@router.post("/entidade/{entidade}/{entidade_id}/marcar-lidas", dependencies=[Depends(require_permissions("notificacoes.visualizar"))])
def marcar_notificacoes_entidade_lidas(
    entidade: str,
    entidade_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.marcar_notificacoes_entidade_lidas(
        entidade=entidade, entidade_id=entidade_id, papel=user.perfil, usuario=user.username, email=user.email
    )


@router.post("/marcar-todas-lidas", dependencies=[Depends(require_permissions("notificacoes.visualizar"))])
def marcar_todas_notificacoes_lidas(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.marcar_todas_notificacoes_lidas(papel=user.perfil, usuario=user.username, email=user.email)


@router.delete("/{id_notificacao}", dependencies=[Depends(require_permissions("notificacoes.visualizar"))])
def excluir_notificacao(
    id_notificacao: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.excluir_notificacao(id_notificacao, papel=user.perfil, usuario=user.username, email=user.email)


@router.delete("", dependencies=[Depends(require_permissions("notificacoes.visualizar"))])
def excluir_todas_notificacoes(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.excluir_todas_notificacoes(papel=user.perfil, usuario=user.username, email=user.email)

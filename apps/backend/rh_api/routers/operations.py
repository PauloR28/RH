from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..services.http_cache import aplicar_cache_http


router = APIRouter(tags=["operations"], dependencies=[Depends(get_current_user)])


@router.get("/operacoes", dependencies=[Depends(require_permissions("operacoes.visualizar"))])
def list_operacoes(
    request: Request,
    response: Response,
    repository: DatabaseRepository = Depends(get_repository),
):
    """Lista enxuta de operações ativas, para preencher o <select> de operação
    em telas operacionais (criar processo, gerar prova). O CRUD completo
    (criar/editar/desativar) continua em /settings/catalog/operacoes, restrito
    a quem tem configuracoes.editar."""
    itens = repository.list_catalog_items_by_type("operacoes", apenas_ativos=True)
    if aplicar_cache_http(request, response, itens):
        return Response(status_code=304, headers=dict(response.headers))
    return itens

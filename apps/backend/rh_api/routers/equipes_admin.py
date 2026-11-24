"""Equipes na Tecnologia (24/nov/2026) — rotas de Tecnologia > Acessos > Equipes.

Escopo e regras de migração no servidor: repositories/equipes_admin.py."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.equipes import EquipeAdminSalvarRequest, EquipeMoverRequest

router = APIRouter(prefix="/equipes-admin", tags=["equipes-admin"], dependencies=[Depends(get_current_user)])


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


@router.get("", dependencies=[Depends(require_permissions("equipes.visualizar"))])
def listar(operacao: str = "", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.eqa_listar(user, operacao)


@router.get("/exportar", dependencies=[Depends(require_permissions("equipes.exportar"))])
def exportar(operacao: str = "", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    conteudo = repository.eqa_exportar_csv(user, operacao)
    nome = f"equipes-{date.today().isoformat()}.csv"
    return Response(conteudo.encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@router.get("/{id_equipe}/membros", dependencies=[Depends(require_permissions("equipes.visualizar"))])
def membros(id_equipe: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.eqa_membros(user, id_equipe)}


@router.post("", dependencies=[Depends(require_permissions("equipes.administrar"))])
def criar(payload: EquipeAdminSalvarRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.eqa_salvar(user, payload.model_dump(), ip=_ip(request))


@router.put("/{id_equipe}", dependencies=[Depends(require_permissions("equipes.administrar"))])
def editar(
    id_equipe: int, payload: EquipeAdminSalvarRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.eqa_salvar(user, payload.model_dump(), id_equipe, ip=_ip(request))


@router.post("/mover/previa", dependencies=[Depends(require_permissions("equipes.mover"))])
def previa(payload: EquipeMoverRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.eqa_previa(user, payload.ids_operadores, payload.id_equipe_destino)


@router.post("/mover", dependencies=[Depends(require_permissions("equipes.mover"))])
def mover(payload: EquipeMoverRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.eqa_mover(user, payload.ids_operadores, payload.id_equipe_destino, payload.turnos, ip=_ip(request))

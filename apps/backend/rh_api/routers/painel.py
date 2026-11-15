"""Painel (14/nov/2026) — rotas. Regras em repositories/painel.py e services/painel_regras.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.painel import PainelSalvarRequest

router = APIRouter(prefix="/painel", tags=["painel"], dependencies=[Depends(get_current_user)])

_VER = "painel.visualizar"
_CONFIGURAR = "painel.configurar"


@router.get("/opcoes", dependencies=[Depends(require_permissions(_VER))])
def opcoes(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_opcoes(user)


@router.get("/config", dependencies=[Depends(require_permissions(_CONFIGURAR))])
def config(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_config(user)


@router.post("/config", dependencies=[Depends(require_permissions(_CONFIGURAR))])
def criar(payload: PainelSalvarRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_salvar(user, None, payload.model_dump())


@router.put("/config/{id_painel}", dependencies=[Depends(require_permissions(_CONFIGURAR))])
def editar(id_painel: int, payload: PainelSalvarRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_salvar(user, id_painel, payload.model_dump())


@router.get("/{id_painel}/dados", dependencies=[Depends(require_permissions(_VER))])
def dados(id_painel: int, periodo: str = "mes", equipe: str = "", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_dados(user, id_painel, periodo, equipe)


@router.get("/{id_painel}/operadores/{id_operador}", dependencies=[Depends(require_permissions(_VER))])
def ficha(id_painel: int, id_operador: int, periodo: str = "mes", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_ficha(user, id_painel, id_operador, periodo)


@router.get("/{id_painel}/presenca-comparada", dependencies=[Depends(require_permissions(_VER))])
def presenca_comparada(id_painel: int, periodo: str = "mes", equipe: str = "", comparar: str = "anterior",
                       user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_serie_comparada(user, id_painel, periodo, equipe, comparar)


@router.get("/{id_painel}/dia", dependencies=[Depends(require_permissions(_VER))])
def presenca_do_dia(id_painel: int, data: str, equipe: str = "", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.painel_dia(user, id_painel, data, equipe)

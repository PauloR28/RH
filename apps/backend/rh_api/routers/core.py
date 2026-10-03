from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user
from ..services import acesso

router = APIRouter(prefix="/core", tags=["core"], dependencies=[Depends(get_current_user)])


@router.get("/acesso")
def meu_acesso(user: AuthenticatedUser = Depends(get_current_user)) -> dict:
    """Módulos visíveis, módulo padrão e permissões efetivas do usuário logado (já sem as de módulos desativados).
    É daqui que o frontend monta o seletor de módulo e o menu. Aditivo: /auth/login e /auth/me não mudam."""
    return acesso.descrever(user.permissions)

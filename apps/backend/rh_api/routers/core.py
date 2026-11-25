from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser, OperacaoEscolhida
from ..dependencies import get_current_user
from ..services import acesso, operacao_escolhida

router = APIRouter(prefix="/core", tags=["core"], dependencies=[Depends(get_current_user)])


@router.get("/acesso")
def meu_acesso(user: AuthenticatedUser = Depends(get_current_user)) -> dict:
    """Módulos visíveis, módulo padrão e permissões efetivas do usuário logado (já sem as de módulos desativados).
    É daqui que o frontend monta o seletor de módulo e o menu. Aditivo: /auth/login e /auth/me não mudam."""
    vinculos = user.operacoes.originais if isinstance(user.operacoes, OperacaoEscolhida) else user.operacoes
    dados = acesso.descrever(user.permissions, acesso.modulos_liberados(user.id_usuario, user.perfil), vinculos,
                             acesso.modulos_retirados(user.id_usuario, user.perfil))
    # Seletor de operação do topo (25/nov/2026): só aparece com 2 ou mais.
    dados["operacoes_escolha"] = operacao_escolhida.operacoes_escolhiveis(user)
    return dados

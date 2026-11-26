"""Uma conta, um computador por vez (S9 do fluxo de senha, aprovado pelo Paulo em 26/nov/2026).

Cada login web (por Login ou Microsoft) gera um número de sessão novo, gravado em ``usuarios.sessao_web_id`` e no token
("sid"). Quando a mesma conta entra em outro computador, o número muda e o token antigo deixa de valer no próximo
pedido: o computador antigo mostra "Sua conta foi aberta em outro computador hoje às HH:MM.".

  * O app do celular fica de fora (decisão D5): o token dele não tem "sid".
  * Tokens antigos (sem "sid"), o admin do ambiente e os testes também não são conferidos.
  * Trocar ou redefinir a senha encerra a sessão aberta (grava um número que nenhum token tem).

Para não ir ao banco a cada pedido, os números ficam numa foto em memória renovada a cada ``_TTL`` segundos. O que este
processo grava vale na hora; nos outros processos, em até ``_TTL`` segundos.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from collections.abc import Callable
from datetime import datetime

logger = logging.getLogger(__name__)

PREFIXO_ENCERRADA = "encerrada-"
_TTL = 10.0
_lock = threading.Lock()
_foto: tuple[float, dict[int, tuple[str, datetime | None]]] | None = None
_locais: dict[int, tuple[str, datetime | None]] = {}
_carregador: Callable[[], dict[int, tuple[str, datetime | None]]] | None = None


def novo_id() -> str:
    return secrets.token_urlsafe(16)


def id_encerrada() -> str:
    return PREFIXO_ENCERRADA + secrets.token_urlsafe(8)


def _carregar_do_banco() -> dict[int, tuple[str, datetime | None]]:
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "IF COL_LENGTH('dbo.usuarios', 'sessao_web_id') IS NOT NULL "
            "SELECT id_usuario, sessao_web_id, ultimo_acesso_em FROM dbo.usuarios WHERE sessao_web_id IS NOT NULL"
        )
        linhas = cursor.fetchall() if cursor.description else []
    finally:
        conn.close()
    return {int(r[0]): (str(r[1]), r[2]) for r in linhas}


def _atual() -> dict[int, tuple[str, datetime | None]]:
    global _foto
    agora = time.monotonic()
    foto = _foto
    if foto is not None and foto[0] > agora:
        return foto[1]
    with _lock:
        foto = _foto
        if foto is not None and foto[0] > agora:
            return foto[1]
        try:
            dados = (_carregador or _carregar_do_banco)()
            _locais.clear()
        except Exception as exc:  # noqa: BLE001 - sem banco: não derruba ninguém
            logger.info("Sessão única indisponível (%s); conferência pulada.", exc)
            dados = foto[1] if foto else {}
        _foto = (agora + _TTL, dados)
        return dados


def registrar(id_usuario: int | None, sid: str, quando: datetime | None = None) -> None:
    """Quem gravou no banco avisa aqui: vale na hora neste processo."""
    if not id_usuario:
        return
    with _lock:
        _locais[int(id_usuario)] = (sid, quando or datetime.now())


def conferir(id_usuario: int | None, sid: str) -> datetime | None:
    """None = sessão vale. Senão devolve quando a conta foi aberta no outro computador (pode ser `datetime.min`)."""
    if not id_usuario or not sid:
        return None
    chave = int(id_usuario)
    atual = _locais.get(chave) or _atual().get(chave)
    if atual is None or atual[0] == sid:
        return None
    if atual[0].startswith(PREFIXO_ENCERRADA):
        return datetime.min
    return atual[1] or datetime.min


def mensagem_substituida(quando: datetime | None) -> str:
    if atual_encerrada(quando):
        return "SESSAO_SUBSTITUIDA: Sua sessão foi encerrada. Entre de novo."
    hoje = datetime.now().date()
    if quando.date() == hoje:
        return f"SESSAO_SUBSTITUIDA: Sua conta foi aberta em outro computador hoje às {quando:%H:%M}."
    return f"SESSAO_SUBSTITUIDA: Sua conta foi aberta em outro computador em {quando:%d/%m} às {quando:%H:%M}."


def atual_encerrada(quando: datetime | None) -> bool:
    return quando is None or quando == datetime.min


def invalidar() -> None:
    global _foto
    with _lock:
        _foto = None
        _locais.clear()


def definir_carregador(carregador: Callable[[], dict[int, tuple[str, datetime | None]]] | None) -> None:
    """Só para testes."""
    global _carregador
    _carregador = carregador
    invalidar()

"""Cache de acessos (Central de Acessos, Etapa 2).

Antes: as permissões ficavam congeladas no token (mudou o perfil, a pessoa precisava sair e entrar) e
`modulos_liberados` ia ao banco em todo `/me`. Agora:

  * As permissões de TODOS os perfis e os módulos liberados por perfil/usuário são lidos de uma vez, em 3 consultas
    pequenas, e guardados em memória por `_TTL_SEGUNDOS`.
  * `get_current_user` troca as permissões do token pelas atuais do perfil (mesma fonte do login:
    `perfil_permissoes`, com a restrição de teste do WFM). Mudança de permissão vale sem relogin.
  * Quem salva perfis ou módulos chama `invalidar()`: vale na hora neste processo e em até `_TTL_SEGUNDOS` nos outros.

Falha de leitura (banco fora, tabela ausente) = `None`/vazio e o pedido segue com o token, exatamente como antes.
Perfil sem nenhuma linha em `perfil_permissoes` também fica com o token (o login usa o padrão do código nesse caso).
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

logger = logging.getLogger(__name__)

_TTL_SEGUNDOS = 30.0
_TTL_FALHA_SEGUNDOS = 5.0


@dataclass(frozen=True)
class FotoAcessos:
    permissoes: dict[str, frozenset[str]] = field(default_factory=dict)  # perfil -> permissões permitidas
    modulos_perfil: dict[str, frozenset[str]] = field(default_factory=dict)  # perfil -> módulos liberados (V060)
    modulos_usuario: dict[int, frozenset[str]] = field(default_factory=dict)  # id_usuario -> módulos liberados (V060)
    ok: bool = False  # False = leitura falhou; ninguém deve trocar o token por isto


_lock = threading.Lock()
_cache: tuple[float, FotoAcessos] | None = None
_carregador: Callable[[], FotoAcessos] | None = None  # injetável nos testes
_leituras = 0


def _ler_tabela(cursor, sql: str) -> list:
    try:
        cursor.execute(sql)
        return cursor.fetchall()
    except Exception as exc:  # noqa: BLE001 - migration V060 pode não estar aplicada
        logger.info("Acessos: tabela indisponível (%s).", exc)
        return []


def _carregar_do_banco() -> FotoAcessos:
    from ..config import get_settings
    from ..db import get_connection
    from ..rbac import aplicar_restricao_wfm_em_teste, normalize_role_id

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_perfil, chave_permissao, permitido FROM dbo.perfil_permissoes")
        linhas = cursor.fetchall()
        mod_perfil = _ler_tabela(cursor, "SELECT id_perfil, modulo FROM dbo.modulos_acesso_perfil")
        mod_usuario = _ler_tabela(cursor, "SELECT id_usuario, modulo FROM dbo.modulos_acesso_usuario")
    finally:
        conn.close()
    por_perfil: dict[str, set[str]] = {}
    for perfil, chave, permitido in linhas:
        perfil = normalize_role_id(str(perfil or ""))
        lista = por_perfil.setdefault(perfil, set())  # perfil com linhas só negadas continua "conhecido"
        chave = str(chave or "").strip()
        if chave and permitido:
            lista.add(chave)
    permissoes = {p: frozenset(aplicar_restricao_wfm_em_teste(p, sorted(c))) for p, c in por_perfil.items()}
    mp: dict[str, set[str]] = {}
    for perfil, modulo in mod_perfil:
        mp.setdefault(str(perfil), set()).add(str(modulo))
    mu: dict[int, set[str]] = {}
    for id_usuario, modulo in mod_usuario:
        mu.setdefault(int(id_usuario), set()).add(str(modulo))
    return FotoAcessos(
        permissoes=permissoes,
        modulos_perfil={k: frozenset(v) for k, v in mp.items()},
        modulos_usuario={k: frozenset(v) for k, v in mu.items()},
        ok=True,
    )


def foto() -> FotoAcessos:
    global _cache, _leituras
    agora = time.monotonic()
    atual = _cache
    if atual is not None and atual[0] > agora:
        return atual[1]
    with _lock:
        atual = _cache
        if atual is not None and atual[0] > agora:
            return atual[1]
        try:
            carregada = (_carregador or _carregar_do_banco)()
            _cache = (agora + _TTL_SEGUNDOS, carregada)
        except Exception as exc:  # noqa: BLE001 - falha = segue com o token, como antes
            logger.warning("Cache de acessos indisponível (%s); usando as permissões do token.", exc)
            carregada = FotoAcessos()
            _cache = (agora + _TTL_FALHA_SEGUNDOS, carregada)
        _leituras += 1
        return carregada


def permissoes_atuais(perfil: str | None) -> frozenset[str] | None:
    """Permissões vigentes do perfil, ou None quando não há como saber (aí vale o token)."""
    if not perfil:
        return None
    from ..rbac import normalize_role_id

    atual = foto()
    if not atual.ok:
        return None
    return atual.permissoes.get(normalize_role_id(perfil))


def modulos_liberados(id_usuario: int | None, perfil: str | None) -> frozenset[str]:
    atual = foto()
    extras = set(atual.modulos_perfil.get(perfil or "", frozenset()))
    if id_usuario:
        extras |= atual.modulos_usuario.get(int(id_usuario), frozenset())
    return frozenset(extras)


def invalidar() -> None:
    global _cache
    with _lock:
        _cache = None


def definir_carregador(carregador: Callable[[], FotoAcessos] | None) -> None:
    global _carregador, _leituras
    _carregador = carregador
    _leituras = 0
    invalidar()


def leituras() -> int:
    """Quantas vezes o banco foi lido desde o último `definir_carregador` (usado nos testes de desempenho)."""
    return _leituras

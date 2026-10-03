"""Ponto ÚNICO de decisão de acesso por módulo (modularização, Etapa 3).

Responde: "este usuário enxerga/pode usar este módulo e esta permissão?". Rotas (via `dependencies.get_current_user`)
e frontend (via `GET /core/acesso`) consultam só este serviço. O backend garante; o frontend apenas esconde.

Regras (PLANO.md §2.3 e §3):
  * Módulo visível = módulo ativo E o perfil tem >= 1 permissão que "abre" o módulo (`permissoes.abre_modulo`).
    O `core` é sempre ativo e nunca aparece como módulo no seletor.
  * Módulo desativado => as permissões que ele possui (`permissoes.modulo_dono`) deixam de valer NO PEDIDO (sem relogin).
  * `core` e `tecnologia` são protegidos: nunca desativáveis (evita trancar todos para fora).
  * Falha ao ler o estado (tabelas ainda não migradas, banco indisponível) = defaults do catálogo em código, tudo ativo.
    A checagem de permissão em si continua valendo; só a camada nova de módulo é que "falha aberta".
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable

from ..modulos_catalogo import (
    ABRE_MODULO_PADRAO,
    MODULO_CORE,
    MODULOS_PADRAO,
    MODULOS_PROTEGIDOS,
    MODULOS_VALIDOS,
    modulo_dono_padrao,
)

logger = logging.getLogger(__name__)

_TTL_SEGUNDOS = 15.0
_TTL_FALHA_SEGUNDOS = 5.0


@dataclass(frozen=True)
class EstadoModulos:
    """Fotografia do registro de módulos e do dono de cada permissão."""

    ativos: frozenset[str] = frozenset(chave for chave, *_ in MODULOS_PADRAO)
    nomes: dict[str, str] = field(default_factory=lambda: {c: n for c, n, _o, _p in MODULOS_PADRAO})
    ordem: dict[str, int] = field(default_factory=lambda: {c: o for c, _n, o, _p in MODULOS_PADRAO})
    donos: dict[str, str] = field(default_factory=dict)  # permissão -> módulo (só as que o banco definiu)
    abre: dict[str, bool] = field(default_factory=dict)  # permissão -> abre o módulo dono (só as que o banco definiu)
    de_banco: bool = False


_lock = threading.Lock()
_cache: tuple[float, EstadoModulos] | None = None
_carregador: Callable[[], EstadoModulos] | None = None  # injetável nos testes


def _carregar_do_banco() -> EstadoModulos:
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT chave, nome, ordem, ativo FROM dbo.modulos_sistema")
        linhas = cursor.fetchall()
        cursor.execute("SELECT chave, modulo_dono, abre_modulo FROM dbo.permissoes WHERE modulo_dono IS NOT NULL")
        permissoes = cursor.fetchall()
    finally:
        conn.close()
    base = EstadoModulos()
    nomes, ordem = dict(base.nomes), dict(base.ordem)
    ativos = set(base.ativos)
    for chave, nome, ordem_linha, ativo in linhas:
        chave = str(chave)
        if chave not in MODULOS_VALIDOS:
            continue
        nomes[chave], ordem[chave] = str(nome), int(ordem_linha or 0)
        if not ativo:
            ativos.discard(chave)
    donos = {str(c): str(d) for c, d, _a in permissoes if str(d) in MODULOS_VALIDOS}
    abre = {str(c): bool(a) for c, d, a in permissoes if str(d) in MODULOS_VALIDOS}
    return EstadoModulos(ativos=frozenset(ativos | MODULOS_PROTEGIDOS), nomes=nomes, ordem=ordem, donos=donos, abre=abre, de_banco=True)


def estado() -> EstadoModulos:
    global _cache
    agora = time.monotonic()
    atual = _cache
    if atual is not None and atual[0] > agora:
        return atual[1]
    with _lock:
        atual = _cache
        if atual is not None and atual[0] > agora:
            return atual[1]
        try:
            carregado = (_carregador or _carregar_do_banco)()
            _cache = (agora + _TTL_SEGUNDOS, carregado)
        except Exception as exc:  # noqa: BLE001 - qualquer falha de leitura cai nos defaults do catálogo
            logger.warning("Estado de módulos indisponível (%s); usando padrões do catálogo (tudo ativo).", exc)
            carregado = EstadoModulos()
            _cache = (agora + _TTL_FALHA_SEGUNDOS, carregado)
        return carregado


def invalidar_cache() -> None:
    """Chamar após qualquer escrita em módulos/donos: o próximo pedido relê o banco."""
    global _cache
    with _lock:
        _cache = None


def definir_carregador(carregador: Callable[[], EstadoModulos] | None) -> None:
    """Só para testes: substitui a leitura do banco."""
    global _carregador
    _carregador = carregador
    invalidar_cache()


# ---------------------------------------------------------------- consultas
def modulo_ativo(modulo: str) -> bool:
    return modulo in MODULOS_PROTEGIDOS or modulo in estado().ativos


def modulo_da_permissao(chave: str, grupo: str = "") -> str:
    """Dono vigente (banco) com fallback no catálogo em código."""
    dono = estado().donos.get(chave)
    if dono:
        return dono
    if not grupo:
        from ..rbac import PERMISSION_DEFINITIONS

        definicao = PERMISSION_DEFINITIONS.get(chave)
        grupo = definicao.module if definicao else ""
    return modulo_dono_padrao(chave, grupo)


def modulo_aberto_por(chave: str) -> str | None:
    """Módulo que esta permissão abre, ou None."""
    est = estado()
    if chave in est.abre:
        return modulo_da_permissao(chave) if est.abre[chave] else None
    return ABRE_MODULO_PADRAO.get(chave)


def filtrar_permissoes(permissoes: Iterable[str]) -> frozenset[str]:
    """Remove as permissões de módulos desativados. Com todos ativos devolve exatamente o mesmo conjunto."""
    todas = frozenset(permissoes)
    est = estado()
    inativos = {chave for chave, *_ in MODULOS_PADRAO} - set(est.ativos) - MODULOS_PROTEGIDOS
    if not inativos:
        return todas
    return frozenset(p for p in todas if modulo_da_permissao(p) not in inativos)


def modulos_visiveis(permissoes: Iterable[str]) -> list[str]:
    """Módulos (exceto core) que o conjunto de permissões abre, módulos ativos, na ordem de exibição."""
    est = estado()
    abertos = {m for p in permissoes if (m := modulo_aberto_por(p)) and m != MODULO_CORE and modulo_ativo(m)}
    return sorted(abertos, key=lambda m: (est.ordem.get(m, 99), m))


def pode(permissoes: Iterable[str], permissao: str) -> bool:
    """Permissão concedida E módulo dono ativo."""
    return permissao in permissoes and modulo_ativo(modulo_da_permissao(permissao))


def descrever(permissoes: Iterable[str]) -> dict:
    """Payload de `GET /core/acesso`: módulos, padrão e permissões efetivas (já sem as de módulos desativados)."""
    efetivas = filtrar_permissoes(permissoes)
    est = estado()
    visiveis = modulos_visiveis(efetivas)
    modulos = [
        {
            "chave": chave,
            "nome": est.nomes.get(chave, nome),
            "ativo": modulo_ativo(chave),
            "protegido": chave in MODULOS_PROTEGIDOS,
            "visivel": chave in visiveis,
        }
        for chave, nome, _o, _p in sorted(MODULOS_PADRAO, key=lambda m: est.ordem.get(m[0], m[2]))
        if chave != MODULO_CORE
    ]
    return {
        "modulos": modulos,
        "modulo_padrao": visiveis[0] if visiveis else MODULO_CORE,
        "permissoes": sorted(efetivas),
    }

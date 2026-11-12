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
class Unidade:
    chave: str
    nome: str
    tipo: str  # 'operacao' | 'setor'
    modulo: str  # o único módulo a que pertence
    ativo: bool


@dataclass(frozen=True)
class Excecao:
    alvo_tipo: str  # 'perfil' | 'usuario'
    id_perfil: str | None
    id_usuario: int | None
    unidade: str | None  # None = vale em qualquer unidade
    chave: str
    efeito: str  # 'conceder' | 'retirar'


@dataclass(frozen=True)
class FotoAcessos:
    permissoes: dict[str, frozenset[str]] = field(default_factory=dict)  # perfil -> permissões permitidas
    modulos_perfil: dict[str, frozenset[str]] = field(default_factory=dict)  # perfil -> módulos liberados (V060)
    modulos_usuario: dict[int, frozenset[str]] = field(default_factory=dict)  # id_usuario -> módulos liberados (V060)
    unidades: dict[str, "Unidade"] = field(default_factory=dict)  # chave da operação/setor -> unidade (V070)
    excecoes: tuple["Excecao", ...] = ()  # V071 (Etapa 5)
    perfil_do_usuario: dict[int, str] = field(default_factory=dict)  # perfil ATUAL de cada usuário (troca sem relogin)
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
        excecoes = _ler_tabela(cursor, "SELECT alvo_tipo, id_perfil, id_usuario, unidade, chave_permissao, efeito FROM dbo.acesso_excecoes")
        perfis_usuarios = _ler_tabela(cursor, "SELECT id_usuario, perfil_id FROM dbo.usuarios WHERE perfil_id IS NOT NULL")
        # V070 pode não estar aplicada: sem as colunas, toda unidade é operação do módulo Operação (o que vale hoje).
        unidades = _ler_tabela(cursor, "SELECT chave, nome, tipo, modulo, ativo FROM dbo.operacoes WHERE chave IS NOT NULL") or [
            (c, n, "operacao", "operacao", a) for c, n, a in _ler_tabela(cursor, "SELECT chave, nome, ativo FROM dbo.operacoes WHERE chave IS NOT NULL")
        ]
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
        unidades={str(c): Unidade(str(c), str(n or c), str(t or "operacao"), str(m or "operacao"), bool(a)) for c, n, t, m, a in unidades},
        excecoes=tuple(
            Excecao(str(t), str(p) if p else None, int(u) if u is not None else None, str(un).strip() if un else None, str(c), str(e))
            for t, p, u, un, c, e in excecoes
        ),
        perfil_do_usuario={int(i): normalize_role_id(str(p)) for i, p in perfis_usuarios},
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
    """Módulos liberados (V060) somados às exceções `modulo.<chave>.abrir` (V071). 'retirar' tira."""
    atual = foto()
    extras = set(atual.modulos_perfil.get(perfil or "", frozenset()))
    if id_usuario:
        extras |= atual.modulos_usuario.get(int(id_usuario), frozenset())
    for e in excecoes_de(perfil, id_usuario):
        if e.chave.startswith("modulo.") and e.chave.endswith(".abrir") and e.unidade is None:
            modulo = e.chave[len("modulo."):-len(".abrir")]
            (extras.add if e.efeito == "conceder" else extras.discard)(modulo)
    return frozenset(extras)


def excecoes_de(perfil: str | None, id_usuario: int | None) -> list[Excecao]:
    """Exceções que valem para esta pessoa: as do perfil dela e as dela mesma."""
    lista = []
    for e in foto().excecoes:
        if e.alvo_tipo == "perfil" and perfil and e.id_perfil == perfil:
            lista.append(e)
        elif e.alvo_tipo == "usuario" and id_usuario and e.id_usuario == int(id_usuario):
            lista.append(e)
    return lista


def perfil_atual(id_usuario: int | None) -> str | None:
    """Perfil vigente do usuário no banco (troca de perfil vale sem relogin). None = não sabe, vale o token."""
    if not id_usuario:
        return None
    atual = foto()
    return atual.perfil_do_usuario.get(int(id_usuario)) if atual.ok else None


def unidade(chave: str | None) -> Unidade | None:
    return foto().unidades.get(str(chave or ""))


def modulo_da_unidade(chave: str | None) -> str | None:
    """Módulo a que a operação/setor pertence (uma unidade, um módulo). None = unidade desconhecida."""
    u = unidade(chave)
    return u.modulo if u else None


def unidades_do_modulo(modulo: str, *, so_ativas: bool = True) -> list[Unidade]:
    """Opções do "Vale para" da Central de Acessos: só as unidades do módulo aberto."""
    lista = [u for u in foto().unidades.values() if u.modulo == modulo and (u.ativo or not so_ativas)]
    return sorted(lista, key=lambda u: (u.tipo, u.nome.lower()))


def invalidar() -> None:
    global _cache
    with _lock:
        _cache = None
        _memo_efetivas.clear()


# Permissões efetivas por (perfil, usuário, unidades): calculadas uma vez e reaproveitadas até o cache mudar.
_memo_efetivas: dict[tuple, frozenset[str]] = {}


def definir_carregador(carregador: Callable[[], FotoAcessos] | None) -> None:
    global _carregador, _leituras
    _carregador = carregador
    _leituras = 0
    invalidar()


def leituras() -> int:
    """Quantas vezes o banco foi lido desde o último `definir_carregador` (usado nos testes de desempenho)."""
    return _leituras

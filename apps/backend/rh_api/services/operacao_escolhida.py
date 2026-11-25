"""Seletor de operação do topo (módulo Operação, pedido do Paulo 25/nov/2026).

Quem enxerga 2 ou mais operações escolhe UMA no topo; o navegador manda a escolha no cabeçalho
``X-Conecta-Operacao`` e o servidor estreita ``user.operacoes`` para ela (``OperacaoEscolhida``). Todas as rotas da
Operação (WFM, Monitoria, Equipes, Diário, Painel, Relatórios) já filtram por ``user.operacoes``/escopos, então passam
a devolver só a operação escolhida. Sem cabeçalho = a primeira da lista (a mesma que o topo mostra). Escolha fora
da lista = ignorada (vale o de antes). Nunca abre nada.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import replace

from ..alcance import TODOS, alcance
from ..auth import OperacaoEscolhida
from ..modulos_catalogo import MODULO_OPERACAO

CABECALHO_OPERACAO = "X-Conecta-Operacao"
logger = logging.getLogger(__name__)
_TTL = 30.0
_lock = threading.Lock()
_cache_vinculos: dict[int, tuple[float, frozenset[str]]] = {}


def _ler_vinculos_do_banco(id_usuario: int) -> frozenset[str]:
    from ..config import get_settings
    from ..db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (int(id_usuario),))
        return frozenset(str(r[0]).strip() for r in cursor.fetchall() if r[0])
    finally:
        conn.close()


_leitor = _ler_vinculos_do_banco  # trocado nos testes


def vinculos_atuais(user) -> frozenset[str]:
    """Operações liberadas à pessoa (Usuários > operações vinculadas), lidas do banco com cache de 30 s, para valer sem
    novo login. Falha na leitura = os vínculos do token."""
    do_token = user.operacoes.originais if isinstance(user.operacoes, OperacaoEscolhida) else user.operacoes
    if not getattr(user, "id_usuario", None):
        return frozenset(do_token)
    agora = time.monotonic()
    guardado = _cache_vinculos.get(int(user.id_usuario))
    if guardado and guardado[0] > agora:
        return guardado[1]
    try:
        lidos = _leitor(int(user.id_usuario))
    except Exception as exc:  # noqa: BLE001 - sem banco: vale o token
        logger.info("Vínculos de operação indisponíveis (%s); usando os do login.", exc)
        return frozenset(do_token)
    with _lock:
        _cache_vinculos[int(user.id_usuario)] = (agora + _TTL, lidos)
    return lidos


def limpar_cache() -> None:
    with _lock:
        _cache_vinculos.clear()


def operacoes_escolhiveis(user) -> list[dict]:
    """Operações que a pessoa pode escolher no topo (só as do módulo Operação, ativas), em ordem de nome."""
    from . import acesso_cache

    try:
        unidades = acesso_cache.unidades_do_modulo(MODULO_OPERACAO)
    except Exception:  # noqa: BLE001 - sem cadastro de unidades: sem seletor
        return []
    # Quem tem operações liberadas vê SÓ elas, qualquer que seja o alcance do perfil (correção 25/11: Control Desk e
    # Gestor viam todas). Lista completa só para perfil global SEM nenhuma operação liberada (ex.: Administrador).
    vinculos = {str(v).strip().upper() for v in vinculos_atuais(user)}
    a = alcance(user.perfil)
    if vinculos:
        lista = [u for u in unidades if u.chave.upper() in vinculos]
    elif a.wfm == TODOS or a.monitoria == TODOS:
        lista = [u for u in unidades if u.tipo == "operacao"] or list(unidades)
    else:
        lista = []
    lista.sort(key=lambda u: u.nome.lower())
    return [{"chave": u.chave, "nome": u.nome} for u in lista]


def aplicar(user, valor: str | None, modulo_aberto: str):
    """Estreita `user.operacoes` para a operação do cabeçalho, se ela estiver entre as escolhíveis."""
    if modulo_aberto != MODULO_OPERACAO:
        return user
    opcoes = [op["chave"] for op in operacoes_escolhiveis(user)]
    if not opcoes:  # nenhuma operação a escolher: vale o escopo de antes
        return user
    chave = str(valor or "").strip()
    if chave not in opcoes:  # sem escolha, ou forçada fora do permitido: a primeira da lista, igual ao topo
        chave = opcoes[0]
    vinculos = vinculos_atuais(user)
    return replace(user, operacoes=OperacaoEscolhida({chave}, (vinculos | {chave}) if vinculos else vinculos))

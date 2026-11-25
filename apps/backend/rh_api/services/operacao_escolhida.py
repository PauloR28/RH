"""Seletor de operação do topo (módulo Operação, pedido do Paulo 25/nov/2026).

Quem enxerga 2 ou mais operações escolhe UMA no topo; o navegador manda a escolha no cabeçalho
``X-Conecta-Operacao`` e o servidor estreita ``user.operacoes`` para ela (``OperacaoEscolhida``). Todas as rotas da
Operação (WFM, Monitoria, Equipes, Diário, Painel, Relatórios) já filtram por ``user.operacoes``/escopos, então passam
a devolver só a operação escolhida. Sem cabeçalho = a primeira da lista (a mesma que o topo mostra). Escolha fora
da lista = ignorada (vale o de antes). Nunca abre nada.
"""

from __future__ import annotations

from dataclasses import replace

from ..alcance import TODOS, alcance
from ..auth import OperacaoEscolhida
from ..modulos_catalogo import MODULO_OPERACAO

CABECALHO_OPERACAO = "X-Conecta-Operacao"


def operacoes_escolhiveis(user) -> list[dict]:
    """Operações que a pessoa pode escolher no topo (só as do módulo Operação, ativas), em ordem de nome."""
    from . import acesso_cache

    try:
        unidades = acesso_cache.unidades_do_modulo(MODULO_OPERACAO)
    except Exception:  # noqa: BLE001 - sem cadastro de unidades: sem seletor
        return []
    vinculos = user.operacoes.originais if isinstance(user.operacoes, OperacaoEscolhida) else user.operacoes
    a = alcance(user.perfil)
    if a.wfm == TODOS or a.monitoria == TODOS:
        lista = [u for u in unidades if u.tipo == "operacao"] or list(unidades)
    else:
        lista = [u for u in unidades if u.chave in vinculos]
    lista.sort(key=lambda u: u.nome.lower())
    return [{"chave": u.chave, "nome": u.nome} for u in lista]


def aplicar(user, valor: str | None, modulo_aberto: str):
    """Estreita `user.operacoes` para a operação do cabeçalho, se ela estiver entre as escolhíveis."""
    if modulo_aberto != MODULO_OPERACAO:
        return user
    opcoes = [op["chave"] for op in operacoes_escolhiveis(user)]
    if len(opcoes) < 2:  # uma operação só (ou nenhuma): sem seletor, nada muda
        return user
    chave = str(valor or "").strip() or opcoes[0]  # sem escolha ainda: a primeira da lista, igual ao topo
    if chave not in opcoes:
        return user
    return replace(user, operacoes=OperacaoEscolhida({chave}, user.operacoes))

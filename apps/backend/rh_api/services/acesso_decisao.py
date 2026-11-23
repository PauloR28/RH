"""Regra ÚNICA de decisão de acesso (Central de Acessos).

Responde uma pergunta só: "esta pessoa pode fazer isto, nesta unidade?". As camadas vão de fora para dentro e cada uma
só FECHA a porta; nenhuma camada de dentro reabre o que uma de fora fechou (desenho aprovado em 12/nov/2026):

  1. módulo   — módulo dono da permissão ativo (inclui áreas inativas e sessões de funções do módulo desligado);
  2. unidade  — usuário restrito precisa estar vinculado à unidade (operação/setor) do recurso, quando houver unidade;
  3. função   — ligada no módulo e na unidade (entra na Etapa 4; hoje função é só visibilidade de menu);
  4. perfil   — a permissão do perfil, depois das exceções (exceções entram na Etapa 5).

Ela decide os acessos de todo pedido (`dependencies.get_current_user` → `permissoes_efetivas`). O modo sombra e a chave
RH_ACESSO_REGRA_UNICA saíram na limpeza da reestruturação (Etapa 10, nov/2026): em produção ela já mandava.
Tudo aqui é em memória (usa o cache de `services/acesso.py`): nenhuma ida ao banco por pedido.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import AbstractSet, Iterable

from ..modulos_catalogo import MODULO_CORE
from . import acesso

CAMADA_MODULO = "modulo"
CAMADA_UNIDADE = "unidade"
CAMADA_FUNCAO = "funcao"
CAMADA_PERFIL = "perfil"


@dataclass(frozen=True)
class Decisao:
    pode: bool
    camada: str  # camada que decidiu (a que fechou a porta, ou "perfil" quando liberou)
    motivo: str


def decidir(
    permissoes: AbstractSet[str],
    permissao: str,
    *,
    unidade: str | None = None,
    unidades_do_usuario: AbstractSet[str] | None = None,
    restrito: bool = False,
    perfil: str | None = None,
    id_usuario: int | None = None,
) -> Decisao:
    """Decide UMA permissão. `permissoes` = conjunto do perfil. `unidade` = chave da operação/setor do recurso, se houver.
    Sem `unidade`, a camada função olha as unidades da pessoa: fecha só se a função estiver desligada em TODAS elas
    (mesma regra do menu do item 16). Pessoa sem unidade: vale o global."""
    # 1. Módulo: o filtro de hoje já cobre módulo desativado, áreas inativas e sessões das funções do módulo desligado.
    if permissao not in acesso.filtrar_permissoes({permissao}):
        modulo = acesso.modulo_da_permissao(permissao)
        return Decisao(False, CAMADA_MODULO, f"Módulo '{modulo}' ou área desligada.")
    # 2. Unidade: só vale para quem é restrito ao escopo de operações e quando o recurso tem unidade.
    if unidade is not None and restrito and unidade not in (unidades_do_usuario or frozenset()):
        return Decisao(False, CAMADA_UNIDADE, f"Sem vínculo com a unidade {unidade}.")
    # 3. Função (Etapa 4): desligada no módulo da unidade ou na unidade.
    fechou = _funcao_fechada(permissao, unidade, unidades_do_usuario)
    if fechou:
        return Decisao(False, CAMADA_FUNCAO, fechou)
    # 4. Perfil, depois das exceções (Etapa 5): pessoa > perfil na unidade > padrão. No mesmo nível, 'retirar' vence.
    if perfil or id_usuario:
        resposta = _por_excecao(permissao, perfil, id_usuario, unidade, unidades_do_usuario)
        if resposta is not None:
            return resposta
    if permissao in permissoes:
        return Decisao(True, CAMADA_PERFIL, "Permitido pelo perfil.")
    return Decisao(False, CAMADA_PERFIL, "O perfil não tem esta permissão.")


def _nivel(excecoes, alvo_tipo: str, unidades: list[str | None]) -> bool | None:
    efeitos = {e.efeito for e in excecoes if e.alvo_tipo == alvo_tipo and (e.unidade is None or e.unidade in unidades)}
    if "retirar" in efeitos:
        return False
    if "conceder" in efeitos:
        return True
    return None


def _por_excecao(permissao, perfil, id_usuario, unidade, unidades_do_usuario) -> Decisao | None:
    """Resposta da camada perfil quando há exceção para esta permissão; None = nenhuma exceção se aplica (vale o perfil).
    Com unidade no pedido, vale a dela. Sem unidade, a pessoa pode se puder em ALGUMA das suas unidades."""
    from . import acesso_cache

    excecoes = [e for e in acesso_cache.excecoes_de(perfil, id_usuario) if e.chave == permissao]
    if not excecoes:
        return None
    grupos = [[unidade]] if unidade else ([[u] for u in sorted(unidades_do_usuario)] if unidades_do_usuario else [[None]])
    achadas = []
    for unidades in grupos:
        valor, rotulo = None, ""
        for alvo, nome in (("usuario", "exceção da pessoa"), ("perfil", "exceção do perfil")):
            valor = _nivel(excecoes, alvo, unidades)
            if valor is not None:
                rotulo = nome
                break
        achadas.append((valor, rotulo))
    if all(v is None for v, _ in achadas):
        return None
    for valor, rotulo in achadas:
        if valor:
            return Decisao(True, CAMADA_PERFIL, f"Permitido por {rotulo}.")
    if any(v is None for v, _ in achadas):
        return None  # numa das unidades não há exceção: vale o perfil
    return Decisao(False, CAMADA_PERFIL, f"Retirado por {achadas[0][1]}.")


def _funcao_fechada(permissao: str, unidade: str | None, unidades_do_usuario: AbstractSet[str] | None) -> str:
    """Motivo do fechamento pela camada função, ou "" quando ela não fecha."""
    from ..modulos_catalogo import funcao_da_permissao
    from . import acesso_cache

    funcao = funcao_da_permissao(permissao)
    if not funcao:
        return ""
    if not acesso.funcao_ligada_em_algum_modulo(funcao):
        return f"Função '{funcao}' desligada em todos os módulos."
    alvo = [unidade] if unidade else sorted(unidades_do_usuario or ())
    # Só contam as unidades do MESMO módulo da permissão (16/nov/2026). Antes, uma permissão do RH (ex.:
    # sessao.processos.acessar) era julgada pelas funções da Operação da pessoa (CRF etc.), onde Processos fica
    # desligado, e sumia: a Gestora com Operação e RH perdia todas as sessões do RH e o RH saía do seletor.
    # Permissão do `core` (comum a todos os módulos) continua seguindo a unidade, como antes.
    dono = acesso.modulo_da_permissao(permissao)
    if dono != MODULO_CORE:
        alvo = [u for u in alvo if acesso_cache.modulo_da_unidade(u) in (None, dono)]
    if not alvo:
        return ""
    ligadas = [u for u in alvo if acesso.funcao_ligada_na_unidade(funcao, u, acesso_cache.modulo_da_unidade(u))]
    if ligadas:
        return ""
    return f"Função '{funcao}' desligada " + (f"na unidade {unidade}." if unidade else "em todas as unidades da pessoa.")


def decidir_rota(
    permissoes: AbstractSet[str],
    requeridas: Iterable[str],
    *,
    exigir_todas: bool = False,
    unidades_do_usuario: AbstractSet[str] | None = None,
) -> bool:
    """Mesma semântica de `require_permissions`: uma das requeridas basta, ou todas com `exigir_todas`."""
    lista = tuple(p for p in requeridas if p)
    if not lista:
        return True
    verificar = all if exigir_todas else any
    return verificar(decidir(permissoes, p, unidades_do_usuario=unidades_do_usuario).pode for p in lista)


def permissoes_efetivas(
    permissoes: AbstractSet[str], *, perfil: str | None, id_usuario: int | None, unidades_do_usuario: AbstractSet[str] | None
) -> frozenset[str]:
    """Conjunto final de permissões da pessoa pela regra única (todas as camadas e exceções). Memorizado até o cache mudar."""
    from . import acesso_cache

    chave = (perfil, id_usuario, frozenset(unidades_do_usuario or ()), frozenset(permissoes))
    memo = acesso_cache._memo_efetivas.get(chave)
    if memo is not None:
        return memo
    candidatas = set(permissoes) | {e.chave for e in acesso_cache.excecoes_de(perfil, id_usuario) if e.efeito == "conceder"}
    efetivas = frozenset(
        p for p in candidatas
        if decidir(permissoes, p, unidades_do_usuario=unidades_do_usuario, perfil=perfil, id_usuario=id_usuario).pode
    )
    acesso_cache._memo_efetivas[chave] = efetivas
    return efetivas


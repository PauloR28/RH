"""Escopo de acesso da Monitoria (promt.txt §2 — DENY por padrão).

Funções puras (sem banco). Toda consulta/rota da Monitoria passa por aqui
antes de devolver dados; esconder botão na tela nunca é a única barreira.

Resumo das regras:
  * Administrador, Gestor e Control Desk: todas as operações.
  * Supervisor / Qualidade: somente as operações vinculadas (sem vínculo =
    nenhum acesso). Supervisor vê DETALHE só de operadores que supervisiona;
    Qualidade vê o detalhe de toda a operação vinculada.
  * Operador: somente os próprios dados.
  * Qualquer outro perfil que receba permissões de Monitoria do Administrador
    segue a regra restrita (vínculos de operação) — nunca global por omissão.
"""

from __future__ import annotations

from typing import Iterable

from ..auth import OperacaoEscolhida

from ..alcance import ALCANCES, EQUIPE, PROPRIO, TODOS, alcance, perfis_com  # noqa: E402

PERFIS_GLOBAIS = perfis_com(monitoria=TODOS)  # Etapa 5: vem do alcance

# Limite de operações vinculadas por perfil (respostas do RH, 20/set/2026).
LIMITE_OPERACOES: dict[str, int | None] = {p: a.max_unidades for p, a in ALCANCES.items() if a.max_unidades is not None}
MAX_SUPERVISORES_OPERADOR = 2

# Hierarquia de quem pode criar/alterar quem dentro da Monitoria (§2.6).
_PODE_GERENCIAR: dict[str, frozenset[str]] = {p: a.gerencia for p, a in ALCANCES.items() if a.gerencia}


def escopo_global(perfil: str) -> bool:
    return alcance(perfil).monitoria == TODOS


def operacoes_permitidas(perfil: str, operacoes_usuario: Iterable[str]) -> frozenset[str] | None:
    """`None` = todas as operações; conjunto (possivelmente vazio) = restrito."""
    escolhida = operacoes_usuario if isinstance(operacoes_usuario, OperacaoEscolhida) else None
    vinculos = escolhida.originais if escolhida is not None else operacoes_usuario
    base = None if escopo_global(perfil) else frozenset(item for item in vinculos if item)
    if escolhida is not None:  # seletor de operação do topo: só a escolhida, dentro do que já via
        return frozenset(escolhida) if base is None else frozenset(escolhida) & base
    return base


def pode_ver_operacao(perfil: str, operacoes_usuario: Iterable[str], operacao: str | None) -> bool:
    permitidas = operacoes_permitidas(perfil, operacoes_usuario)
    if permitidas is None:
        return True
    return bool(operacao) and operacao in permitidas


def pode_ver_detalhe_monitoria(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_operador: int,
    operadores_supervisionados: Iterable[int] = (),
) -> bool:
    """Detalhe de UMA monitoria (critérios, notas, observações...)."""
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if alcance(perfil).monitoria == PROPRIO:
        return id_usuario is not None and id_operador == id_usuario
    if alcance(perfil).monitoria == EQUIPE:
        return id_operador in set(operadores_supervisionados)
    return True  # admin, gestor, control desk, qualidade (já validado por operação)


def pode_gerenciar_perfil(ator_perfil: str, alvo_perfil: str) -> bool:
    from ..rbac import papel  # perfis criados pela tela seguem o perfil com que funcionam (Etapa 9)

    return papel(alvo_perfil) in _PODE_GERENCIAR.get(papel(ator_perfil), frozenset())


def validar_vinculos(
    perfil: str,
    operacoes: list[str],
    supervisores: list[int],
) -> list[str]:
    """Erros de vínculo organizacional coerentes com o perfil do usuário."""
    erros: list[str] = []
    a = alcance(perfil)
    limite = a.max_unidades
    nome = a.rotulo or "Este perfil"
    if limite is not None and a.min_unidades == limite and len(operacoes) != limite:
        erros.append(f"O {nome} deve estar vinculado a exatamente {limite} operação.")
    elif limite is not None and len(operacoes) > limite:
        erros.append(f"{nome} pode ter no máximo {limite} operações.")
    elif a.min_unidades and not operacoes:
        artigo = "A" if nome == "Qualidade" else "O"
        erros.append(f"{artigo} {nome} precisa estar {'vinculada' if artigo == 'A' else 'vinculado'} a ao menos 1 operação.")
    if a.exige_supervisor:
        if not supervisores:
            erros.append("O Operador precisa de ao menos 1 supervisor responsável.")
        if len(set(supervisores)) > MAX_SUPERVISORES_OPERADOR:
            erros.append(f"O Operador pode ter no máximo {MAX_SUPERVISORES_OPERADOR} supervisores.")
    elif supervisores:
        erros.append("Somente o Operador possui supervisor responsável.")
    # Control Desk: na Monitoria segue global (vínculo opcional e sem efeito ali); o WFM usa o vínculo
    # para limitar as operações em que ele edita a escala (sem vínculo = nenhuma operação no WFM).
    return erros

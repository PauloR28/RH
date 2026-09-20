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

from ..rbac import (
    ROLE_ADMIN,
    ROLE_CONTROL_DESK,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_QUALIDADE,
    ROLE_SUPERVISOR,
)

PERFIS_GLOBAIS = frozenset({ROLE_ADMIN, ROLE_MANAGER, ROLE_CONTROL_DESK})

# Limite de operações vinculadas por perfil (respostas do RH, 20/set/2026).
LIMITE_OPERACOES: dict[str, int | None] = {
    ROLE_OPERATOR: 1,
    ROLE_SUPERVISOR: 3,
    ROLE_QUALIDADE: 2,
}
MAX_SUPERVISORES_OPERADOR = 2

# Hierarquia de quem pode criar/alterar quem dentro da Monitoria (§2.6).
_PODE_GERENCIAR: dict[str, frozenset[str]] = {
    ROLE_ADMIN: frozenset({ROLE_ADMIN, ROLE_MANAGER, ROLE_SUPERVISOR, ROLE_QUALIDADE, ROLE_CONTROL_DESK, ROLE_OPERATOR}),
    ROLE_SUPERVISOR: frozenset({ROLE_QUALIDADE, ROLE_CONTROL_DESK, ROLE_OPERATOR}),
    ROLE_QUALIDADE: frozenset({ROLE_OPERATOR}),
}


def escopo_global(perfil: str) -> bool:
    return perfil in PERFIS_GLOBAIS


def operacoes_permitidas(perfil: str, operacoes_usuario: Iterable[str]) -> frozenset[str] | None:
    """`None` = todas as operações; conjunto (possivelmente vazio) = restrito."""
    if escopo_global(perfil):
        return None
    return frozenset(item for item in operacoes_usuario if item)


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
    if perfil == ROLE_OPERATOR:
        return id_usuario is not None and id_operador == id_usuario
    if perfil == ROLE_SUPERVISOR:
        return id_operador in set(operadores_supervisionados)
    return True  # admin, gestor, control desk, qualidade (já validado por operação)


def pode_gerenciar_perfil(ator_perfil: str, alvo_perfil: str) -> bool:
    return alvo_perfil in _PODE_GERENCIAR.get(ator_perfil, frozenset())


def validar_vinculos(
    perfil: str,
    operacoes: list[str],
    supervisores: list[int],
) -> list[str]:
    """Erros de vínculo organizacional coerentes com o perfil do usuário."""
    erros: list[str] = []
    limite = LIMITE_OPERACOES.get(perfil)
    if perfil == ROLE_OPERATOR and len(operacoes) != 1:
        erros.append("O Operador deve estar vinculado a exatamente 1 operação.")
    elif limite is not None and len(operacoes) > limite:
        nome = {ROLE_SUPERVISOR: "Supervisor", ROLE_QUALIDADE: "Qualidade"}.get(perfil, "Este perfil")
        erros.append(f"{nome} pode ter no máximo {limite} operações.")
    if perfil == ROLE_SUPERVISOR and not operacoes:
        erros.append("O Supervisor precisa estar vinculado a ao menos 1 operação.")
    if perfil == ROLE_QUALIDADE and not operacoes:
        erros.append("A Qualidade precisa estar vinculada a ao menos 1 operação.")
    if perfil == ROLE_OPERATOR:
        if not supervisores:
            erros.append("O Operador precisa de ao menos 1 supervisor responsável.")
        if len(set(supervisores)) > MAX_SUPERVISORES_OPERADOR:
            erros.append(f"O Operador pode ter no máximo {MAX_SUPERVISORES_OPERADOR} supervisores.")
    elif supervisores:
        erros.append("Somente o Operador possui supervisor responsável.")
    if perfil == ROLE_CONTROL_DESK and operacoes:
        erros.append("O Control Desk enxerga todas as operações e não recebe vínculo de operação.")
    return erros

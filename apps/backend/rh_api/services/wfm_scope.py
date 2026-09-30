"""Escopo de acesso do WFM (DENY por padrão). Funções puras, sem banco.

Toda rota do WFM passa por aqui no servidor; ocultar botão no front nunca é a
única barreira. Regras:
  * Administrador e Gestor: todas as operações (Administrador só configura e
    lê — NUNCA edita escala, lança presença, publica nem fecha).
  * Control Desk / Qualidade: somente operações vinculadas (sem vínculo = nada).
  * Supervisor: operações vinculadas E, para escala/presença, só operadores da
    própria equipe (`usuarios_supervisores`).
  * Operador: somente a própria escala.
  * Conflito de interesse (todos os perfis): ninguém edita a escala em que é a
    própria parte envolvida.
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

PERFIS_GLOBAIS = frozenset({ROLE_ADMIN, ROLE_MANAGER})


def operacoes_permitidas(perfil: str, operacoes_usuario: Iterable[str]) -> frozenset[str] | None:
    """`None` = todas as operações; conjunto (possivelmente vazio) = restrito."""
    if perfil in PERFIS_GLOBAIS:
        return None
    return frozenset(item for item in operacoes_usuario if item)


def pode_ver_operacao(perfil: str, operacoes_usuario: Iterable[str], operacao: str | None) -> bool:
    permitidas = operacoes_permitidas(perfil, operacoes_usuario)
    if permitidas is None:
        return True
    return bool(operacao) and operacao in permitidas


def conflito_de_interesse(id_usuario: int | None, id_operador: int) -> bool:
    return id_usuario is not None and id_usuario == id_operador


def pode_ver_escala_de(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_operador: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Leitura da escala de UM operador."""
    if perfil == ROLE_OPERATOR:
        return id_usuario is not None and id_operador == id_usuario and pode_ver_operacao(perfil, operacoes_usuario, operacao)
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if perfil == ROLE_SUPERVISOR:
        return id_operador == id_usuario or id_operador in set(equipe_supervisor)
    return perfil in (ROLE_ADMIN, ROLE_MANAGER, ROLE_CONTROL_DESK, ROLE_QUALIDADE)


def pode_editar_escala_de(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_operador: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Edição da escala / lançamento de presença de UM operador."""
    if perfil == ROLE_ADMIN or perfil not in (ROLE_MANAGER, ROLE_CONTROL_DESK, ROLE_SUPERVISOR):
        return False
    if conflito_de_interesse(id_usuario, id_operador):
        return False
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if perfil == ROLE_SUPERVISOR:
        return id_operador in set(equipe_supervisor)
    return True


def pode_editar_cadastros(perfil: str) -> bool:
    return perfil in (ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_SUPERVISOR)


def pode_editar_contratos(perfil: str) -> bool:
    """Contratos e limites do motor: só Administrador e Control Desk."""
    return perfil in (ROLE_ADMIN, ROLE_CONTROL_DESK)

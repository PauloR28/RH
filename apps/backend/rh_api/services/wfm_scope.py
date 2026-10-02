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
    ROLE_ANALISTA_TI,
    ROLE_CONTROL_DESK,
    ROLE_MANAGER,
    ROLE_QUALIDADE,
    ROLE_SUPERVISOR,
    WFM_PERFIS_PARTICIPANTES,
)

PERFIS_GLOBAIS = frozenset({ROLE_ADMIN, ROLE_MANAGER})
# Perfis que gerem a escala de uma operação (Analista de TI = Gestor do setor de TI, limitado à operação TI).
PERFIS_GESTAO = (ROLE_MANAGER, ROLE_CONTROL_DESK, ROLE_SUPERVISOR, ROLE_ANALISTA_TI)
SEPARADOR_TIPO = "::"
# Operações cuja escala principal não existe: só há as escalas criadas (tipos). Ex.: setor de TI.
OPERACOES_SO_TIPOS = frozenset({"TI"})


def operacao_base(operacao: str | None) -> str:
    """Chave da operação real. Cada tipo de escala do TI usa uma chave virtual `TI::PLANTAO-SABADO`."""
    return str(operacao or "").split(SEPARADOR_TIPO, 1)[0]


def eh_tipo_escala(operacao: str | None) -> bool:
    return SEPARADOR_TIPO in str(operacao or "")


def operacoes_permitidas(perfil: str, operacoes_usuario: Iterable[str]) -> frozenset[str] | None:
    """`None` = todas as operações; conjunto (possivelmente vazio) = restrito."""
    if perfil in PERFIS_GLOBAIS:
        return None
    return frozenset(item for item in operacoes_usuario if item)


def pode_ver_operacao(perfil: str, operacoes_usuario: Iterable[str], operacao: str | None) -> bool:
    permitidas = operacoes_permitidas(perfil, operacoes_usuario)
    if permitidas is None:
        return True
    return bool(operacao) and operacao_base(operacao) in permitidas


def conflito_de_interesse(id_usuario: int | None, id_operador: int, perfil: str = "") -> bool:
    """O Analista de TI (gestor único do setor) aprova/edita a própria escala por decisão do RH."""
    if perfil == ROLE_ANALISTA_TI:
        return False
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
    if perfil in WFM_PERFIS_PARTICIPANTES:
        return id_usuario is not None and id_operador == id_usuario and pode_ver_operacao(perfil, operacoes_usuario, operacao)
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if perfil == ROLE_SUPERVISOR:
        return id_operador == id_usuario or id_operador in set(equipe_supervisor)
    return perfil in (ROLE_ADMIN, ROLE_MANAGER, ROLE_CONTROL_DESK, ROLE_QUALIDADE, ROLE_ANALISTA_TI)


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
    if perfil == ROLE_ADMIN or perfil not in PERFIS_GESTAO:
        return False
    if conflito_de_interesse(id_usuario, id_operador, perfil):
        return False
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if perfil == ROLE_SUPERVISOR:
        return id_operador in set(equipe_supervisor)
    return True


def pode_editar_cadastros(perfil: str) -> bool:
    return perfil in (ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_SUPERVISOR, ROLE_ANALISTA_TI)


def pode_editar_contratos(perfil: str) -> bool:
    """Contratos e limites do motor: só Administrador, Control Desk e Analista de TI (no setor de TI)."""
    return perfil in (ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_ANALISTA_TI)


def pode_editar_tipos_escala(perfil: str) -> bool:
    """Cadastro de tipos de escala do setor de TI (plantão de sábado, sobreaviso...)."""
    return perfil in (ROLE_ADMIN, ROLE_ANALISTA_TI)


def pode_criar_escala(perfil: str) -> bool:
    """Criar, configurar, ativar/desativar, duplicar e excluir escalas: Supervisor, Control Desk e Analista de TI."""
    return perfil in (ROLE_SUPERVISOR, ROLE_CONTROL_DESK, ROLE_ANALISTA_TI)


def pode_aprovar_escala(
    *, perfil: str, id_usuario: int | None, operacoes_usuario: Iterable[str], operacao: str, id_enviou: int | None, ids_na_escala: Iterable[int] = (),
    aprovadores: dict | None = None,
) -> tuple[bool, str]:
    """Aprovar/declinar a escala enviada: Gestor/RH e Supervisor (e o Analista de TI no setor de TI). Ninguém
    aprova a própria escala (quem enviou, ou quem consta nela como operador) — exceto o Analista de TI, gestor
    único do setor. Administrador não decide."""
    if perfil not in (ROLE_MANAGER, ROLE_SUPERVISOR, ROLE_ANALISTA_TI):
        return False, "Somente Gestor ou Supervisor aprovam a escala."
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False, "Esta operação está fora do seu escopo de acesso."
    # Quem aprova é configurável por escala (perfis e/ou usuários); sem configuração vale Supervisor ou Gestor.
    if aprovadores and (aprovadores.get("perfis") or aprovadores.get("usuarios")) and perfil != ROLE_ANALISTA_TI:
        if perfil not in set(aprovadores.get("perfis") or ()) and id_usuario not in set(aprovadores.get("usuarios") or ()):
            return False, "Você não está entre os aprovadores configurados para esta escala."
    if perfil != ROLE_ANALISTA_TI:
        if id_usuario is not None and id_usuario == id_enviou:
            return False, "Você enviou esta escala e não pode aprová-la: peça a outro Gestor ou Supervisor."
        if id_usuario is not None and id_usuario in set(ids_na_escala):
            return False, "Você consta nesta escala como operador e não pode aprová-la."
    return True, ""


def pode_decidir_troca(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_a: int,
    id_b: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Aprovar/reprovar/desfazer uma troca entre A e B. Nunca quem é parte da troca (conflito de
    interesse); Administrador não decide; Supervisor só se A ou B for da sua equipe; Control Desk só nas
    operações vinculadas; Gestor/RH em qualquer operação."""
    if perfil not in PERFIS_GESTAO:
        return False
    if id_usuario is not None and id_usuario in (id_a, id_b):
        return False
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if perfil == ROLE_SUPERVISOR:
        equipe = set(equipe_supervisor)
        return id_a in equipe or id_b in equipe
    return True


def pode_ver_troca(
    *,
    perfil: str,
    id_usuario: int | None,
    operacoes_usuario: Iterable[str],
    operacao: str,
    id_a: int,
    id_b: int,
    equipe_supervisor: Iterable[int] = (),
) -> bool:
    """Leitura de uma troca (inclui o motivo de bloqueio/alerta): só os dois operadores e os gestores
    (Supervisor da equipe, Control Desk, Gestor/RH). Qualquer outro perfil não vê."""
    if perfil in WFM_PERFIS_PARTICIPANTES:
        return id_usuario in (id_a, id_b) and pode_ver_operacao(perfil, operacoes_usuario, operacao)
    if perfil not in PERFIS_GESTAO:
        return False
    if not pode_ver_operacao(perfil, operacoes_usuario, operacao):
        return False
    if perfil == ROLE_SUPERVISOR:
        equipe = set(equipe_supervisor)
        return id_a in equipe or id_b in equipe
    return True

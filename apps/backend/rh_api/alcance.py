"""Alcance de cada perfil (reestruturação da configuração, Etapa 5 — 17/nov/2026).

Antes, as regras perguntavam o NOME do perfil ("é Supervisor?", "é Operador?"). Agora perguntam o ALCANCE: até onde a
pessoa enxerga e o que pode gerir. Assim um perfil novo (Etapa 9: perfis no banco) funciona só escolhendo o alcance,
sem mexer no código.

Níveis de alcance por área (WFM e Monitoria):
  * ``todos``   vê todas as unidades (do módulo aberto).
  * ``unidade`` vê tudo nas unidades a que está ligado.
  * ``equipe``  vê só a própria equipe (operadores que supervisiona) nas suas unidades.
  * ``proprio`` vê só a si mesmo.

Os valores abaixo reproduzem EXATAMENTE as regras de antes (mesmos perfis, mesmos limites).
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace

from .rbac import (
    ROLE_ADMIN,
    ROLE_ANALISTA_TI,
    ROLE_CONTROL_DESK,
    ROLE_MANAGER,
    ROLE_OPERATOR,
    ROLE_QUALIDADE,
    ROLE_SUPERVISOR,
    ROLE_TEC_JUNIOR,
    ROLE_TEC_PLENO,
    ROLE_TEC_SENIOR,
)

TODOS = "todos"
UNIDADE = "unidade"
EQUIPE = "equipe"
PROPRIO = "proprio"
NIVEIS = (TODOS, UNIDADE, EQUIPE, PROPRIO)


@dataclass(frozen=True)
class Alcance:
    wfm: str = UNIDADE
    monitoria: str = UNIDADE
    gere_escala: bool = False  # monta a escala de uma operação (antes: PERFIS_GESTAO)
    aprova_propria_escala: bool = False  # gestor único do setor: aprova escala em que consta (antes: Analista de TI)
    min_unidades: int = 0  # Monitoria: mínimo de operações ligadas
    max_unidades: int | None = None  # Monitoria: máximo de operações ligadas (None = sem limite)
    exige_supervisor: bool = False  # Monitoria: precisa de supervisor responsável (antes: Operador)
    gerencia: frozenset[str] = frozenset()  # perfis que pode criar/alterar na Monitoria (§2.6)
    rotulo: str = ""  # nome usado nas mensagens de vínculo
    total: bool = False  # passa por cima dos limites de escopo e hierarquia (antes: "é Administrador?")
    avalia_monitoria: bool = False  # faz a avaliação/contestação como Qualidade (antes: "é Qualidade?")
    chamados: str = UNIDADE  # alcance nos chamados de TI (antes: PERFIS_GLOBAIS de chamados.py)


_PADRAO = Alcance()
_PARTICIPANTE = Alcance(wfm=PROPRIO)

ALCANCES: dict[str, Alcance] = {
    ROLE_ADMIN: Alcance(
        wfm=TODOS, monitoria=TODOS, chamados=TODOS, total=True,
        gerencia=frozenset({ROLE_ADMIN, ROLE_MANAGER, ROLE_SUPERVISOR, ROLE_QUALIDADE, ROLE_CONTROL_DESK, ROLE_OPERATOR}),
    ),
    ROLE_MANAGER: Alcance(wfm=TODOS, monitoria=TODOS, chamados=TODOS, gere_escala=True),
    ROLE_CONTROL_DESK: Alcance(monitoria=TODOS, gere_escala=True),
    ROLE_SUPERVISOR: Alcance(
        wfm=EQUIPE, monitoria=EQUIPE, gere_escala=True, min_unidades=1, max_unidades=3, rotulo="Supervisor",
        gerencia=frozenset({ROLE_QUALIDADE, ROLE_CONTROL_DESK, ROLE_OPERATOR}),
    ),
    ROLE_QUALIDADE: Alcance(avalia_monitoria=True, min_unidades=1, max_unidades=2, rotulo="Qualidade", gerencia=frozenset({ROLE_OPERATOR})),
    ROLE_OPERATOR: Alcance(wfm=PROPRIO, monitoria=PROPRIO, min_unidades=1, max_unidades=1, exige_supervisor=True, rotulo="Operador"),
    ROLE_TEC_JUNIOR: _PARTICIPANTE,
    ROLE_TEC_PLENO: _PARTICIPANTE,
    ROLE_TEC_SENIOR: _PARTICIPANTE,
    ROLE_ANALISTA_TI: Alcance(gere_escala=True, aprova_propria_escala=True),
}


AREAS: tuple[str, ...] = ("wfm", "monitoria", "chamados")
# Função do catálogo (acesso_catalogo) -> área de alcance que a tela Acessos mostra na 1ª linha da tabela.
AREA_DA_FUNCAO: dict[str, str] = {"wfm": "wfm", "monitorias": "monitoria", "suporte": "chamados"}

logger = logging.getLogger(__name__)
_TTL = 30.0
_lock = threading.Lock()
_cache: tuple[float, dict[tuple[str, str], str]] | None = None
_carregador: Callable[[], dict[tuple[str, str], str]] | None = None


def _ler_do_banco() -> dict[tuple[str, str], str]:
    from .config import get_settings
    from .db import get_connection

    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute("IF OBJECT_ID('dbo.perfis_alcance', 'U') IS NOT NULL SELECT id_perfil, area, nivel FROM dbo.perfis_alcance")
        linhas = cursor.fetchall() if cursor.description else []
    finally:
        conn.close()
    return {(str(p), str(a)): str(n) for p, a, n in linhas if str(a) in AREAS and str(n) in NIVEIS}


def gravados() -> dict[tuple[str, str], str]:
    """Alcances gravados pela tela Acessos (V074). Sem banco ou sem tabela = nada gravado (vale o código)."""
    global _cache
    agora = time.monotonic()
    atual = _cache
    if atual is not None and atual[0] > agora:
        return atual[1]
    with _lock:
        try:
            dados = (_carregador or _ler_do_banco)()
        except Exception as exc:  # noqa: BLE001 - sem banco: padrão do código
            logger.info("Alcance gravado indisponível (%s); usando o padrão do código.", exc)
            dados = {}
        _cache = (agora + _TTL, dados)
        return dados


def invalidar() -> None:
    global _cache
    with _lock:
        _cache = None


def definir_carregador(carregador: Callable[[], dict[tuple[str, str], str]] | None) -> None:
    """Só para testes."""
    global _carregador
    _carregador = carregador
    invalidar()


def alcance_padrao(perfil: str | None) -> Alcance:
    return ALCANCES.get(str(perfil or ""), _PADRAO)


def alcance(perfil: str | None) -> Alcance:
    base = alcance_padrao(perfil)
    mudado = {a: n for (p, a), n in gravados().items() if p == str(perfil or "")}
    return replace(base, **mudado) if mudado else base


def perfis_com(**filtro) -> frozenset[str]:
    """Perfis cujo alcance bate com o filtro. Ex.: perfis_com(wfm=TODOS)."""
    return frozenset(p for p, a in ALCANCES.items() if all(getattr(a, k) == v for k, v in filtro.items()))

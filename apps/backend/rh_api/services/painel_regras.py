"""Painel (14/nov/2026): regras PURAS (sem banco) — catálogo de métricas, períodos e quem vê o quê.

Um painel = módulo + unidade. A Tecnologia escolhe as métricas do catálogo abaixo; cada métrica só aparece para quem
tem também a permissão de BASE do módulo de origem (o painel nunca mostra dado que a pessoa não podia ver).
Nenhuma fórmula nova: presença/faltas vêm do motor dos relatórios de Turnos e Plantões; notas e pendências do motor único
da Monitoria (`monitoria_indicadores`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

MODULO_OPERACAO = "operacao"
MODULO_RH = "rh"
MODULOS_DO_PAINEL = (MODULO_OPERACAO, MODULO_RH)
NOME_MODULO = {MODULO_OPERACAO: "Operação", MODULO_RH: "RH"}

INTERVALOS_SEG = (60, 300, 900)
INTERVALO_PADRAO = 60

# Nota da Monitoria é de 0 a 100. "Abaixo da meta" = faixas que pedem plano de ação ou intervenção (Desenvolvimento e
# Crítico das faixas padrão, < 80).
META_NOTA_PADRAO = 80.0

WFM_BASE = ("wfm.relatorios",)


@dataclass(frozen=True)
class Metrica:
    id: str
    nome: str
    descricao: str
    modulo: str
    formas: tuple[str, ...]
    base: tuple[str, ...]  # basta UMA
    largura: str = "meia"  # "cheia" ocupa a linha inteira; "meia" vai em 2 colunas
    funcao: str = ""  # função da unidade (operacoes_modulos) que precisa estar ligada; vazio = não depende


METRICAS: dict[str, Metrica] = {
    m.id: m
    for m in (
        Metrica("presenca", "Presença", "Escalados, presentes, faltas, atestados e sem lançamento", MODULO_OPERACAO, ("numeros",), WFM_BASE, "cheia", "wfm"),
        Metrica("frequencia", "Frequência", "Presença e faltas por equipe", MODULO_OPERACAO, ("barras", "tabela"), WFM_BASE, "meia", "wfm"),
        Metrica("monitorias", "Monitorias", "Feitas, nota média e pendências", MODULO_OPERACAO, ("numeros_lista", "numeros"), ("monitoria.dashboard", "monitoria.relatorios"), "meia", "monitoria"),
        Metrica("diario", "Diário de Bordo", "Turnos e intercorrências", MODULO_OPERACAO, ("numeros_lista", "lista"), ("diario.visualizar", "diario.intercorrencias"), "meia", "diario"),
        Metrica("escalas", "Escalas e trocas", "Aprovações e trocas pendentes", MODULO_OPERACAO, ("lista",), WFM_BASE, "meia", "wfm"),
        Metrica("operadores", "Operadores", "Tabela com a ficha de cada pessoa", MODULO_OPERACAO, ("tabela",), WFM_BASE, "cheia", "wfm"),
        Metrica("rh_entrevistas", "Entrevistas", "Marcadas, compareceram, faltaram e canceladas", MODULO_RH, ("numeros_lista", "numeros"), ("entrevistas.visualizar",), "cheia"),
    )
}
NOME_FORMA = {"numeros": "Números", "numeros_lista": "Números e lista", "lista": "Lista", "barras": "Barras", "tabela": "Tabela"}

PERIODOS = ("hoje", "semana", "mes", "passado")
NOME_PERIODO = {"hoje": "Hoje", "semana": "Esta semana", "mes": "Este mês", "passado": "Mês passado"}


def metricas_do_modulo(modulo: str) -> list[Metrica]:
    return [m for m in METRICAS.values() if m.modulo == modulo]


def intervalo_do_periodo(periodo: str, hoje: date) -> tuple[date, date]:
    """Hoje; semana corrente (segunda até hoje); mês corrente (dia 1 até hoje); mês passado inteiro."""
    if periodo == "hoje":
        return hoje, hoje
    if periodo == "semana":
        return hoje - timedelta(days=hoje.weekday()), hoje
    if periodo == "passado":
        fim = hoje.replace(day=1) - timedelta(days=1)
        return fim.replace(day=1), fim
    return hoje.replace(day=1), hoje


def tem_base(metrica: Metrica, permissoes: set[str] | frozenset[str]) -> bool:
    return any(p in permissoes for p in metrica.base)


def metricas_validas(modulo: str, itens: list[dict]) -> list[dict]:
    """Normaliza a lista de métricas que a Tecnologia mandou: só do catálogo e do módulo, forma conhecida, sem repetir,
    ordem 1..n pela posição. Levanta ValueError com mensagem para a tela."""
    vistos: set[str] = set()
    saida: list[dict] = []
    for item in itens or []:
        mid = str((item or {}).get("metrica") or "").strip()
        m = METRICAS.get(mid)
        if not m or m.modulo != modulo:
            raise ValueError(f"Métrica desconhecida para este módulo: {mid or '(vazia)'}.")
        if mid in vistos:
            raise ValueError(f"A métrica {m.nome} apareceu duas vezes.")
        forma = str(item.get("forma") or m.formas[0]).strip()
        if forma not in m.formas:
            raise ValueError(f"Forma inválida para {m.nome}.")
        vistos.add(mid)
        saida.append({"metrica": mid, "forma": forma, "ordem": len(saida) + 1})
    return saida


def pode_ver_painel(*, perfil: str, perfis_do_painel: set[str], permissoes: set[str] | frozenset[str], ativo: bool, eh_admin: bool) -> bool:
    """Quem vê: precisa de `painel.visualizar` e o perfil estar marcado no painel (o Administrador vê todos para conferir).
    Painel desligado não aparece para ninguém."""
    if not ativo or "painel.visualizar" not in permissoes:
        return False
    return eh_admin or perfil in perfis_do_painel


def pct(parte: float, todo: float) -> float | None:
    return round(100 * parte / todo, 1) if todo else None


def periodo_anterior(ini: date, fim: date) -> tuple[date, date]:
    dias = (fim - ini).days + 1
    return ini - timedelta(days=dias), ini - timedelta(days=1)

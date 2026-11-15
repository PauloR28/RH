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
    area: str = ""  # aba do painel (v6 aprovada em 15/nov/2026: abas por área)


MON_BASE = ("monitoria.dashboard", "monitoria.relatorios")
DIARIO_BASE = ("diario.visualizar", "diario.intercorrencias")
A_WFM, A_MON, A_EQ, A_DIARIO, A_ENTREVISTAS, A_ADMISSAO = "Turnos e Plantões", "Monitoria", "Equipes", "Diário de Bordo", "Entrevistas", "Admissão"
ORDEM_AREAS = (A_WFM, A_MON, A_EQ, A_DIARIO, A_ENTREVISTAS, A_ADMISSAO)
O = MODULO_OPERACAO

METRICAS: dict[str, Metrica] = {
    m.id: m
    for m in (
        # Turnos e Plantões
        Metrica("presenca", "Presença", "Escalados, presentes, faltas, atestados e sem lançamento", O, ("numeros",), WFM_BASE, "cheia", "wfm", A_WFM),
        Metrica("presenca_dia", "Presença dia a dia", "Linha do período, com comparação de períodos", O, ("linha",), WFM_BASE, "meia", "wfm", A_WFM),
        Metrica("faltas_semana", "Faltas por dia da semana", "Domingo a sábado; clique para ver quem faltou", O, ("barras",), WFM_BASE, "meia", "wfm", A_WFM),
        Metrica("atestados", "Atestados", "Quantos, quem e quantos dias", O, ("numeros_lista", "numeros"), WFM_BASE, "meia", "wfm", A_WFM),
        Metrica("escalas", "Escalas e trocas", "Aprovações e trocas pendentes", O, ("lista",), WFM_BASE, "meia", "wfm", A_WFM),
        Metrica("trocas_pessoa", "Trocas por pessoa", "Quem mais pede troca e as recusadas", O, ("barras_lista",), WFM_BASE, "meia", "wfm", A_WFM),
        Metrica("presenca_do_dia", "Presença do dia", "Quem compareceu, faltou, teve atestado e as pausas do dia", O, ("barra_lista",), WFM_BASE, "meia", "wfm", A_WFM),
        Metrica("pausas_mapa", "Mapa de pausas", "Pessoas em pausa prevista a cada 30 minutos; clique para ver quem", O, ("mapa",), WFM_BASE, "cheia", "wfm", A_WFM),
        # Monitoria
        Metrica("monitorias", "Monitorias", "Feitas, nota média e pendências", O, ("numeros_lista", "numeros"), MON_BASE, "meia", "monitoria", A_MON),
        Metrica("nota_semana", "Nota semana a semana", "Linha da nota média com a meta", O, ("linha",), MON_BASE, "meia", "monitoria", A_MON),
        Metrica("itens_erro", "Itens que mais perdem nota", "Onde treinar", O, ("barras",), MON_BASE, "meia", "monitoria", A_MON),
        Metrica("distribuicao_notas", "Distribuição das notas", "Quantas monitorias em cada faixa", O, ("barras",), MON_BASE, "meia", "monitoria", A_MON),
        Metrica("sem_monitoria", "Sem monitoria", "Quem não teve monitoria no período", O, ("numeros_lista",), MON_BASE, "meia", "monitoria", A_MON),
        Metrica("tempo_feedback", "Tempo até o feedback", "Da monitoria ao feedback aplicado", O, ("numeros_lista", "numeros"), MON_BASE, "meia", "monitoria", A_MON),
        # Equipes
        Metrica("frequencia", "Frequência", "Presença e faltas por equipe", O, ("barras", "tabela"), WFM_BASE, "meia", "wfm", A_EQ),
        Metrica("ranking_equipes", "Ranking das equipes", "Presença, nota e faltas juntas", O, ("tabela",), WFM_BASE, "meia", "wfm", A_EQ),
        Metrica("comparar_equipes", "Comparar equipes", "Duas equipes lado a lado com a média da operação", O, ("tabela",), WFM_BASE, "cheia", "wfm", A_EQ),
        Metrica("operadores", "Operadores", "Tabela com a ficha de cada pessoa", O, ("tabela",), WFM_BASE, "cheia", "wfm", A_EQ),
        # Diário de Bordo
        Metrica("diario", "Diário de Bordo", "Turnos e intercorrências", O, ("numeros_lista", "lista"), DIARIO_BASE, "meia", "diario", A_DIARIO),
        Metrica("interc_tipo", "Intercorrências por tipo", "Sistema, telefonia, pessoas…", O, ("barras",), DIARIO_BASE, "meia", "diario", A_DIARIO),
        # RH
        Metrica("rh_entrevistas", "Entrevistas", "Marcadas, compareceram, faltaram e canceladas", MODULO_RH, ("numeros_grafico", "numeros"), ("entrevistas.visualizar",), "cheia", "", A_ENTREVISTAS),
        Metrica("rh_tempo_admissao", "Tempo de admissão", "Do início da admissão até o 1º dia", MODULO_RH, ("numeros_lista",), ("onboarding.visualizar",), "cheia", "", A_ADMISSAO),
    )
}
NOME_FORMA = {"numeros": "Números", "numeros_lista": "Números e lista", "lista": "Lista", "barras": "Barras", "tabela": "Tabela", "linha": "Linha",
              "barras_lista": "Barras e lista", "barra_lista": "Barra e lista", "mapa": "Mapa", "numeros_grafico": "Números e gráfico"}
COMPARACOES = ("anterior", "mes", "ano", "nenhum")

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


def _mesmo_dia_em(ano: int, mes: int, dia: int) -> date:
    ultimo = ((date(ano + 1, 1, 1) if mes == 12 else date(ano, mes + 1, 1)) - timedelta(days=1)).day
    return date(ano, mes, min(dia, ultimo))


def periodo_comparado(ini: date, fim: date, como: str) -> tuple[date, date] | None:
    """Período da linha de comparação em "Presença dia a dia": anterior (mesma duração), mesmo período do mês passado
    ou do ano passado (dia que não existe no mês de destino cai no último dia dele); "nenhum" = sem comparação."""
    if como == "anterior":
        return periodo_anterior(ini, fim)
    if como == "mes":
        def mover(d: date) -> date:
            ano, mes = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
            return _mesmo_dia_em(ano, mes, d.day)
        return mover(ini), mover(fim)
    if como == "ano":
        return _mesmo_dia_em(ini.year - 1, ini.month, ini.day), _mesmo_dia_em(fim.year - 1, fim.month, fim.day)
    return None


def dia_da_semana_domingo(d: date) -> int:
    """0 = domingo ... 6 = sábado (o Paulo pediu o gráfico de domingo a sábado)."""
    return (d.weekday() + 1) % 7


def ranking_por_posicoes(itens: list[dict]) -> list[dict]:
    """Posição = média das posições em presença (maior), nota (maior) e faltas (menor); quem não tem um valor fica de
    fora só daquele critério. Empate: maior presença, depois nome."""

    def posicoes(chave: str, maior_melhor: bool) -> dict[str, int]:
        validos = [i for i in itens if i.get(chave) is not None]
        ordem = sorted(validos, key=lambda i: (-i[chave] if maior_melhor else i[chave], i["equipe"]))
        return {i["equipe"]: n for n, i in enumerate(ordem, start=1)}

    tabelas = (posicoes("presenca_pct", True), posicoes("nota_media", True), posicoes("faltas", False))
    for i in itens:
        partes = [t[i["equipe"]] for t in tabelas if i["equipe"] in t]
        i["media_posicoes"] = round(sum(partes) / len(partes), 2) if partes else None
    ordenado = sorted(itens, key=lambda i: (i["media_posicoes"] is None, i["media_posicoes"] or 0, -(i.get("presenca_pct") or 0), i["equipe"]))
    for n, i in enumerate(ordenado, start=1):
        i["posicao"] = n
    return ordenado


def slots_da_pausa(inicio: str, duracao_min: int) -> list[int]:
    """Faixas de 30 min (0 = 00:00–00:30 ... 47 = 23:30–24:00) que a pausa toca. Pausa que vira a meia-noite é cortada."""
    try:
        h, m = (int(x) for x in str(inicio)[:5].split(":"))
    except ValueError:
        return []
    a = h * 60 + m
    b = min(a + max(int(duracao_min or 0), 1), 24 * 60)
    return list(range(a // 30, (b - 1) // 30 + 1))

"""Regras PURAS do workflow de troca de plantões (sem I/O).

Fluxo (nenhuma troca é automática, mesmo com os dois operadores de acordo):
  AGUARDANDO_B -> (B aceita) -> simulação pelo motor -> AGUARDANDO_APROVACAO -> APROVADA | REPROVADA
Saídas: RECUSADA (B), CANCELADA (solicitante), EXPIRADA (prazo), INVALIDADA (escala editada depois do
pedido), BLOQUEADA (a simulação do motor acusou violação que bloqueia), DESFEITA (Supervisor desfaz).

Modelo da troca: A cede o dia `data_a` e quer assumir o dia `data_b` de B (podem ser o mesmo dia). Em
cada data envolvida, A e B TROCAM ENTRE SI o que têm na escala (células (operador, data)).

SUPOSIÇÕES (pendentes de confirmação do RH; versão mais restritiva):
  * Compatibilidade de skills = conjuntos de skills idênticos entre A e B.
  * "48 horas úteis" = 48h corridas contadas só em dias úteis (segunda a sexta, sem feriados da operação).
  * "Semana corrente" = segunda a domingo da data/hora do pedido.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

AGUARDANDO_B = "AGUARDANDO_B"
AGUARDANDO_APROVACAO = "AGUARDANDO_APROVACAO"
APROVADA = "APROVADA"
REPROVADA = "REPROVADA"
RECUSADA = "RECUSADA"
CANCELADA = "CANCELADA"
EXPIRADA = "EXPIRADA"
INVALIDADA = "INVALIDADA"
BLOQUEADA = "BLOQUEADA"
DESFEITA = "DESFEITA"

ESTADOS_ATIVOS = (AGUARDANDO_B, AGUARDANDO_APROVACAO)
ESTADOS = (AGUARDANDO_B, AGUARDANDO_APROVACAO, APROVADA, REPROVADA, RECUSADA, CANCELADA, EXPIRADA, INVALIDADA, BLOQUEADA, DESFEITA)

# Tipo de contrato que nunca participa de trocas.
TIPO_CONTRATO_APRENDIZ = "APRENDIZ"


@dataclass(frozen=True)
class ParametrosTroca:
    # A troca pode ser pedida em qualquer dia; só exige antecedência mínima antes do turno envolvido
    # (configurável por escala: `troca_antecedencia_dias`, padrão 3 dias).
    antecedencia_horas: int = 72
    prazo_resposta_horas_uteis: int = 48
    prazo_decisao_horas_uteis: int = 48


def semana_de(ref: date) -> tuple[date, date]:
    segunda = ref - timedelta(days=ref.weekday())
    return segunda, segunda + timedelta(days=6)


def somar_horas_uteis(inicio: datetime, horas: int, feriados: frozenset[date] = frozenset()) -> datetime:
    """Soma `horas` contando apenas dias úteis (segunda a sexta, exceto `feriados`)."""
    restante = timedelta(hours=horas)
    cursor = inicio
    while restante > timedelta(0):
        util = cursor.weekday() < 5 and cursor.date() not in feriados
        if not util:
            cursor = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time())
            continue
        fim_do_dia = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time())
        disponivel = fim_do_dia - cursor
        if disponivel >= restante:
            return cursor + restante
        restante -= disponivel
        cursor = fim_do_dia
    return cursor


def datas_envolvidas(data_a: date, data_b: date) -> tuple[date, ...]:
    return (data_a,) if data_a == data_b else tuple(sorted((data_a, data_b)))


def validar_janela(
    agora: datetime,
    data_a: date,
    data_b: date,
    inicios_dos_turnos: list[datetime],
    params: ParametrosTroca = ParametrosTroca(),
) -> list[str]:
    """Erros de elegibilidade de calendário. `inicios_dos_turnos`: início dos turnos de trabalho
    (de A e B) nas datas envolvidas, já resolvidos pelo chamador."""
    erros: list[str] = []
    limite = agora + timedelta(hours=params.antecedencia_horas)
    if any(inicio < limite for inicio in inicios_dos_turnos):
        dias = params.antecedencia_horas // 24
        erros.append(f"A troca exige antecedência mínima de {dias} dia(s) antes do turno envolvido." if params.antecedencia_horas % 24 == 0
                     else f"A troca exige antecedência mínima de {params.antecedencia_horas} horas antes do turno envolvido.")
    return erros


def skills_compativeis(skills_a: frozenset[int], skills_b: frozenset[int]) -> bool:
    return skills_a == skills_b


def aplicar_troca(celulas: dict[tuple[int, date], int | None], id_a: int, id_b: int, datas: tuple[date, ...]) -> dict[tuple[int, date], int | None]:
    """Devolve as células (operador, data) -> id_turno (None = sem escala) depois da troca: em cada data
    envolvida, A e B trocam entre si o que têm."""
    novas = dict(celulas)
    for d in datas:
        novas[(id_a, d)], novas[(id_b, d)] = celulas.get((id_b, d)), celulas.get((id_a, d))
    return novas


def gera_alerta_de_risco(sequencia_maxima: int, limite_dias: int) -> bool:
    return sequencia_maxima > limite_dias

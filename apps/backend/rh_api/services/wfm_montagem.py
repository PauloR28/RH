"""Monta os `DiaEscala` do motor de regras a partir dos dados do WFM. PURO (sem I/O).

Aplica, para um operador:
  * contrato vigente em cada dia (mudança de contrato no meio do período);
  * FERIADO  -> `DiaEscala.feriado=True` (o contrato define a jornada própria);
  * DIA_ESPECIAL     -> o dia inteiro usa o turno indicado no evento (só onde
                        o operador trabalharia; folgas continuam folgas);
  * HORARIO_ESPECIAL -> sobrescreve entrada/saída do turno-modelo indicado
                        (`id_turno`) na data ou período;
  * DATA_ESPECIAL    -> apenas informativa, SEM efeito no motor.

Dia com escala mas sem contrato vigente NÃO é validado silenciosamente: gera
a violação `SEM_CONTRATO` (SUPOSIÇÃO restritiva: sem contrato, não publica).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from .wfm_regras import (
    SEVERIDADE_BLOQUEIO,
    DiaEscala,
    ParametrosContrato,
    Violacao,
    dia_de_turno,
    folga,
)

SEM_CONTRATO = "SEM_CONTRATO"
TIPO_TURNO_TRABALHO = "TRABALHO"
TIPO_TURNO_DSR = "DSR"

EVENTO_FERIADO = "FERIADO"
EVENTO_DATA_ESPECIAL = "DATA_ESPECIAL"
EVENTO_DIA_ESPECIAL = "DIA_ESPECIAL"
EVENTO_HORARIO_ESPECIAL = "HORARIO_ESPECIAL"


@dataclass(frozen=True)
class TurnoModelo:
    id_turno: int
    codigo: str
    tipo: str
    entrada: str | None = None
    saida: str | None = None
    # (minutos após a entrada, duração em minutos, tipo)
    pausas: tuple[tuple[int, int, str], ...] = ()


@dataclass(frozen=True)
class EventoCalendario:
    tipo: str
    data_ini: date
    data_fim: date
    id_turno: int | None = None
    entrada: str | None = None
    saida: str | None = None

    def cobre(self, data: date) -> bool:
        return self.data_ini <= data <= self.data_fim


@dataclass(frozen=True)
class VigenciaContrato:
    contrato: ParametrosContrato
    ini: date
    fim: date | None = None

    def cobre(self, data: date) -> bool:
        return self.ini <= data and (self.fim is None or data <= self.fim)


def contrato_em(data: date, vigencias: list[VigenciaContrato]) -> ParametrosContrato | None:
    """Vigência mais recente que cobre a data (a de início mais tardio vence)."""
    cobrindo = [v for v in vigencias if v.cobre(data)]
    if not cobrindo:
        return None
    return max(cobrindo, key=lambda v: v.ini).contrato


def montar_dias(
    itens: dict[date, int],
    turnos: dict[int, TurnoModelo],
    eventos: list[EventoCalendario],
    vigencias: list[VigenciaContrato],
) -> tuple[list[DiaEscala], list[Violacao]]:
    """`itens`: data -> id_turno do operador. Devolve (dias, violações de montagem)."""
    dias: list[DiaEscala] = []
    violacoes: list[Violacao] = []
    sem_contrato_reportado = False
    for data in sorted(itens):
        turno = turnos.get(itens[data])
        if turno is None:
            continue
        contrato = contrato_em(data, vigencias)
        if contrato is None:
            if not sem_contrato_reportado:
                sem_contrato_reportado = True
                violacoes.append(
                    Violacao(
                        codigo=SEM_CONTRATO,
                        severidade=SEVERIDADE_BLOQUEIO,
                        data=data,
                        mensagem="Operador sem contrato de jornada vigente: não é possível validar a escala.",
                    )
                )
            continue
        if turno.tipo != TIPO_TURNO_TRABALHO:
            dias.append(folga(data, contrato, dsr=turno.tipo == TIPO_TURNO_DSR))
            continue
        ativos = [e for e in eventos if e.cobre(data)]
        feriado = any(e.tipo == EVENTO_FERIADO for e in ativos)
        efetivo = turno
        for evento in ativos:
            if evento.tipo == EVENTO_DIA_ESPECIAL and evento.id_turno in turnos:
                efetivo = turnos[evento.id_turno]
        entrada, saida = efetivo.entrada, efetivo.saida
        for evento in ativos:
            if evento.tipo == EVENTO_HORARIO_ESPECIAL and evento.id_turno == efetivo.id_turno:
                entrada = evento.entrada or entrada
                saida = evento.saida or saida
        if efetivo.tipo != TIPO_TURNO_TRABALHO or not entrada or not saida:
            dias.append(folga(data, contrato, dsr=efetivo.tipo == TIPO_TURNO_DSR))
            continue
        dias.append(
            dia_de_turno(data, contrato, entrada=entrada, saida=saida, pausas=efetivo.pausas, feriado=feriado)
        )
    return dias, violacoes


def dias_do_mes(ano_mes: str) -> list[date]:
    ano, mes = (int(p) for p in ano_mes.split("-"))
    primeiro = date(ano, mes, 1)
    proximo = date(ano + (mes == 12), (mes % 12) + 1, 1)
    return [primeiro + timedelta(days=i) for i in range((proximo - primeiro).days)]

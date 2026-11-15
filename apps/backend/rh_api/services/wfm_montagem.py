"""Monta os `DiaEscala` do motor de regras a partir dos dados do WFM. PURO (sem I/O).

Aplica, para um operador:
  * contrato vigente em cada dia (mudança de contrato no meio do período);
  * FERIADO  -> `DiaEscala.feriado=True` (o contrato define a jornada própria);
  * DIA_ESPECIAL     -> o dia inteiro usa o turno indicado no evento (só onde
                        o operador trabalharia; folgas continuam folgas);
  * HORARIO_ESPECIAL -> sobrescreve entrada/saída do turno-modelo indicado
                        (`id_turno`) na data ou período;
  * DATA_ESPECIAL    -> apenas informativa, SEM efeito no motor.

Jornada de cada dia (decisão do Paulo, 09/11/2026: a jornada é escolhida na criação do TURNO, não no usuário):
a jornada do turno do dia; se o turno não tiver, a vigência do operador ou a padrão da escala (dados antigos,
mantidos). Sem nenhuma, o dia entra sem limites de jornada e NÃO gera aviso (`SEM_CONTRATO` não é mais emitido).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from .wfm_regras import (
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
    # Jornada escolhida na criação do turno (wfm_turnos.id_contrato); None = turno sem jornada.
    contrato: ParametrosContrato | None = None


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


def _aplicar_eventos(
    data: date,
    turno: TurnoModelo,
    turnos: dict[int, TurnoModelo],
    eventos: list[EventoCalendario],
    ajuste: tuple[str, str] | None = None,
) -> tuple[bool, TurnoModelo, str | None, str | None]:
    """Aplica o calendário especial ao turno do dia: (feriado, turno efetivo, entrada, saída).
    `ajuste` = (entrada, saída) combinada para o operador naquele dia (ex.: sábado flexível); vence o calendário."""
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
    if ajuste and efetivo.tipo == TIPO_TURNO_TRABALHO:
        entrada, saida = ajuste
    return feriado, efetivo, entrada, saida


def horario_efetivo(
    data: date,
    turno: TurnoModelo,
    turnos: dict[int, TurnoModelo],
    eventos: list[EventoCalendario],
    ajuste: tuple[str, str] | None = None,
) -> dict:
    """Horário que o operador realmente cumpre no dia (para exibição): entrada, saída e minutos líquidos."""
    feriado, efetivo, entrada, saida = _aplicar_eventos(data, turno, turnos, eventos, ajuste)
    if efetivo.tipo != TIPO_TURNO_TRABALHO or not entrada or not saida:
        return {"trabalha": False, "codigo": efetivo.codigo, "tipo": efetivo.tipo, "entrada": None, "saida": None, "minutos": 0, "feriado": feriado}
    dia = dia_de_turno(data, _CONTRATO_EXIBICAO, entrada=entrada, saida=saida, pausas=efetivo.pausas)
    return {"trabalha": True, "codigo": efetivo.codigo, "tipo": efetivo.tipo, "entrada": entrada, "saida": saida, "minutos": dia.jornada_liquida_min(), "feriado": feriado}


# Contrato fictício só para reaproveitar o cálculo de jornada líquida na exibição (não valida nada).
_CONTRATO_EXIBICAO = ParametrosContrato("EXIBICAO", 1440, 0, 31)
# Dia sem jornada (nem no turno, nem no operador, nem padrão da escala): entra no motor sem limites, sem aviso.
_SEM_JORNADA = ParametrosContrato("SEM_JORNADA", 1440, 0, 366)


def montar_dias(
    itens: dict[date, int],
    turnos: dict[int, TurnoModelo],
    eventos: list[EventoCalendario],
    vigencias: list[VigenciaContrato],
    ajustes: dict[date, tuple[str, str]] | None = None,
) -> tuple[list[DiaEscala], list[Violacao]]:
    """`itens`: data -> id_turno do operador; `ajustes`: data -> (entrada, saída) combinada.
    Devolve (dias, violações de montagem)."""
    dias: list[DiaEscala] = []
    violacoes: list[Violacao] = []
    for data in sorted(itens):
        turno = turnos.get(itens[data])
        if turno is None:
            continue
        contrato = turno.contrato or contrato_em(data, vigencias) or _SEM_JORNADA
        if turno.tipo != TIPO_TURNO_TRABALHO:
            dias.append(folga(data, contrato, dsr=turno.tipo == TIPO_TURNO_DSR))
            continue
        feriado, efetivo, entrada, saida = _aplicar_eventos(data, turno, turnos, eventos, (ajustes or {}).get(data))
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

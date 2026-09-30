"""Motor de regras trabalhistas do WFM (Turnos e Plantões) — módulo PURO.

Sem I/O: nenhuma dependência de banco, HTTP ou relógio. Recebe a escala já
resolvida (turnos, feriados e horários especiais aplicados pelo chamador) e os
parâmetros do contrato de cada dia, e devolve a lista de violações. Todo limite
vem de `ParametrosContrato` (editável por contrato) — nenhuma constante de lei
mora neste arquivo.

Convenções:
  * Um turno que atravessa a meia-noite PERTENCE ao dia em que começou
    (`DiaEscala.data` é sempre o dia de início; `fim` cai no dia seguinte).
  * `validar_escala` recebe também dias de CONTEXTO fora do `periodo` (fim do
    mês anterior / início do seguinte) para calcular interjornada e sequência
    de dias corretamente na virada de mês; só violações cujo dia está dentro
    de `periodo` são devolvidas.
  * Dias sem `inicio`/`fim` são folgas. `folga_dsr=True` marca a folga como
    descanso semanal remunerado.

BLOQUEIO JURÍDICO (WFM Fase 1): a regra de "domingos alternados por gênero"
NÃO faz parte do motor. Ela só pode ser implementada depois que o jurídico
confirmar se há base em convenção coletiva ou se é prática interna sem
previsão formal. Não a reintroduza aqui sem essa validação.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

CONTEXTO_PUBLICACAO = "publicacao"
CONTEXTO_TROCA = "troca"

SEVERIDADE_BLOQUEIO = "bloqueio"
SEVERIDADE_ALERTA = "alerta"

# Códigos estáveis de violação (usados por API, auditoria e front).
JORNADA_DIARIA = "JORNADA_DIARIA"
JORNADA_LEI = "JORNADA_LEI"
INTERJORNADA = "INTERJORNADA"
PAUSA_OBRIGATORIA = "PAUSA_OBRIGATORIA"
DIAS_SEM_DSR = "DIAS_SEM_DSR"

TIPO_PAUSA_REFEICAO = "REFEICAO"  # pausa de 20 min (NR-17): CONTA como jornada
TIPO_PAUSA_INTERVALO = "INTERVALO"  # intervalo não remunerado (ex.: 1h de almoço CLT 8h): é DESCONTADO da jornada


@dataclass(frozen=True)
class ExigenciaPausa:
    """Pausa obrigatória (ex.: NR-17): a partir de `a_partir_de_min` de jornada
    líquida, exige `quantidade` pausas do `tipo` com pelo menos `duracao_min`."""

    a_partir_de_min: int
    tipo: str
    quantidade: int
    duracao_min: int


@dataclass(frozen=True)
class ParametrosContrato:
    """Limites de um contrato de jornada. Todos editáveis; nada é lei fixa."""

    codigo: str
    jornada_diaria_max_min: int
    interjornada_min_min: int
    max_dias_consecutivos: int
    exigencias_pausa: tuple[ExigenciaPausa, ...] = ()
    # Jornada máxima própria em feriado trabalhado (None = usa a diária normal).
    jornada_feriado_max_min: int | None = None
    # Bloqueio duro por lei (ex.: estagiário): nem o Gestor publica com override.
    jornada_bloqueio_duro: bool = False


@dataclass(frozen=True)
class Pausa:
    inicio: datetime
    duracao_min: int
    tipo: str

    @property
    def desconta_da_jornada(self) -> bool:
        # Pausas NR-17 (descanso e refeição de 20 min) fazem parte da jornada; só o INTERVALO é descontado.
        return self.tipo == TIPO_PAUSA_INTERVALO


@dataclass(frozen=True)
class DiaEscala:
    data: date
    contrato: ParametrosContrato
    inicio: datetime | None = None
    fim: datetime | None = None
    pausas: tuple[Pausa, ...] = ()
    feriado: bool = False
    folga_dsr: bool = False

    @property
    def trabalha(self) -> bool:
        return self.inicio is not None and self.fim is not None

    def jornada_liquida_min(self) -> int:
        if not self.trabalha:
            return 0
        bruto = int((self.fim - self.inicio).total_seconds() // 60)
        descontos = sum(p.duracao_min for p in self.pausas if p.desconta_da_jornada)
        return max(bruto - descontos, 0)


@dataclass(frozen=True)
class Violacao:
    codigo: str
    severidade: str
    data: date
    mensagem: str
    # `False` = nem o Gestor/RH pode publicar com override (bloqueio duro por lei).
    permite_override: bool = True
    detalhe: dict = field(default_factory=dict)


def _hhmm(minutos: int) -> str:
    return f"{minutos // 60}h{minutos % 60:02d}"


def dia_de_turno(
    data: date,
    contrato: ParametrosContrato,
    *,
    entrada: str,
    saida: str,
    pausas: tuple[tuple[int, int, str], ...] = (),
    feriado: bool = False,
) -> DiaEscala:
    """Monta um `DiaEscala` a partir de horários "HH:MM". `pausas` é uma tupla de
    (minutos após a entrada, duração em minutos, tipo). Saída <= entrada = o
    turno atravessa a meia-noite e termina no dia seguinte."""
    h_ent = time.fromisoformat(entrada)
    h_sai = time.fromisoformat(saida)
    inicio = datetime.combine(data, h_ent)
    fim = datetime.combine(data, h_sai)
    if fim <= inicio:
        fim += timedelta(days=1)
    return DiaEscala(
        data=data,
        contrato=contrato,
        inicio=inicio,
        fim=fim,
        pausas=tuple(Pausa(inicio + timedelta(minutes=off), dur, tipo) for off, dur, tipo in pausas),
        feriado=feriado,
    )


def folga(data: date, contrato: ParametrosContrato, *, dsr: bool = False) -> DiaEscala:
    return DiaEscala(data=data, contrato=contrato, folga_dsr=dsr)


# ---------------------------------------------------------------------------
# Regras individuais
# ---------------------------------------------------------------------------
def _limite_jornada(dia: DiaEscala) -> int:
    c = dia.contrato
    if dia.feriado and c.jornada_feriado_max_min is not None:
        return c.jornada_feriado_max_min
    return c.jornada_diaria_max_min


def validar_jornada_diaria(dias: list[DiaEscala]) -> list[Violacao]:
    out: list[Violacao] = []
    for dia in dias:
        if not dia.trabalha:
            continue
        liquida = dia.jornada_liquida_min()
        limite = _limite_jornada(dia)
        if liquida > limite:
            duro = dia.contrato.jornada_bloqueio_duro
            out.append(
                Violacao(
                    codigo=JORNADA_LEI if duro else JORNADA_DIARIA,
                    severidade=SEVERIDADE_BLOQUEIO,
                    data=dia.data,
                    mensagem=f"Jornada de {_hhmm(liquida)} excede o limite de {_hhmm(limite)} do contrato {dia.contrato.codigo}.",
                    permite_override=not duro,
                    detalhe={"jornada_min": liquida, "limite_min": limite, "contrato": dia.contrato.codigo},
                )
            )
    return out


def validar_interjornada(dias: list[DiaEscala]) -> list[Violacao]:
    """Intervalo entre o fim de um turno e o início do próximo trabalhado. A
    violação pertence ao dia do turno seguinte, que usa o seu contrato."""
    out: list[Violacao] = []
    trabalhados = sorted((d for d in dias if d.trabalha), key=lambda d: d.inicio)
    for anterior, atual in zip(trabalhados, trabalhados[1:]):
        intervalo = int((atual.inicio - anterior.fim).total_seconds() // 60)
        minimo = atual.contrato.interjornada_min_min
        if intervalo < minimo:
            out.append(
                Violacao(
                    codigo=INTERJORNADA,
                    severidade=SEVERIDADE_BLOQUEIO,
                    data=atual.data,
                    mensagem=f"Interjornada de {_hhmm(max(intervalo, 0))} é menor que o mínimo de {_hhmm(minimo)}.",
                    detalhe={"intervalo_min": intervalo, "minimo_min": minimo, "dia_anterior": anterior.data.isoformat()},
                )
            )
    return out


def validar_pausas(dias: list[DiaEscala]) -> list[Violacao]:
    out: list[Violacao] = []
    for dia in dias:
        if not dia.trabalha:
            continue
        liquida = dia.jornada_liquida_min()
        for exigencia in dia.contrato.exigencias_pausa:
            if liquida < exigencia.a_partir_de_min:
                continue
            programadas = sum(
                1 for p in dia.pausas if p.tipo == exigencia.tipo and p.duracao_min >= exigencia.duracao_min
            )
            if programadas < exigencia.quantidade:
                out.append(
                    Violacao(
                        codigo=PAUSA_OBRIGATORIA,
                        severidade=SEVERIDADE_BLOQUEIO,
                        data=dia.data,
                        mensagem=(
                            f"Faltam pausas obrigatórias ({exigencia.tipo}): exigido {exigencia.quantidade} de "
                            f"{exigencia.duracao_min} min, programado {programadas}."
                        ),
                        detalhe={
                            "tipo": exigencia.tipo,
                            "exigido": exigencia.quantidade,
                            "programado": programadas,
                            "duracao_min": exigencia.duracao_min,
                        },
                    )
                )
    return out


def maior_sequencia_sem_dsr(dias: list[DiaEscala]) -> list[tuple[date, int]]:
    """Para cada dia trabalhado, o tamanho da sequência de dias trabalhados
    consecutivos (sem folga entre eles) terminando nele. Dia ausente na lista
    ou folga zera a sequência — dia sem escala não é assumido como trabalho."""
    por_data = {d.data: d for d in dias}
    resultado: list[tuple[date, int]] = []
    corrente = 0
    for data in sorted(por_data):
        dia = por_data[data]
        anterior = por_data.get(data - timedelta(days=1))
        if not dia.trabalha:
            corrente = 0
            continue
        corrente = corrente + 1 if (anterior is not None and anterior.trabalha) else 1
        resultado.append((data, corrente))
    return resultado


def validar_dias_consecutivos(dias: list[DiaEscala], contexto: str = CONTEXTO_PUBLICACAO) -> list[Violacao]:
    """Sequência de dias trabalhados sem DSR. Na publicação bloqueia; na troca
    (Fase 2) vira alerta de risco trabalhista, nunca bloqueio."""
    severidade = SEVERIDADE_ALERTA if contexto == CONTEXTO_TROCA else SEVERIDADE_BLOQUEIO
    por_data = {d.data: d for d in dias}
    out: list[Violacao] = []
    sequencias_reportadas: set[date] = set()
    for data, sequencia in maior_sequencia_sem_dsr(dias):
        limite = por_data[data].contrato.max_dias_consecutivos
        inicio_sequencia = data - timedelta(days=sequencia - 1)
        # Uma violação por sequência: o 1º dia em que ela passa do limite vigente naquele dia.
        if sequencia > limite and inicio_sequencia not in sequencias_reportadas:
            sequencias_reportadas.add(inicio_sequencia)
            out.append(
                Violacao(
                    codigo=DIAS_SEM_DSR,
                    severidade=severidade,
                    data=data,
                    mensagem=f"{sequencia} dias consecutivos de trabalho sem DSR (limite {limite}).",
                    detalhe={"sequencia": sequencia, "limite": limite},
                )
            )
    return out


def validar_escala(
    dias: list[DiaEscala],
    *,
    periodo: tuple[date, date],
    contexto: str = CONTEXTO_PUBLICACAO,
) -> list[Violacao]:
    """Roda todas as regras sobre `dias` (incluindo contexto fora do período) e
    devolve só as violações cujo dia cai em `periodo` (inclusive)."""
    inicio, fim = periodo
    violacoes = (
        validar_jornada_diaria(dias)
        + validar_interjornada(dias)
        + validar_pausas(dias)
        + validar_dias_consecutivos(dias, contexto)
    )
    return sorted(
        (v for v in violacoes if inicio <= v.data <= fim),
        key=lambda v: (v.data, v.codigo),
    )


def tem_bloqueio(violacoes: list[Violacao]) -> bool:
    return any(v.severidade == SEVERIDADE_BLOQUEIO for v in violacoes)


def tem_bloqueio_duro(violacoes: list[Violacao]) -> bool:
    """Bloqueio que nem o Gestor/RH pode publicar com justificativa (lei)."""
    return any(v.severidade == SEVERIDADE_BLOQUEIO and not v.permite_override for v in violacoes)

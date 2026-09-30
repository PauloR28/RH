"""Testes do motor de regras do WFM (função pura, sem banco)."""

from __future__ import annotations

import inspect
from datetime import date, timedelta

import pytest

from rh_api.services import wfm_regras as r
from rh_api.services.wfm_regras import (
    ExigenciaPausa,
    ParametrosContrato,
    dia_de_turno,
    folga,
    validar_escala,
)

NR17 = (
    ExigenciaPausa(a_partir_de_min=300, tipo="DESCANSO", quantidade=2, duracao_min=10),
    ExigenciaPausa(a_partir_de_min=300, tipo="REFEICAO", quantidade=1, duracao_min=20),
)
CLT = ParametrosContrato("CLT8", 480, 660, 6, exigencias_pausa=(), jornada_feriado_max_min=None)
CLT_NR17 = ParametrosContrato("CLT6", 360, 660, 6, exigencias_pausa=NR17)
ESTAGIO = ParametrosContrato("EST6", 360, 660, 6, jornada_bloqueio_duro=True)
PAUSAS_OK = ((90, 10, "DESCANSO"), (150, 20, "REFEICAO"), (240, 10, "DESCANSO"))


def _mes(ano, mes):
    d = date(ano, mes, 1)
    while d.month == mes:
        yield d
        d += timedelta(days=1)


def _cods(v):
    return [x.codigo for x in v]


def test_jornada_dentro_do_limite_nao_gera_violacao():
    dias = [dia_de_turno(date(2026, 9, 1), CLT, entrada="08:00", saida="16:00")]
    assert validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30))) == []


def test_jornada_acima_do_limite_bloqueia_mas_permite_override():
    dias = [dia_de_turno(date(2026, 9, 1), CLT, entrada="08:00", saida="18:00")]
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.JORNADA_DIARIA]
    assert r.tem_bloqueio(v) and not r.tem_bloqueio_duro(v)


def test_estagiario_jornada_e_bloqueio_duro_sem_override():
    dias = [dia_de_turno(date(2026, 9, 1), ESTAGIO, entrada="08:00", saida="15:00")]
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.JORNADA_LEI]
    assert r.tem_bloqueio_duro(v)


def test_refeicao_e_descontada_da_jornada_liquida():
    dia = dia_de_turno(date(2026, 9, 1), CLT, entrada="08:00", saida="17:00", pausas=((240, 60, "REFEICAO"),))
    assert dia.jornada_liquida_min() == 480
    assert validar_escala([dia], periodo=(date(2026, 9, 1), date(2026, 9, 1))) == []


def test_interjornada_menor_que_11h_bloqueia_no_dia_seguinte():
    dias = [
        dia_de_turno(date(2026, 9, 1), CLT, entrada="14:00", saida="22:00"),
        dia_de_turno(date(2026, 9, 2), CLT, entrada="06:00", saida="14:00"),
    ]
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.INTERJORNADA]
    assert v[0].data == date(2026, 9, 2)
    assert v[0].detalhe["intervalo_min"] == 480


def test_interjornada_exatamente_11h_e_valida():
    dias = [
        dia_de_turno(date(2026, 9, 1), CLT, entrada="14:00", saida="22:00"),
        dia_de_turno(date(2026, 9, 2), CLT, entrada="09:00", saida="17:00"),
    ]
    assert validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30))) == []


def test_turno_noturno_pertence_ao_dia_de_inicio_e_atravessa_meia_noite():
    noite = dia_de_turno(date(2026, 9, 1), CLT, entrada="22:00", saida="06:00")
    assert noite.data == date(2026, 9, 1)
    assert noite.fim.date() == date(2026, 9, 2)
    assert noite.jornada_liquida_min() == 480
    # próximo turno às 15:00 do dia 2 => intervalo 9h => bloqueia, atribuído ao dia 2
    prox = dia_de_turno(date(2026, 9, 2), CLT, entrada="15:00", saida="23:00")
    v = validar_escala([noite, prox], periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.INTERJORNADA] and v[0].data == date(2026, 9, 2)


def test_noturno_no_fim_do_periodo_nao_vaza_violacao_do_dia_seguinte():
    noite = dia_de_turno(date(2026, 9, 30), CLT, entrada="22:00", saida="06:00")
    prox = dia_de_turno(date(2026, 10, 1), CLT, entrada="10:00", saida="18:00")  # contexto
    v = validar_escala([noite, prox], periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert v == []  # a violação (4h) é do dia 1/out, fora do período


def test_virada_de_mes_interjornada_usa_contexto_do_mes_anterior():
    ctx = dia_de_turno(date(2026, 8, 31), CLT, entrada="14:00", saida="22:00")
    primeiro = dia_de_turno(date(2026, 9, 1), CLT, entrada="06:00", saida="14:00")
    v = validar_escala([ctx, primeiro], periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.INTERJORNADA] and v[0].data == date(2026, 9, 1)


def test_virada_de_mes_sequencia_sem_dsr_conta_dias_do_mes_anterior():
    dias = [dia_de_turno(date(2026, 8, 28) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(8)]
    # 28/ago..4/set: 8 dias seguidos; o 7º (3/set) estoura o limite de 6
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.DIAS_SEM_DSR] and v[0].data == date(2026, 9, 3)


def test_dsr_folga_zera_sequencia_e_seis_dias_seguidos_sao_validos():
    dias = [dia_de_turno(date(2026, 9, 1) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(6)]
    dias.append(folga(date(2026, 9, 7), CLT, dsr=True))
    dias += [dia_de_turno(date(2026, 9, 8) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(6)]
    assert validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30))) == []


def test_semana_com_dsr_ja_usado_setimo_dia_apos_a_folga_reinicia_contagem():
    # trabalha seg-sex, folga sáb (DSR), trabalha dom..sáb (7 dias) => estoura no 7º
    dias = [dia_de_turno(date(2026, 9, 7) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(5)]
    dias.append(folga(date(2026, 9, 12), CLT, dsr=True))
    dias += [dia_de_turno(date(2026, 9, 13) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(7)]
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.DIAS_SEM_DSR] and v[0].data == date(2026, 9, 19)


def test_dias_consecutivos_na_troca_vira_alerta_nao_bloqueio():
    dias = [dia_de_turno(date(2026, 9, 1) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(7)]
    pub = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    troca = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)), contexto=r.CONTEXTO_TROCA)
    assert pub[0].severidade == r.SEVERIDADE_BLOQUEIO
    assert troca[0].severidade == r.SEVERIDADE_ALERTA and not r.tem_bloqueio(troca)


def test_pausas_nr17_faltando_bloqueia_e_completas_passam():
    sem = [dia_de_turno(date(2026, 9, 1), CLT_NR17, entrada="08:00", saida="14:00", pausas=((90, 10, "DESCANSO"),))]
    v = validar_escala(sem, periodo=(date(2026, 9, 1), date(2026, 9, 1)))
    assert set(_cods(v)) == {r.PAUSA_OBRIGATORIA} and len(v) == 2  # falta 1 descanso e a refeição
    com = [dia_de_turno(date(2026, 9, 1), CLT_NR17, entrada="08:00", saida="14:00", pausas=PAUSAS_OK)]
    assert validar_escala(com, periodo=(date(2026, 9, 1), date(2026, 9, 1))) == []


def test_pausa_curta_demais_nao_conta():
    dia = dia_de_turno(
        date(2026, 9, 1), CLT_NR17, entrada="08:00", saida="14:00",
        pausas=((90, 5, "DESCANSO"), (150, 20, "REFEICAO"), (240, 10, "DESCANSO")),
    )
    v = validar_escala([dia], periodo=(date(2026, 9, 1), date(2026, 9, 1)))
    assert len(v) == 1 and v[0].detalhe["tipo"] == "DESCANSO"


def test_feriado_usa_jornada_propria_do_contrato():
    contrato = ParametrosContrato("CLT8F", 480, 660, 6, jornada_feriado_max_min=360)
    normal = dia_de_turno(date(2026, 9, 6), contrato, entrada="08:00", saida="16:00")
    feriado = dia_de_turno(date(2026, 9, 7), contrato, entrada="08:00", saida="16:00", feriado=True)
    v = validar_escala([normal, feriado], periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.JORNADA_DIARIA] and v[0].data == date(2026, 9, 7)


def test_mudanca_de_contrato_no_meio_do_periodo_usa_o_limite_de_cada_dia():
    dias = [
        dia_de_turno(date(2026, 9, 14), CLT, entrada="08:00", saida="16:00"),
        dia_de_turno(date(2026, 9, 15), ESTAGIO, entrada="08:00", saida="16:00"),  # 8h > 6h do estágio
    ]
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert _cods(v) == [r.JORNADA_LEI] and v[0].data == date(2026, 9, 15)


def test_mudanca_de_contrato_altera_limite_de_dias_consecutivos():
    curto = ParametrosContrato("CLT5", 480, 660, 4)
    dias = [dia_de_turno(date(2026, 9, 1) + timedelta(days=i), CLT, entrada="08:00", saida="16:00") for i in range(5)]
    dias += [dia_de_turno(date(2026, 9, 6) + timedelta(days=i), curto, entrada="08:00", saida="16:00") for i in range(2)]
    v = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    # 5 dias com limite 6 (ok); no 6º dia (6/set) passa a valer o contrato de limite 4 => 1 violação por sequência
    assert _cods(v) == [r.DIAS_SEM_DSR] and v[0].data == date(2026, 9, 6)
    assert v[0].detalhe["limite"] == 4


def test_periodo_filtra_violacoes_fora_do_intervalo():
    dias = [dia_de_turno(date(2026, 8, 31), CLT, entrada="08:00", saida="20:00")]
    assert validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30))) == []


def test_motor_e_puro_sem_io():
    """O módulo não pode importar banco/HTTP/relógio (deve ser testável sozinho)."""
    fonte = inspect.getsource(r)
    for proibido in ("pyodbc", "fastapi", "requests", "datetime.now", "date.today", "open("):
        assert proibido not in fonte, proibido


def test_regra_de_domingos_por_genero_nao_existe_no_motor():
    fonte = inspect.getsource(r).lower()
    assert "def " in fonte
    assert not any(n for n in dir(r) if "genero" in n.lower() or "domingo" in n.lower())

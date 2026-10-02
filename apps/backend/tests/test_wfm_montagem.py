from __future__ import annotations

from datetime import date

from rh_api.services import wfm_montagem as m
from rh_api.services.wfm_regras import ParametrosContrato, validar_escala

CLT8 = ParametrosContrato("CLT8", 480, 660, 6, jornada_feriado_max_min=360)
EST6 = ParametrosContrato("EST6", 360, 660, 6, jornada_bloqueio_duro=True)

MANHA = m.TurnoModelo(1, "M", "TRABALHO", "08:00", "16:00")
NOITE = m.TurnoModelo(2, "N", "TRABALHO", "22:00", "06:00")
FOLGA = m.TurnoModelo(3, "F", "FOLGA")
DSR = m.TurnoModelo(4, "D", "DSR")
TURNOS = {t.id_turno: t for t in (MANHA, NOITE, FOLGA, DSR)}
VIG = [m.VigenciaContrato(CLT8, date(2026, 1, 1))]


def test_dias_do_mes_virada_de_ano():
    assert len(m.dias_do_mes("2026-12")) == 31 and m.dias_do_mes("2026-12")[-1] == date(2026, 12, 31)
    assert len(m.dias_do_mes("2026-02")) == 28


def test_contrato_vigente_troca_no_meio_do_periodo():
    vig = [m.VigenciaContrato(CLT8, date(2026, 1, 1), date(2026, 9, 14)), m.VigenciaContrato(EST6, date(2026, 9, 15))]
    assert m.contrato_em(date(2026, 9, 14), vig) is CLT8
    assert m.contrato_em(date(2026, 9, 15), vig) is EST6
    assert m.contrato_em(date(2025, 12, 31), vig) is None


def test_montagem_com_troca_de_contrato_valida_limite_de_cada_dia():
    vig = [m.VigenciaContrato(CLT8, date(2026, 1, 1), date(2026, 9, 14)), m.VigenciaContrato(EST6, date(2026, 9, 15))]
    dias, viol = m.montar_dias({date(2026, 9, 14): 1, date(2026, 9, 15): 1}, TURNOS, [], vig)
    assert viol == []
    res = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert [v.codigo for v in res] == ["JORNADA_LEI"] and res[0].data == date(2026, 9, 15)


def test_sem_contrato_bloqueia_com_violacao_de_montagem():
    dias, viol = m.montar_dias({date(2026, 9, 1): 1, date(2026, 9, 2): 1}, TURNOS, [], [])
    assert dias == [] and len(viol) == 1 and viol[0].codigo == m.SEM_CONTRATO


def test_feriado_aplica_jornada_propria_do_contrato():
    ev = [m.EventoCalendario(m.EVENTO_FERIADO, date(2026, 9, 7), date(2026, 9, 7))]
    dias, _ = m.montar_dias({date(2026, 9, 7): 1}, TURNOS, ev, VIG)
    assert dias[0].feriado
    res = validar_escala(dias, periodo=(date(2026, 9, 1), date(2026, 9, 30)))
    assert [v.codigo for v in res] == ["JORNADA_DIARIA"]


def test_horario_especial_sobrescreve_entrada_e_saida_do_turno_modelo():
    ev = [m.EventoCalendario(m.EVENTO_HORARIO_ESPECIAL, date(2026, 9, 10), date(2026, 9, 11), id_turno=1, entrada="09:00", saida="13:00")]
    dias, _ = m.montar_dias({date(2026, 9, 10): 1, date(2026, 9, 12): 1}, TURNOS, ev, VIG)
    assert dias[0].jornada_liquida_min() == 240 and dias[1].jornada_liquida_min() == 480


def test_dia_especial_substitui_o_turno_so_onde_ha_trabalho():
    ev = [m.EventoCalendario(m.EVENTO_DIA_ESPECIAL, date(2026, 9, 10), date(2026, 9, 10), id_turno=2)]
    dias, _ = m.montar_dias({date(2026, 9, 10): 1, date(2026, 9, 11): 3}, TURNOS, ev, VIG)
    assert dias[0].inicio.hour == 22 and dias[0].fim.date() == date(2026, 9, 11)
    assert not dias[1].trabalha


def test_data_especial_nao_tem_efeito_no_motor():
    ev = [m.EventoCalendario(m.EVENTO_DATA_ESPECIAL, date(2026, 9, 10), date(2026, 9, 10), id_turno=2, entrada="01:00", saida="02:00")]
    dias, _ = m.montar_dias({date(2026, 9, 10): 1}, TURNOS, ev, VIG)
    assert dias[0].inicio.hour == 8 and dias[0].jornada_liquida_min() == 480 and not dias[0].feriado


def test_folga_e_dsr_sao_marcadas():
    dias, _ = m.montar_dias({date(2026, 9, 1): 3, date(2026, 9, 2): 4}, TURNOS, [], VIG)
    assert not dias[0].trabalha and not dias[0].folga_dsr and dias[1].folga_dsr


def test_horario_ajustado_do_dia_vence_o_turno_e_o_calendario():
    sab = date(2026, 10, 3)
    h = m.horario_efetivo(sab, MANHA, TURNOS, [], ("08:00", "12:00"))
    assert (h["entrada"], h["saida"], h["minutos"]) == ("08:00", "12:00", 240)
    evento = m.EventoCalendario("HORARIO_ESPECIAL", sab, sab, 1, "09:00", "13:00")
    assert m.horario_efetivo(sab, MANHA, TURNOS, [evento], ("10:00", "14:00"))["entrada"] == "10:00"
    # folga ignora o ajuste
    assert m.horario_efetivo(sab, FOLGA, TURNOS, [], ("08:00", "12:00"))["trabalha"] is False


def test_montagem_usa_o_horario_ajustado_na_validacao():
    sab = date(2026, 10, 3)
    dias, viol = m.montar_dias({sab: 1}, TURNOS, [], VIG, {sab: ("08:00", "20:00")})
    assert viol == [] and dias[0].jornada_liquida_min() == 720
    res = validar_escala(dias, periodo=(date(2026, 10, 1), date(2026, 10, 31)))
    assert any(v.codigo == "JORNADA_LEI" or "JORNADA" in v.codigo for v in res)

from __future__ import annotations

import inspect
from datetime import date, datetime

from rh_api.services import wfm_trocas as t

# 2026-09-28 é segunda-feira
SEG = datetime(2026, 9, 28, 9, 0)
QUI = datetime(2026, 10, 1, 9, 0)
SEX = datetime(2026, 10, 2, 9, 0)


def test_troca_pode_ser_pedida_em_qualquer_dia_da_semana():
    d = date(2026, 10, 10)
    for agora in (SEG, QUI, SEX, datetime(2026, 10, 3, 9), datetime(2026, 10, 4, 9)):  # inclusive sábado e domingo
        assert t.validar_janela(agora, d, d, [datetime(2026, 10, 10, 8)]) == []


def test_antecedencia_padrao_de_3_dias_e_configuravel():
    d = date(2026, 10, 1)
    assert any("3 dia(s)" in e for e in t.validar_janela(SEG, d, d, [datetime(2026, 10, 1, 8, 59)]))
    assert t.validar_janela(SEG, d, d, [datetime(2026, 10, 1, 9, 0)]) == []  # exatamente 3 dias
    um_dia = t.ParametrosTroca(antecedencia_horas=24)
    assert t.validar_janela(SEG, d, d, [datetime(2026, 9, 29, 9, 0)], um_dia) == []
    assert any("1 dia(s)" in e for e in t.validar_janela(SEG, d, d, [datetime(2026, 9, 29, 8, 0)], um_dia))


def test_horas_uteis_pulam_fim_de_semana_e_feriado():
    assert t.somar_horas_uteis(datetime(2026, 9, 28, 10), 48) == datetime(2026, 9, 30, 10)
    assert t.somar_horas_uteis(datetime(2026, 10, 1, 10), 48) == datetime(2026, 10, 5, 10)  # qui 10h -> seg 10h
    assert t.somar_horas_uteis(datetime(2026, 10, 2, 18), 48, frozenset({date(2026, 10, 5)})) == datetime(2026, 10, 7, 18)
    assert t.somar_horas_uteis(datetime(2026, 10, 3, 10), 24) == datetime(2026, 10, 6, 0)  # sábado -> seg 0h + 24h


def test_aplicar_troca_no_mesmo_dia_e_em_dias_diferentes():
    d1, d2 = date(2026, 9, 29), date(2026, 9, 30)
    cel = {(1, d1): 10, (2, d1): None, (1, d2): None, (2, d2): 20}
    novo = t.aplicar_troca(cel, 1, 2, t.datas_envolvidas(d1, d2))
    assert novo == {(1, d1): None, (2, d1): 10, (1, d2): 20, (2, d2): None}
    mesmo = t.aplicar_troca({(1, d1): 10, (2, d1): 20}, 1, 2, t.datas_envolvidas(d1, d1))
    assert mesmo == {(1, d1): 20, (2, d1): 10}


def test_skills_so_compativeis_se_iguais():
    assert t.skills_compativeis(frozenset({1, 2}), frozenset({1, 2}))
    assert not t.skills_compativeis(frozenset({1}), frozenset({1, 2}))


def test_modulo_e_puro():
    fonte = inspect.getsource(t)
    for proibido in ("pyodbc", "fastapi", "datetime.now", "date.today"):
        assert proibido not in fonte

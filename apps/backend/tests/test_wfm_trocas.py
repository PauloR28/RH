from __future__ import annotations

import inspect
from datetime import date, datetime

from rh_api.services import wfm_trocas as t

# 2026-09-28 é segunda-feira
SEG = datetime(2026, 9, 28, 9, 0)
QUI = datetime(2026, 10, 1, 9, 0)
SEX = datetime(2026, 10, 2, 9, 0)


def test_so_abre_de_segunda_a_quinta():
    d = date(2026, 10, 3)
    assert t.validar_janela(QUI, d, d, []) == []
    assert any("segunda a quinta" in e for e in t.validar_janela(SEX, d, d, []))
    assert any("segunda a quinta" in e for e in t.validar_janela(datetime(2026, 10, 3, 9), d, d, []))  # sábado


def test_so_dias_da_semana_corrente_inclusive_dias_diferentes():
    assert t.validar_janela(SEG, date(2026, 9, 29), date(2026, 10, 2), []) == []
    e = t.validar_janela(SEG, date(2026, 9, 29), date(2026, 10, 5), [])  # próxima segunda
    assert any("semana corrente" in x for x in e)
    assert any("semana corrente" in x for x in t.validar_janela(SEG, date(2026, 9, 27), date(2026, 9, 29), []))  # domingo passado


def test_antecedencia_minima_de_12_horas():
    d = date(2026, 9, 28)
    assert any("antecedência" in e for e in t.validar_janela(SEG, d, d, [datetime(2026, 9, 28, 20, 59)]))
    assert t.validar_janela(SEG, d, d, [datetime(2026, 9, 28, 21, 0)]) == []  # exatamente 12h


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

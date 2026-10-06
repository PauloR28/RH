"""WFM — aplicar as pausas de um dia ao mês/semana (por dia da semana), respeitando o limite de operadores em pausa ao mesmo
tempo. Integração contra o banco de DESENVOLVIMENTO; reaproveita a operação/escala `WFMTROCA_xxxx` do teste de trocas."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from test_wfm_trocas_integration import MES, _erro, _item, _pausas, ctx  # noqa: F401  (ctx é o fixture do módulo de trocas)


def _horas(ctx, id_op, dia):
    d = ctx.repo.wfm_get_pausas_dia(ctx.cd, ctx.op, f"{MES}-{dia:02d}")
    item = next((i for i in d["operadores"] if i["id_operador"] == id_op), None)
    return [p["inicio"] for p in (item["pausas"] if item else [])]


@pytest.fixture(scope="module")
def mes_cheio(ctx):  # noqa: F811
    # A, B e C trabalham de manhã (08-16) nas segundas 08/15 e nas terças 09/16; limite de 2 em pausa ao mesmo tempo.
    dias = (8, 9, 15, 16)
    ctx.repo.wfm_salvar_itens(ctx.cd, ctx.op, MES, [_item(i, d, ctx.M) for i in (ctx.id_a, ctx.id_b, ctx.id_c) for d in dias])
    ctx.repo.wfm_set_capacidade_pausas(ctx.cd, ctx.op, 2)
    ctx.repo.wfm_salvar_pausas(ctx.cd, ctx.op, f"{MES}-08", [
        {"id_operador": ctx.id_a, "pausas": _pausas(["09:00", "11:00", "13:00"])},
        {"id_operador": ctx.id_b, "pausas": _pausas(["09:00", "11:00", "13:00"])},   # A e B juntos = 2 (o limite)
        {"id_operador": ctx.id_c, "pausas": _pausas(["10:00", "12:00", "14:00"])},
    ])
    return ctx


def _replicar(c, **k):
    return c.repo.wfm_replicar_pausas(c.cd, c.op, f"{MES}-08", f"{MES}-01", f"{MES}-31", **k)


def test_replica_so_nos_dias_da_semana_escolhidos(mes_cheio):
    c = mes_cheio
    r = _replicar(c, dias_semana=[0])  # só segundas-feiras
    assert r["dias_programados"] == 1 and r["pausas_gravadas"] == 3          # 15/03 é a única outra segunda escalada
    assert _horas(c, c.id_a, 15) == ["09:00", "11:00", "13:00"]
    assert _horas(c, c.id_c, 15) == ["10:00", "12:00", "14:00"]
    assert _horas(c, c.id_a, 9) == [] and _horas(c, c.id_a, 16) == []      # terça não foi marcada
    assert c.repo.wfm_get_pausas_dia(c.cd, c.op, f"{MES}-15")["excedentes"] == []


def test_replica_no_mes_todo_quando_nenhum_dia_e_filtrado(mes_cheio):
    c = mes_cheio
    r = _replicar(c)  # todos os dias do mês
    assert r["dias_programados"] == 8                                        # dias em que A, B ou C trabalham (menos a origem, 08)
    assert all(_horas(c, i, 9) == _horas(c, i, 8) for i in (c.id_a, c.id_b, c.id_c))   # mesmo turno: mesmos horários
    # A trabalha de TARDE (14h-22h) no dia 02: o horário da manhã não existe nesse turno, então as pausas ficam dentro do turno dele
    tarde = _horas(c, c.id_a, 2)
    assert len(tarde) == 3 and all("14:00" <= h < "22:00" for h in tarde)


def test_respeita_o_limite_considerando_quem_ja_tem_pausa_no_dia(mes_cheio):
    c = mes_cheio
    # no dia 16, C já tem a pausa das 09:00; replicar só A e B (as duas às 09:00) estouraria o limite de 2: uma é deslocada
    c.repo.wfm_salvar_pausas(c.cd, c.op, f"{MES}-16", [{"id_operador": c.id_c, "pausas": _pausas(["09:00", "11:30", "14:00"])}])
    r = c.repo.wfm_replicar_pausas(c.cd, c.op, f"{MES}-08", f"{MES}-16", f"{MES}-16", [c.id_a, c.id_b], dias_semana=[1])
    assert r["pausas_gravadas"] == 2 and r["deslocadas"] >= 1 and r["dias_com_excesso"] == 0
    assert c.repo.wfm_get_pausas_dia(c.cd, c.op, f"{MES}-16")["excedentes"] == []
    assert _horas(c, c.id_c, 16) == ["09:00", "11:30", "14:00"]               # quem não estava no modelo não foi mexido


def test_nao_sobrescrever_preserva_o_que_ja_existe(mes_cheio):
    c = mes_cheio
    c.repo.wfm_salvar_pausas(c.cd, c.op, f"{MES}-09", [{"id_operador": c.id_a, "pausas": _pausas(["08:30", "12:00", "15:00"])}])
    r = _replicar(c, dias_semana=[1], sobrescrever=False)
    assert _horas(c, c.id_a, 9) == ["08:30", "12:00", "15:00"]
    assert r["pausas_gravadas"] >= 0


def test_sem_pausas_no_dia_de_origem_e_com_erro_claro(mes_cheio):
    c = mes_cheio
    e = _erro(c.repo.wfm_replicar_pausas, c.cd, c.op, f"{MES}-10", f"{MES}-01", f"{MES}-31")
    assert e.status_code == 422 and "pausas" in str(e.detail).lower()
    assert _erro(c.repo.wfm_replicar_pausas, c.cd, c.op, f"{MES}-08", f"{MES}-01", "2027-06-30").status_code == 400   # período > 2 meses
    assert _erro(c.repo.wfm_replicar_pausas, c.admin, c.op, f"{MES}-08", f"{MES}-01", f"{MES}-31").status_code == 403   # Administrador não programa


def test_operador_nao_replica_pausas(mes_cheio):
    c = mes_cheio
    with pytest.raises(HTTPException) as e:
        c.repo.wfm_replicar_pausas(c.a, c.op, f"{MES}-08", f"{MES}-01", f"{MES}-31")
    assert e.value.status_code == 403

from __future__ import annotations

import inspect

from rh_api.services import wfm_pausas as p
from rh_api.services.wfm_pausas import PausaProgramada, distribuir, excedentes, janela_do_turno, ocupacao, validar_pausas_do_operador

M = janela_do_turno("07:00", "13:00")


def _ops(n, janela=M):
    return [{"id": i, "entrada_min": janela[0], "saida_min": janela[1]} for i in range(1, n + 1)]


def _prog(resultado):
    return {k: v for k, v in resultado.items()}


def test_cada_operador_recebe_2_pausas_de_10_e_1_de_20():
    r = distribuir(_ops(1), 1)
    assert [(x.tipo, x.duracao_min) for x in r[1]] == [("DESCANSO", 10), ("REFEICAO", 20), ("DESCANSO", 10)]
    assert validar_pausas_do_operador(r[1], *M) == []


def test_operacao_pequena_um_operador_por_vez_nunca_excede():
    r = distribuir(_ops(6), 1)
    assert excedentes(_prog(r), 1) == []
    assert max(ocupacao(_prog(r)).values()) == 1


def test_operacao_grande_quatro_por_vez():
    r = distribuir(_ops(20), 4)
    assert max(ocupacao(_prog(r)).values()) <= 4
    assert all(validar_pausas_do_operador(v, *M) == [] for v in r.values())


def test_excedente_e_detectado_como_faixa_de_horario():
    prog = {1: [PausaProgramada(1, "DESCANSO", 9 * 60, 10)], 2: [PausaProgramada(1, "DESCANSO", 9 * 60, 10)], 3: [PausaProgramada(1, "DESCANSO", 9 * 60 + 5, 10)]}
    faixas = excedentes(prog, 2)
    assert faixas and faixas[0]["inicio"] == "09:05" and faixas[0]["qtd"] == 3 and faixas[0]["capacidade"] == 2
    assert excedentes(prog, 3) == []


def test_turno_noturno_atravessa_a_meia_noite():
    janela = janela_do_turno("22:00", "04:00")
    assert janela == (1320, 1680)
    r = distribuir(_ops(3, janela), 1)
    assert all(validar_pausas_do_operador(v, *janela) == [] for v in r.values())
    assert p.desenrolar("01:00", janela[0]) == 60 + 1440


def test_validacao_fora_do_turno_e_sobreposicao():
    fora = [PausaProgramada(1, "DESCANSO", 6 * 60, 10)]
    assert any("fora do horário" in e for e in validar_pausas_do_operador(fora, *M))
    sobre = [PausaProgramada(1, "DESCANSO", 9 * 60, 10), PausaProgramada(2, "REFEICAO", 9 * 60 + 5, 20)]
    assert any("sobrepõem" in e for e in validar_pausas_do_operador(sobre, *M))


def test_modulo_e_puro():
    fonte = inspect.getsource(p)
    assert all(x not in fonte for x in ("pyodbc", "fastapi", "datetime.now"))

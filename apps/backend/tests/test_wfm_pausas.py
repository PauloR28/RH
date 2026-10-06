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


# ---- replicar as pausas de um dia para os demais (semana/mês) respeitando o limite de simultâneas ----
def _modelo(*horas):
    return [(1, "DESCANSO", horas[0], 10), (2, "REFEICAO", horas[1], 20), (3, "DESCANSO", horas[2], 10)]


def _op(i, modelo, janela=M):
    return {"id": i, "entrada_min": janela[0], "saida_min": janela[1], "modelo": modelo}


def test_replicar_mantem_os_horarios_quando_cabem_no_limite():
    # 3 operadores com a pausa 1 na MESMA hora e limite 3: os horários do modelo ficam exatamente como estão
    ops = [_op(i, _modelo("08:00", "10:00", "12:00")) for i in (1, 2, 3)]
    r, deslocadas, acima = p.replicar(ops, 3)
    assert deslocadas == 0 and acima == 0
    assert all([(x.ordem, p.min_para_hhmm(x.inicio_min)) for x in r[i]] == [(1, "08:00"), (2, "10:00"), (3, "12:00")] for i in (1, 2, 3))
    assert excedentes(_prog(r), 3) == []


def test_replicar_desloca_so_o_que_estoura_o_limite():
    # 3 na mesma hora com limite 2: dois ficam, o terceiro vai para o horário livre mais próximo (e nunca passa do limite)
    ops = [_op(i, _modelo("08:00", "10:00", "12:00")) for i in (1, 2, 3)]
    r, deslocadas, acima = p.replicar(ops, 2)
    assert deslocadas > 0 and acima == 0
    assert excedentes(_prog(r), 2) == []
    assert [p.min_para_hhmm(x.inicio_min) for x in r[1]] == ["08:00", "10:00", "12:00"]
    assert [p.min_para_hhmm(x.inicio_min) for x in r[2]] == ["08:00", "10:00", "12:00"]
    assert p.min_para_hhmm(r[3][0].inicio_min) != "08:00"
    assert all(validar_pausas_do_operador(v, *M) == [] for v in r.values())


def test_replicar_conta_as_pausas_de_quem_nao_esta_no_modelo():
    # outro operador já tem pausa 08:00 no dia (limite 1): a pausa do modelo às 08:00 é deslocada
    ocupado = ocupacao({99: [PausaProgramada(1, "DESCANSO", 8 * 60, 10)]})
    r, deslocadas, _ = p.replicar([_op(1, _modelo("08:00", "10:00", "12:00"))], 1, ocupado)
    assert deslocadas == 1 and p.min_para_hhmm(r[1][0].inicio_min) != "08:00"


def test_replicar_em_turno_diferente_usa_o_ideal_do_turno():
    tarde = janela_do_turno("14:00", "20:00")  # o modelo (manhã) não existe neste turno
    r, _, _ = p.replicar([_op(1, _modelo("08:00", "10:00", "12:00"), tarde)], 1)
    assert validar_pausas_do_operador(r[1], *tarde) == []
    assert all(x.inicio_min >= tarde[0] for x in r[1])


def test_replicar_sem_vaga_mantem_o_horario_e_conta_como_acima_do_limite():
    # turno de 20 min com 2 operadores e limite 1: não há onde deslocar a refeição de 20 min
    curto = janela_do_turno("08:00", "08:20")
    ops = [_op(i, [(2, "REFEICAO", "08:00", 20)], curto) for i in (1, 2)]
    r, _, acima = p.replicar(ops, 1)
    assert acima == 1 and len(r[1]) == 1 and len(r[2]) == 1


def test_modulo_e_puro():
    fonte = inspect.getsource(p)
    assert all(x not in fonte for x in ("pyodbc", "fastapi", "datetime.now"))


def test_rota_de_replicar_pausas_recebe_o_corpo_json():
    """Garante que o schema da rota está importado: sem ele o FastAPI cobra um parâmetro `payload` e a tela recebe 422."""
    from rh_api.main import app

    rota = app.openapi()["paths"]["/wfm/pausas/replicar"]["post"]
    assert "requestBody" in rota
    assert all(par["name"] != "payload" for par in rota.get("parameters", []))

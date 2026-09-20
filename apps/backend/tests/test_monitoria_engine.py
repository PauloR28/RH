"""Motor único de cálculo + máquina de status/SLA da Monitoria (testes puros)."""

from __future__ import annotations

import copy
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.services import monitoria_workflow as wf
from rh_api.services.monitoria_engine import (
    calcular_nota,
    config_padrao,
    criterios_sem_resposta,
    faixa_da_nota,
    media_pilar,
    normalizar_config,
    validar_config,
    validar_pilares,
)


def _todas(config, valor="SIM"):
    return {c["id"]: valor for b in config["blocos"] for c in b["criterios"]}


# ---------------------------------------------------------------------------
# Matriz padrão e validação
# ---------------------------------------------------------------------------
def test_matriz_padrao_tem_8_blocos_somando_100_e_e_valida():
    config = config_padrao()
    assert [b["nome"] for b in config["blocos"]] == [
        "Acolhimento", "Escuta ativa", "Sondagem", "Solução", "Comunicação", "Condução", "Encerramento", "Conformidades",
    ]
    assert sum(b["valor"] for b in config["blocos"]) == 100
    assert validar_config(config) == []


def test_soma_dos_pesos_diferente_do_bloco_e_bloqueada():
    config = config_padrao()
    config["blocos"][0]["criterios"][0]["peso"] = 3  # 3 + 2,5×3 = 10,5 ≠ 10
    erros = validar_config(config)
    assert any("Acolhimento" in e and "soma dos pesos" in e for e in erros)


def test_normalizar_config_atribui_ids_estaveis_a_itens_novos():
    config = config_padrao()
    config["blocos"].append({"nome": "Novo", "valor": 5, "criterios": [{"texto": "Critério novo", "peso": 5}]})
    novo = normalizar_config(config)
    ids = [c["id"] for b in novo["blocos"] for c in b["criterios"]]
    assert len(ids) == len(set(ids))
    assert novo["blocos"][0]["criterios"][0]["id"] == "b1c1"  # ids existentes preservados


# ---------------------------------------------------------------------------
# Cálculo da nota (promt.txt §5.1–5.4, critérios de aceite)
# ---------------------------------------------------------------------------
def test_tudo_sim_vale_100():
    r = calcular_nota(config_padrao(), _todas(config_padrao()))
    assert r["nota"] == Decimal("100.00") and not r["possui_ncg"] and not r["anulada"]
    assert r["blocos_avaliados"] == 8


def test_exemplo_de_conferencia_do_prompt_da_85():
    config = config_padrao()
    respostas = _todas(config)
    respostas["b1c1"] = "NAO"   # Acolhimento 7,5
    respostas["b2c1"] = "NAO"   # Escuta 10
    respostas["b5c1"] = "NAO"   # Comunicação 10
    respostas["b6c1"] = "NAO"   # Condução 7,5
    assert calcular_nota(config, respostas)["nota"] == Decimal("85.00")


def test_ncg_zera_a_nota_e_mantem_a_monitoria_valida_no_fluxo():
    config = config_padrao()
    respostas = _todas(config)
    respostas["b4c1"] = "NCG"
    r = calcular_nota(config, respostas)
    assert r["nota"] == Decimal("0.00") and r["possui_ncg"] is True and r["anulada"] is False


def test_na_anula_o_bloco_inteiro_e_redistribui_o_peso():
    config = config_padrao()
    respostas = _todas(config)
    respostas["b1c3"] = "NA"   # Acolhimento vira NULO
    r = calcular_nota(config, respostas)
    assert r["blocos_avaliados"] == 7 and r["blocos_nulos"] == 1
    assert r["nota"] == Decimal("100.00")  # 90 pontos redistribuídos em 100
    acolhimento = next(b for b in r["blocos"] if b["id"] == "b1")
    assert acolhimento["status"] == "NULO" and acolhimento["pontos"] == 0


def test_na_com_erro_em_outro_bloco_usa_fator_100_sobre_blocos_avaliados():
    config = config_padrao()
    respostas = _todas(config)
    respostas["b1c1"] = "NA"     # bloco 1 (10) fora → avaliados somam 90
    respostas["b4c1"] = "NAO"    # Solução perde 10
    r = calcular_nota(config, respostas)
    assert r["nota"] == Decimal("88.89")  # (90-10) × 100/90


def test_exemplo_do_docx_corrigido_da_90_e_nao_88():
    """O docx (Bloco 10.14) escreve 88, mas (1,00×15 + 0,80×15 + 0,90×20) ÷ 50 × 100 = 90."""
    config = {
        "blocos": [
            {"id": "a", "nome": "A", "valor": 10, "criterios": [{"id": "a1", "texto": "a1", "peso": 10}]},
            {"id": "b", "nome": "B", "valor": 15, "criterios": [{"id": "b1", "texto": "b1", "peso": 15}]},
            {"id": "c", "nome": "C", "valor": 15, "criterios": [{"id": "c1", "texto": "c1", "peso": 12}, {"id": "c2", "texto": "c2", "peso": 3}]},
            {"id": "d", "nome": "D", "valor": 20, "criterios": [{"id": "d1", "texto": "d1", "peso": 18}, {"id": "d2", "texto": "d2", "peso": 2}]},
        ],
        "min_blocos": 3,
    }
    respostas = {"a1": "NA", "b1": "SIM", "c1": "SIM", "c2": "NAO", "d1": "SIM", "d2": "NAO"}
    # C = 12/15 = 80%, D = 18/20 = 90%
    r = calcular_nota(config, respostas)
    assert r["nota"] == Decimal("90.00")


def test_menos_de_3_blocos_avaliados_anula_a_monitoria():
    config = config_padrao()
    respostas = _todas(config)
    for bloco in ("b1c1", "b2c1", "b3c1", "b4c1", "b5c1", "b6c1"):
        respostas[bloco] = "NA"     # 6 blocos nulos → só 2 avaliados
    r = calcular_nota(config, respostas)
    assert r["blocos_avaliados"] == 2 and r["anulada"] is True


def test_prioridade_ncg_sobre_minimo_de_blocos_e_sobre_na():
    config = config_padrao()
    respostas = _todas(config)
    for bloco in ("b1c1", "b2c1", "b3c1", "b4c1", "b5c1", "b6c1"):
        respostas[bloco] = "NA"
    respostas["b7c1"] = "NCG"
    r = calcular_nota(config, respostas)
    assert r["nota"] == Decimal("0.00") and r["possui_ncg"] and not r["anulada"]


def test_nota_tem_duas_casas_decimais():
    config = config_padrao()
    respostas = _todas(config)
    respostas["b1c1"] = "NA"
    respostas["b2c1"] = "NAO"
    nota = calcular_nota(config, respostas)["nota"]
    assert nota == nota.quantize(Decimal("0.01"))


def test_criterios_sem_resposta_sao_apontados():
    config = config_padrao()
    respostas = _todas(config)
    del respostas["b3c2"]
    respostas["b8c1"] = ""
    assert set(criterios_sem_resposta(config, respostas)) == {"b3c2", "b8c1"}


def test_respostas_aceitam_variacoes_de_grafia():
    config = config_padrao()
    respostas = _todas(config, "sim")
    respostas["b1c1"] = "N/A"
    respostas["b2c1"] = "Não"
    r = calcular_nota(config, respostas)
    assert r["blocos_nulos"] == 1 and r["nota"] < Decimal("100")


# ---------------------------------------------------------------------------
# Faixas e pilares
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "nota,rotulo",
    [(100, "Excelência"), (95, "Excelência"), (94.99, "Muito bom"), (90, "Muito bom"), (89.5, "Bom"), (80, "Bom"),
     (79, "Desenvolvimento"), (70, "Desenvolvimento"), (69.99, "Crítico"), (0, "Crítico")],
)
def test_faixas_de_nota(nota, rotulo):
    assert faixa_da_nota(nota, config_padrao()["faixas"])["label"] == rotulo


def test_faixa_usa_as_faixas_do_snapshot_e_nao_as_atuais():
    faixas_antigas = [{"min": 50, "max": 100, "label": "Aprovado", "cor": "#000"}, {"min": 0, "max": 49.99, "label": "Reprovado", "cor": "#111"}]
    assert faixa_da_nota(60, faixas_antigas)["label"] == "Aprovado"


def test_pilares_validam_escala_e_nao_afetam_nota():
    config = config_padrao()
    ok, erros = validar_pilares(config, {"conhecimento": {"Agilidade": 8, "Segurança": 9, "Complexidade": 7},
                                          "encantamento": {"Empatia": 10, "Conformidade": 9, "Experiência": 8}})
    assert erros == [] and media_pilar(ok["conhecimento"]) == 8.0
    _, erros = validar_pilares(config, {"conhecimento": {"Agilidade": 11}, "encantamento": {}})
    assert len(erros) >= 2
    sem_pilares = calcular_nota(config, _todas(config))["nota"]
    assert sem_pilares == Decimal("100.00")  # pilares nunca entram na nota


# ---------------------------------------------------------------------------
# Máquina de status e SLA
# ---------------------------------------------------------------------------
def test_ciclo_completo_de_status():
    assert [s for s, _ in wf.passos_criacao(False)] == [wf.REALIZADA, wf.FEEDBACK_PENDENTE]
    assert wf.passos_criacao(False)[-1][1] == wf.SLA_FEEDBACK
    assert [s for s, _ in wf.passos_criacao(True)] == [wf.REALIZADA, wf.ANULADA, wf.FINALIZADA]
    assert [s for s, _ in wf.passos_feedback_aplicado()] == [wf.FEEDBACK_APLICADO, wf.AGUARDANDO_CONFIRMACAO]
    assert [s for s, _ in wf.passos_confirmacao()] == [wf.CONFIRMADA, wf.FINALIZADA]
    assert [s for s, _ in wf.passos_contestacao()] == [wf.CONTESTADA, wf.REANALISE]
    assert wf.passos_reanalise(wf.RESULTADO_CONFIRMADA)[-1][0] == wf.FINALIZADA
    assert wf.passos_reanalise(wf.RESULTADO_ANULADA)[0][0] == wf.ANULADA
    assert wf.resultado_final(wf.passos_reanalise(wf.RESULTADO_ANULADA)) == wf.RESULTADO_ANULADA
    with pytest.raises(wf.TransicaoInvalida):
        wf.passos_reanalise("QUALQUER")


def test_transicoes_so_a_partir_do_status_correto():
    wf.validar_transicao("aplicar_feedback", wf.FEEDBACK_PENDENTE)
    wf.validar_transicao("contestar", wf.AGUARDANDO_CONFIRMACAO)
    for acao, status in (("aplicar_feedback", wf.FINALIZADA), ("confirmar", wf.FEEDBACK_PENDENTE),
                         ("reanalisar", wf.AGUARDANDO_CONFIRMACAO), ("contestar", wf.REANALISE)):
        with pytest.raises(wf.TransicaoInvalida):
            wf.validar_transicao(acao, status)


def test_prazos_oficiais_em_horas_corridas():
    assert wf.HORAS_SLA_OFICIAIS == {"FEEDBACK": 72, "CONFIRMACAO": 48, "REANALISE": 72}
    inicio = datetime(2026, 9, 18, 10, 0)
    assert wf.sla_limite(inicio, wf.SLA_CONFIRMACAO) == inicio + timedelta(hours=48)


def test_estados_do_sla():
    inicio = datetime(2026, 9, 18, 10, 0)
    limite = inicio + timedelta(hours=48)
    assert wf.estado_sla(inicio, limite, agora=inicio + timedelta(hours=10))["estado"] == wf.ESTADO_DENTRO
    assert wf.estado_sla(inicio, limite, agora=inicio + timedelta(hours=40))["estado"] == wf.ESTADO_PROXIMO
    vencido = wf.estado_sla(inicio, limite, agora=limite + timedelta(hours=3))
    assert vencido["estado"] == wf.ESTADO_VENCIDO and vencido["atraso_h"] == 3.0
    no_prazo = wf.estado_sla(inicio, limite, agora=limite + timedelta(hours=9), concluido_em=inicio + timedelta(hours=20))
    assert no_prazo["estado"] == wf.ESTADO_CONCLUIDO_NO_PRAZO
    fora = wf.estado_sla(inicio, limite, agora=limite + timedelta(hours=9), concluido_em=limite + timedelta(hours=2))
    assert fora["estado"] == wf.ESTADO_CONCLUIDO_FORA and fora["atraso_h"] == 2.0


def test_limiar_de_alerta_e_configuravel_sem_mudar_o_prazo():
    inicio = datetime(2026, 9, 18, 10, 0)
    limite = inicio + timedelta(hours=72)
    agora = inicio + timedelta(hours=40)  # 55% do prazo
    assert wf.estado_sla(inicio, limite, agora=agora, limiar_alerta_pct=75)["estado"] == wf.ESTADO_DENTRO
    assert wf.estado_sla(inicio, limite, agora=agora, limiar_alerta_pct=50)["estado"] == wf.ESTADO_PROXIMO
    assert limite - inicio == timedelta(hours=72)


def test_acao_automatica_por_vencimento():
    limite = datetime(2026, 9, 20, 12, 0)
    depois = limite + timedelta(minutes=1)
    assert wf.acao_automatica_por_vencimento(wf.AGUARDANDO_CONFIRMACAO, limite, depois) == "confirmar_automatico"
    assert wf.acao_automatica_por_vencimento(wf.REANALISE, limite, depois) == "anular_automatico"
    assert wf.acao_automatica_por_vencimento(wf.FEEDBACK_PENDENTE, limite, depois) is None  # só sinaliza
    assert wf.acao_automatica_por_vencimento(wf.AGUARDANDO_CONFIRMACAO, limite, limite) is None
    assert wf.acao_automatica_por_vencimento(wf.FINALIZADA, limite, depois) is None

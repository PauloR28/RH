from __future__ import annotations

import sys
import unittest
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.services.disc_engine import (
    DIMENSOES,
    calcular_aderencia_call_center,
    calcular_perfil_disc,
)
from rh_api.services.feedback_qualitativo import build_qualitative_feedback
from rh_api.services.fit_cultural_engine import calcular_score_fit_cultural
from rh_api.services.raciocinio_engine import (
    COMPOSICAO_PADRAO,
    COMPOSICAO_POR_NIVEL,
    corrigir_raciocinio,
    escolher_proxima_pergunta_adaptativa,
    montar_prova_balanceada_por_nivel,
    proxima_dificuldade_adaptativa,
)


class DiscEngineTests(unittest.TestCase):
    def test_calcula_perfil_disc_com_mais_e_menos(self):
        frases_por_id = {
            1: {"dimensao": "D"},
            2: {"dimensao": "I"},
            3: {"dimensao": "S"},
            4: {"dimensao": "C"},
        }
        respostas = [
            {"frase_mais_id": 2, "frase_menos_id": 1},  # +I, -D
            {"frase_mais_id": 3, "frase_menos_id": 4},  # +S, -C
        ]

        perfil = calcular_perfil_disc(respostas, frases_por_id)

        self.assertEqual(perfil["pontos_brutos"], {"D": -1, "I": 1, "S": 1, "C": -1})
        self.assertEqual(perfil["blocos_respondidos"], 2)
        for dim in DIMENSOES:
            self.assertIn(dim, perfil["percentuais"])
        # Os dois positivos (I e S) dividem 100% igualmente.
        self.assertEqual(perfil["percentuais"]["I"], 50.0)
        self.assertEqual(perfil["percentuais"]["S"], 50.0)

    def test_ignora_resposta_invalida_com_mesma_frase_mais_e_menos(self):
        frases_por_id = {1: {"dimensao": "D"}}
        perfil = calcular_perfil_disc([{"frase_mais_id": 1, "frase_menos_id": 1}], frases_por_id)
        self.assertEqual(perfil["blocos_respondidos"], 0)

    def test_aderencia_call_center_perfil_alinhado_ao_alvo(self):
        # Perfil igual ao alvo documentado (I e S mais fortes) deve gerar alta aderência.
        percentuais = {"D": 15.0, "I": 30.0, "S": 30.0, "C": 25.0}
        aderencia = calcular_aderencia_call_center(percentuais)
        self.assertEqual(aderencia["percentual_aderencia"], 100.0)
        self.assertEqual(aderencia["faixa"], "Alta aderência")

    def test_aderencia_call_center_perfil_distante_do_alvo(self):
        # Perfil 100% concentrado em D (baixo peso no alvo) deve reduzir a aderência.
        percentuais = {"D": 100.0, "I": 0.0, "S": 0.0, "C": 0.0}
        aderencia = calcular_aderencia_call_center(percentuais)
        self.assertLess(aderencia["percentual_aderencia"], 75.0)
        self.assertNotEqual(aderencia["faixa"], "Alta aderência")


class FitCulturalEngineTests(unittest.TestCase):
    def test_calcula_score_por_valor_e_geral(self):
        frases_por_id = {
            1: {"valor_id": 10, "valor_nome": "Colaboração"},
            2: {"valor_id": 10, "valor_nome": "Colaboração"},
            3: {"valor_id": 20, "valor_nome": "Autonomia"},
        }
        respostas = [
            {"frase_id": 1, "nota_concordancia": 5},
            {"frase_id": 2, "nota_concordancia": 3},
            {"frase_id": 3, "nota_concordancia": 1},
        ]

        resultado = calcular_score_fit_cultural(respostas, frases_por_id)

        colaboracao = next(item for item in resultado["por_valor"] if item["valor_id"] == 10)
        autonomia = next(item for item in resultado["por_valor"] if item["valor_id"] == 20)

        self.assertEqual(colaboracao["media_nota"], 4.0)
        self.assertEqual(colaboracao["percentual_aderencia"], 75.0)
        self.assertEqual(autonomia["percentual_aderencia"], 0.0)
        self.assertEqual(resultado["score_geral"], 37.5)
        self.assertEqual(resultado["total_respostas"], 3)

    def test_sem_respostas_retorna_score_zerado(self):
        resultado = calcular_score_fit_cultural([], {})
        self.assertEqual(resultado["por_valor"], [])
        self.assertEqual(resultado["score_geral"], 0.0)


class RaciocinioEngineTests(unittest.TestCase):
    def test_corrige_e_agrega_por_tipo_e_dificuldade(self):
        perguntas = [
            {
                "id_pergunta": 1,
                "gabarito": 1,
                "tipo": "sequencia_logica",
                "dificuldade": "facil",
                "enunciado": "2, 4, 6, 8, ?",
            },
            {
                "id_pergunta": 2,
                "gabarito": 0,
                "tipo": "interpretacao_numerica",
                "dificuldade": "medio",
                "enunciado": "Média de ligações por hora",
                "feedback_erro": "Revise cálculo de médias.",
            },
        ]
        respostas = {1: 1, 2: 2}  # acerta a primeira, erra a segunda

        resultado = corrigir_raciocinio(perguntas, respostas)

        self.assertEqual(resultado["acertos"], 1)
        self.assertEqual(resultado["total_questoes"], 2)
        self.assertEqual(resultado["nota"], 50.0)
        self.assertEqual(resultado["por_tipo"]["sequencia_logica"], {"acertos": 1, "total": 1})
        self.assertEqual(resultado["por_dificuldade"]["medio"], {"acertos": 0, "total": 1})

        errada = next(item for item in resultado["detalhes"] if not item["correta"])
        self.assertEqual(errada["feedback_qualitativo"], "Revise cálculo de médias.")

    def test_usa_feedback_padrao_quando_nao_cadastrado(self):
        perguntas = [
            {
                "id_pergunta": 5,
                "gabarito": 0,
                "tipo": "problema_matematico",
                "dificuldade": "dificil",
                "enunciado": "Quanto é 2 + 2?",
            }
        ]
        resultado = corrigir_raciocinio(perguntas, {5: 3})
        detalhe = resultado["detalhes"][0]
        self.assertFalse(detalhe["correta"])
        self.assertIn("Resposta incorreta", detalhe["feedback_qualitativo"])


class RaciocinioAdaptativoTests(unittest.TestCase):
    """Feature roadmap (respostas.txt): teste adaptativo simples de
    raciocínio lógico — sobe 1 nível de dificuldade ao acertar, desce 1
    nível ao errar, mantém quando o nível adjacente estiver esgotado."""

    def test_sobe_dificuldade_ao_acertar(self):
        self.assertEqual(proxima_dificuldade_adaptativa("facil", True), "medio")
        self.assertEqual(proxima_dificuldade_adaptativa("medio", True), "dificil")

    def test_nao_ultrapassa_o_nivel_mais_dificil(self):
        self.assertEqual(proxima_dificuldade_adaptativa("dificil", True), "dificil")

    def test_desce_dificuldade_ao_errar(self):
        self.assertEqual(proxima_dificuldade_adaptativa("dificil", False), "medio")
        self.assertEqual(proxima_dificuldade_adaptativa("medio", False), "facil")

    def test_nao_ultrapassa_o_nivel_mais_facil(self):
        self.assertEqual(proxima_dificuldade_adaptativa("facil", False), "facil")

    def test_sequencia_de_acertos_e_erros_sobe_e_desce_corretamente(self):
        # facil -(acerta)-> medio -(acerta)-> dificil -(erra)-> medio -(erra)-> facil
        nivel = "facil"
        transicoes = [True, True, False, False]
        esperado = ["medio", "dificil", "medio", "facil"]
        obtidos = []
        for acertou in transicoes:
            nivel = proxima_dificuldade_adaptativa(nivel, acertou)
            obtidos.append(nivel)
        self.assertEqual(obtidos, esperado)

    def test_escolhe_questao_do_nivel_alvo_quando_disponivel(self):
        pool = {
            "facil": [{"id_pergunta": 1}],
            "medio": [{"id_pergunta": 2}],
            "dificil": [{"id_pergunta": 3}],
        }
        escolhida, dificuldade = escolher_proxima_pergunta_adaptativa(pool, "dificil")
        self.assertEqual(escolhida["id_pergunta"], 3)
        self.assertEqual(dificuldade, "dificil")
        self.assertEqual(pool["dificil"], [])  # removida do pool (nao repete)

    def test_cai_para_nivel_mais_proximo_quando_alvo_esgotado(self):
        pool = {"facil": [{"id_pergunta": 1}], "medio": [], "dificil": [{"id_pergunta": 3}]}
        # Alvo "medio" esgotado -> deve preferir "facil" ou "dificil" (ambos a
        # distancia 1 de "medio"); qualquer um dos dois e um resultado valido.
        escolhida, dificuldade = escolher_proxima_pergunta_adaptativa(pool, "medio")
        self.assertIn(dificuldade, ("facil", "dificil"))
        self.assertIsNotNone(escolhida)

    def test_retorna_none_quando_pool_totalmente_esgotado(self):
        pool = {"facil": [], "medio": [], "dificil": []}
        escolhida, dificuldade = escolher_proxima_pergunta_adaptativa(pool, "medio")
        self.assertIsNone(escolhida)
        self.assertIsNone(dificuldade)


class RaciocinioBalanceamentoPorNivelTests(unittest.TestCase):
    """Feature roadmap (respostas.txt): balanceamento de composicao de
    dificuldade das questoes de raciocínio lógico por nível de vaga."""

    def _pool(self, quantidade_por_dificuldade=30):
        return {
            "facil": [{"id_pergunta": f"facil-{i}", "dificuldade": "facil"} for i in range(quantidade_por_dificuldade)],
            "medio": [{"id_pergunta": f"medio-{i}", "dificuldade": "medio"} for i in range(quantidade_por_dificuldade)],
            "dificil": [{"id_pergunta": f"dificil-{i}", "dificuldade": "dificil"} for i in range(quantidade_por_dificuldade)],
        }

    def _proporcoes(self, selecionadas, quantidade):
        contagem = {"facil": 0, "medio": 0, "dificil": 0}
        for pergunta in selecionadas:
            contagem[pergunta["dificuldade"]] += 1
        return {k: v / quantidade for k, v in contagem.items()}

    def test_composicao_bate_com_a_tabela_alvo_por_nivel(self):
        # Tolerancia de 1 questao (numeros inteiros) numa prova de 20 questoes.
        quantidade = 20
        for nivel, alvo in COMPOSICAO_POR_NIVEL.items():
            selecionadas = montar_prova_balanceada_por_nivel(self._pool(), quantidade, nivel)
            self.assertEqual(len(selecionadas), quantidade)
            proporcoes = self._proporcoes(selecionadas, quantidade)
            for dificuldade, proporcao_alvo in alvo.items():
                self.assertAlmostEqual(proporcoes[dificuldade], proporcao_alvo, delta=1 / quantidade + 0.01)

    def test_nivel_nao_informado_usa_composicao_padrao_33_33_34(self):
        quantidade = 30
        selecionadas = montar_prova_balanceada_por_nivel(self._pool(), quantidade, None)
        proporcoes = self._proporcoes(selecionadas, quantidade)
        for dificuldade, proporcao_alvo in COMPOSICAO_PADRAO.items():
            self.assertAlmostEqual(proporcoes[dificuldade], proporcao_alvo, delta=1 / quantidade + 0.01)

    def test_nivel_desconhecido_nao_quebra_o_fluxo_usa_padrao(self):
        selecionadas = montar_prova_balanceada_por_nivel(self._pool(), 10, "nivel-inexistente")
        self.assertEqual(len(selecionadas), 10)

    def test_redistribui_quando_falta_questao_em_um_nivel(self):
        # Banco pequeno em "dificil": mesmo pedindo composicao senior (peso
        # alto em dificil), a montagem deve completar com o que sobrar nos
        # outros niveis, sem quebrar nem retornar menos questoes que o pedido.
        pool = self._pool(quantidade_por_dificuldade=30)
        pool["dificil"] = pool["dificil"][:2]
        selecionadas = montar_prova_balanceada_por_nivel(pool, 20, "senior")
        self.assertEqual(len(selecionadas), 20)


class FeedbackQualitativoTests(unittest.TestCase):
    def test_gera_feedback_por_questao_errada_e_resumo_por_categoria(self):
        respostas = [
            {
                "questao_indice": 0,
                "questao_id": "q1",
                "categoria": "Raciocínio numérico",
                "correta": True,
                "texto_questao_snapshot": "Questão 1",
            },
            {
                "questao_indice": 1,
                "questao_id": "q2",
                "categoria": "Sequência lógica",
                "correta": False,
                "texto_questao_snapshot": "Complete a sequência 1, 2, 3, ?",
            },
            {
                "questao_indice": 2,
                "questao_id": "q3",
                "categoria": "Sequência lógica",
                "correta": False,
                "texto_questao_snapshot": "Outra questão de sequência",
            },
        ]
        questoes = [
            {"title": "Questão 1"},
            {"title": "Complete a sequência 1, 2, 3, ?", "feedbackErro": "Revise progressões aritméticas."},
            {"title": "Outra questão de sequência"},
        ]

        feedback = build_qualitative_feedback(respostas, questoes)

        self.assertEqual(len(feedback["questoes_erradas"]), 2)
        primeira_errada = feedback["questoes_erradas"][0]
        self.assertEqual(primeira_errada["feedback_qualitativo"], "Revise progressões aritméticas.")
        segunda_errada = feedback["questoes_erradas"][1]
        self.assertIn("Resposta incorreta", segunda_errada["feedback_qualitativo"])

        self.assertEqual(
            feedback["resumo_por_categoria"]["Sequência lógica"],
            {"acertos": 0, "total": 2},
        )
        self.assertIn("Sequência lógica (0/2)", feedback["resumo_textual"])

    def test_sem_respostas_gera_resumo_generico(self):
        feedback = build_qualitative_feedback([], [])
        self.assertEqual(feedback["questoes_erradas"], [])
        self.assertIn("Sem dados suficientes", feedback["resumo_textual"])


if __name__ == "__main__":
    unittest.main()

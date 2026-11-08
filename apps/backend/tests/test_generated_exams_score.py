from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from rh_api.repositories.generated_exams import (
    GeneratedExamRepositoryMixin,
    _is_public_answer_complete,
    _map_rh_decision_to_candidate_status,
    _public_question_payload,
)
from rh_api.routers.generated_exams import (
    create_generated_exam,
    delete_generated_exam,
    public_access_code,
    public_access_email,
    public_finalize_exam,
    update_generated_exam,
)
from rh_api.schemas.generated_exams import (
    GeneratedExamCreateRequest,
    PublicExamAccessRequest,
    PublicExamAnswersRequest,
)
from rh_api.services.process_flow import (
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_PENDING_CONFIRMATION,
    CANDIDATE_STATUS_TALENT_BANK,
)
from rh_api.services.score_conecta import calcular_score_conecta


class FakeGeneratedExamRepository:
    def __init__(self):
        self.created_payloads: list[dict] = []
        self.generated_by = ""
        self.finalized_payloads: list[dict] = []
        self.updated_payloads: list[dict] = []
        self.deleted_ids: list[int] = []

    def create_generated_exam(self, data: dict, *, generated_by: str = ""):
        self.created_payloads.append(data)
        self.generated_by = generated_by
        return {
            "success": True,
            "id_prova": 7,
            "id_teste": data.get("id_teste") or "CP-TESTE",
            "codigo_acesso": "AB12",
            "link_publico": "/conecta-provas",
            "status": "Disponível",
        }

    def public_access_by_email(self, email: str):
        return {
            "success": True,
            "provas": [
                {
                    "token": "token-publico",
                    "vaga": "Analista",
                    "operacao": "CRF",
                    "status": "Disponível",
                }
            ],
        }

    def public_access_by_code(self, code: str):
        return {
            "success": bool(re.fullmatch(r"[A-Z]{2}\d{2}", code)),
            "provas": [{"token": "token-publico"}] if re.fullmatch(r"[A-Z]{2}\d{2}", code) else [],
        }

    def public_finalize_exam(self, data: dict):
        self.finalized_payloads.append(data)
        return {
            "success": True,
            "status": "Finalizada",
            "pendente_avaliacao_manual": False,
        }

    def update_generated_exam(self, id_prova: int, data: dict, *, updated_by: str = ""):
        self.updated_payloads.append({"id_prova": id_prova, "data": data, "updated_by": updated_by})
        return {"success": True, "id_prova": id_prova, "status": "Disponível"}

    def delete_generated_exam(self, id_prova: int):
        self.deleted_ids.append(id_prova)
        return {"success": True}


class GeneratedExamsAndScoreTests(unittest.TestCase):
    def test_rh_decision_maps_to_existing_candidate_statuses(self):
        self.assertEqual(_map_rh_decision_to_candidate_status("Aprovado"), CANDIDATE_STATUS_APPROVED)
        self.assertEqual(_map_rh_decision_to_candidate_status("Aprovado com ressalvas"), CANDIDATE_STATUS_APPROVED)
        self.assertEqual(_map_rh_decision_to_candidate_status("Reprovado"), CANDIDATE_STATUS_ELIMINATED)
        self.assertEqual(_map_rh_decision_to_candidate_status("Eliminado"), CANDIDATE_STATUS_ELIMINATED)
        self.assertEqual(_map_rh_decision_to_candidate_status("Pendente"), CANDIDATE_STATUS_PENDING_CONFIRMATION)
        self.assertEqual(_map_rh_decision_to_candidate_status("Reavaliar"), CANDIDATE_STATUS_ANALYSIS)
        self.assertEqual(_map_rh_decision_to_candidate_status("Banco de talentos"), CANDIDATE_STATUS_TALENT_BANK)
        self.assertEqual(_map_rh_decision_to_candidate_status("Status novo solto"), "")

    def test_score_uses_weights_and_blocks_missing_required_stage(self):
        score = calcular_score_conecta(
            candidato={"score_curriculo": 82},
            prova={
                "vaga": "Estagiário",
                "trilha": "RH",
                "nivel": "2",
                "etapas": [{"key": "professional_essay", "label": "Redação"}],
                "resultado": {
                    "nota_objetiva": 88,
                    "nota_redacao": None,
                    "score_por_categoria": {"Português": 88},
                },
            },
            processo={},
            configuracao={"redacao_obrigatoria": True},
        )

        self.assertEqual(score["classificacao"], "Pendente de avaliação")
        self.assertIn("Redação corrigida", score["dados_ausentes"])
        self.assertEqual(score["confiabilidade"], "Incompleta")

    def test_score_applies_technical_lock(self):
        score = calcular_score_conecta(
            candidato={"score_curriculo": 90},
            prova={
                "vaga": "Suporte Técnico Pleno",
                "trilha": "TI",
                "nivel": "3",
                "resultado": {
                    "nota_objetiva": 92,
                    "nota_tecnica": 42,
                    "nota_entrevista": 90,
                    "score_por_categoria": {"Conhecimento técnico": 42},
                },
            },
            processo={},
            configuracao={},
        )

        self.assertNotEqual(score["classificacao"], "Forte indicação")
        self.assertIn(
            "Desempenho técnico abaixo do mínimo recomendado para a vaga.",
            score["alertas_criticos"],
        )

    def test_generated_exam_router_forwards_create_payload(self):
        repository = FakeGeneratedExamRepository()
        payload = GeneratedExamCreateRequest(
            nome_candidato="Ana Souza",
            email="ana@example.com",
            telefone="21999999999",
            vaga="Analista",
            area_prova="ADM / Gestão",
            operacao="CRF",
            trilha="adm",
            nivel="4",
            tempo_total=40,
            questoes_snapshot=[
                {
                    "type": "multiple",
                    "title": "Q1",
                    "description": "Pergunta",
                    "options": ["A", "B"],
                    "answer": 0,
                    "points": 10,
                }
            ],
        )

        user = type("User", (), {"nome": "RH Local", "usuario": "rh", "email": "", "has_permission": lambda *_: True})()
        request = type("Request", (), {"client": None, "headers": {}, "method": "POST", "url": type("Url", (), {"path": "/generated-exams"})()})()
        result = create_generated_exam(payload, request=request, user=user, repository=repository)

        self.assertTrue(result["success"])
        self.assertRegex(result["codigo_acesso"], r"^[A-Z]{2}\d{2}$")
        self.assertEqual(repository.created_payloads[0]["nome_candidato"], "Ana Souza")
        self.assertEqual(repository.generated_by, "RH Local")

    def test_public_required_answer_validation_handles_rich_text_and_excel(self):
        self.assertFalse(
            _is_public_answer_complete(
                {"type": "word"},
                {"type": "word", "content": "<p><br></p>", "text": ""},
            )
        )
        self.assertTrue(
            _is_public_answer_complete(
                {"type": "word"},
                {"type": "word", "content": "<p>Resposta organizada.</p>"},
            )
        )
        self.assertFalse(
            _is_public_answer_complete(
                {"type": "excel_external"},
                {"type": "excel_external", "filename": "", "contentBase64": "abc"},
            )
        )
        self.assertTrue(
            _is_public_answer_complete(
                {"type": "excel_external"},
                {
                    "type": "excel_external",
                    "filename": "ana.xlsx",
                    "contentBase64": "abc",
                },
            )
        )

    def test_public_question_payload_never_exposes_internal_analysis_data(self):
        public_question = _public_question_payload(
            {
                "type": "word",
                "title": "Questão discursiva",
                "description": "Explique a rotina e aplique alinhamento justificado.",
                "rubricaInterna": "Aceitar também a resposta equivalente X.",
                "oQueDeveSerAvaliado": "Clareza, conteúdo e alinhamento justificado.",
                "gabaritoInterno": "Resposta X",
                "respostaEsperadaInterna": "Resposta X",
                "criteriosAvaliacao": ["Clareza", "Alinhamento"],
                "expected": {
                    "requiredAlignment": "justify",
                    "rubric": ["Não revelar"],
                },
                "gabarito": {"tipo": "rubrica", "criterios": ["Não revelar"]},
            }
        )

        self.assertEqual(
            public_question["description"],
            "Explique a rotina e aplique alinhamento justificado.",
        )
        for internal_field in (
            "rubricaInterna",
            "oQueDeveSerAvaliado",
            "gabaritoInterno",
            "respostaEsperadaInterna",
            "criteriosAvaliacao",
            "expected",
            "gabarito",
        ):
            self.assertNotIn(internal_field, public_question)

    def test_interrupted_stage_is_zeroed_in_grade_summary(self):
        repository = GeneratedExamRepositoryMixin()
        grade = repository._grade_answers(
            [
                {
                    "type": "multiple",
                    "stageKey": "general_basic",
                    "stage": "Conhecimentos Gerais",
                    "options": ["A", "B"],
                    "answer": 0,
                    "points": 10,
                }
            ],
            [{"selected": 0}],
            [{"key": "general_basic", "label": "Conhecimentos Gerais", "weight": 100}],
            {
                "estado_etapas_publicas": {
                    "conhecimentos_gerais": {
                        "status": "interrompida",
                        "invalidada": True,
                        "nota_zerada": True,
                    }
                }
            },
        )

        self.assertEqual(grade["nota_objetiva"], 0)
        self.assertEqual(grade["nota_final_prova"], 0)
        self.assertEqual(grade["resumo_etapas"][0]["rawScore"], 0)
        self.assertTrue(grade["resumo_etapas"][0]["interrupted"])
        self.assertEqual(grade["resumo_etapas"][0]["status"], "Etapa interrompida - nota zerada")

    def test_question_shuffle_is_deterministic_per_candidate_and_varies_between_candidates(self):
        questions = [
            {"type": "multiple", "title": "Q1", "options": ["A", "B", "C", "D"], "answer": 2, "points": 10},
            {"type": "multiple", "title": "Q2", "options": ["A", "B", "C"], "answer": 0, "points": 10},
            {"type": "word", "title": "Q3", "description": "Discursiva"},
        ]
        row_candidate_1 = {"id_prova": 7, "id_teste": "CP-0001"}
        row_candidate_2 = {"id_prova": 7, "id_teste": "CP-0002"}

        shuffled_first_load = GeneratedExamRepositoryMixin._apply_question_shuffle(questions, row_candidate_1)
        shuffled_second_load = GeneratedExamRepositoryMixin._apply_question_shuffle(questions, row_candidate_1)
        shuffled_other_candidate = GeneratedExamRepositoryMixin._apply_question_shuffle(questions, row_candidate_2)

        # Mesmo candidato/prova: recarregar a página produz sempre a mesma ordem.
        self.assertEqual(
            [q["title"] for q in shuffled_first_load],
            [q["title"] for q in shuffled_second_load],
        )
        # O snapshot original (entrada da função) nunca é mutado.
        self.assertEqual([q["title"] for q in questions], ["Q1", "Q2", "Q3"])
        self.assertEqual(questions[0]["answer"], 2)
        self.assertEqual(questions[0]["options"], ["A", "B", "C", "D"])
        # Candidato diferente pode (e nesse caso, deve) ver uma ordem diferente.
        self.assertNotEqual(
            [q["title"] for q in shuffled_first_load],
            [q["title"] for q in shuffled_other_candidate],
        )

    def test_question_shuffle_keeps_correct_answer_grading_after_reorder(self):
        row = {"id_prova": 42, "id_teste": "CP-9999"}
        questions = [
            {
                "type": "multiple",
                "title": f"Q{i}",
                "stageKey": "geral",
                "stage": "Geral",
                "options": [f"opcao-{i}-{letra}" for letra in "ABCD"],
                "answer": i % 4,
                "points": 10,
            }
            for i in range(6)
        ]

        shuffled = GeneratedExamRepositoryMixin._apply_question_shuffle(questions, row)

        # A alternativa correta pós-embaralhamento deve continuar sendo o texto
        # originalmente marcado como correto, apenas em outra posição.
        original_by_title = {q["title"]: q for q in questions}
        for question in shuffled:
            original = original_by_title[question["title"]]
            original_correct_text = original["options"][original["answer"]]
            new_correct_text = question["options"][question["answer"]]
            self.assertEqual(original_correct_text, new_correct_text)
            self.assertEqual(set(question["options"]), set(original["options"]))

        # Simula o candidato respondendo corretamente todas as questões na ordem
        # embaralhada (como o front-end faria) e confirma que a correção usando a
        # lista já embaralhada pontua 100%, sem precisar remapear nada externamente.
        repository = GeneratedExamRepositoryMixin()
        answers = [{"selected": question["answer"]} for question in shuffled]
        grade = repository._grade_answers(shuffled, answers, [{"key": "geral", "weight": 100}], {})
        self.assertEqual(grade["nota_objetiva"], 100)
        self.assertTrue(all(item["correct"] for item in grade["graded"]))

    def test_generated_exam_router_forwards_update_and_delete(self):
        repository = FakeGeneratedExamRepository()
        payload = GeneratedExamCreateRequest(
            nome_candidato="Ana Souza",
            email="ana@example.com",
            telefone="21999999999",
            vaga="Analista",
            area_prova="ADM / Gestão",
            nivel="4",
            questoes_snapshot=[{"type": "multiple", "title": "Q1", "options": ["A", "B"], "answer": 0}],
        )
        user = type("User", (), {"nome": "RH Local", "usuario": "rh", "email": "", "has_permission": lambda *_: True})()
        request = type("Request", (), {"client": None, "headers": {}, "method": "PUT", "url": type("Url", (), {"path": "/generated-exams/7"})()})()

        updated = update_generated_exam(7, payload, request=request, user=user, repository=repository)
        deleted = delete_generated_exam(7, request=request, user=user, repository=repository)

        self.assertTrue(updated["success"])
        self.assertEqual(repository.updated_payloads[0]["updated_by"], "RH Local")
        self.assertTrue(deleted["success"])
        self.assertEqual(repository.deleted_ids, [7])

    def test_public_access_and_finalize_do_not_require_rh_user(self):
        repository = FakeGeneratedExamRepository()

        access = public_access_email(
            PublicExamAccessRequest(email="ana@example.com"),
            repository=repository,
        )
        code_access = public_access_code(
            PublicExamAccessRequest(codigo="AB12"),
            repository=repository,
        )
        finalized = public_finalize_exam(
            PublicExamAnswersRequest(
                token="token-publico",
                respostas=[{"selected": 0}],
                finalizar_mesmo_assim=True,
            ),
            repository=repository,
        )

        self.assertTrue(access["success"])
        self.assertTrue(code_access["success"])
        self.assertEqual(finalized["status"], "Finalizada")
        self.assertEqual(repository.finalized_payloads[0]["token"], "token-publico")
        self.assertTrue(repository.finalized_payloads[0]["finalizar_mesmo_assim"])


if __name__ == "__main__":
    unittest.main()

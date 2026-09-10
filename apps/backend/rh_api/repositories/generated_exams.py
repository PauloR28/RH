from __future__ import annotations

import json
import random
import re
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from conecta.infrastructure.security.html_sanitizer import sanitize_rich_text_html

from ..services.cv import is_valid_email, is_valid_phone
from ..services.helpers import normalize_compare_text, normalize_text, rows_to_dicts, safe_json_loads
from ..services.pipeline import infer_pipeline_stage
from ..services.process_flow import (
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ATTENDED,
    CANDIDATE_STATUS_CANCELED,
    CANDIDATE_STATUS_CONFIRMED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_MISSED,
    CANDIDATE_STATUS_NO_RESPONSE,
    CANDIDATE_STATUS_NOT_QUALIFIED,
    CANDIDATE_STATUS_PENDING_CONFIRMATION,
    CANDIDATE_STATUS_QUALIFIED,
    CANDIDATE_STATUS_RESCHEDULED,
    CANDIDATE_STATUS_SCHEDULED,
    CANDIDATE_STATUS_TALENT_BANK,
    CANDIDATE_STATUS_WITHDREW,
    canonicalize_candidate_status,
)
from ..services.score_conecta import calcular_score_conecta
from .bootstrap import (
    ensure_candidate_metadata_columns,
    ensure_candidate_metadata_table,
    ensure_conecta_exams_tables,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    get_process_row,
)
from .exam_analytics_schema import ensure_exam_analytics_tables


EXAM_STATUS_GENERATED = "Gerada"
EXAM_STATUS_AVAILABLE = "Disponível"
EXAM_STATUS_WAITING = "Aguardando candidato"
EXAM_STATUS_IN_PROGRESS = "Em andamento"
EXAM_STATUS_REVIEW = "Em revisão"
EXAM_STATUS_FINISHED = "Finalizada"
EXAM_STATUS_CORRECTED = "Corrigida"
EXAM_STATUS_PENDING_MANUAL = "Pendente de avaliação manual"
EXAM_STATUS_REOPENED = "Reaberta"
EXAM_STATUS_CANCELLED = "Cancelada"
EXAM_STATUS_EXPIRED = "Expirada"

KNOWN_CANDIDATE_STATUSES = {
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_QUALIFIED,
    CANDIDATE_STATUS_NOT_QUALIFIED,
    CANDIDATE_STATUS_PENDING_CONFIRMATION,
    CANDIDATE_STATUS_SCHEDULED,
    CANDIDATE_STATUS_CONFIRMED,
    CANDIDATE_STATUS_RESCHEDULED,
    CANDIDATE_STATUS_NO_RESPONSE,
    CANDIDATE_STATUS_CANCELED,
    CANDIDATE_STATUS_ATTENDED,
    CANDIDATE_STATUS_MISSED,
    CANDIDATE_STATUS_WITHDREW,
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_TALENT_BANK,
}

PUBLIC_ACCESS_ALLOWED_STATUSES = {
    EXAM_STATUS_GENERATED,
    EXAM_STATUS_AVAILABLE,
    EXAM_STATUS_WAITING,
    EXAM_STATUS_IN_PROGRESS,
    EXAM_STATUS_REVIEW,
    EXAM_STATUS_REOPENED,
}

GENERIC_ACCESS_MESSAGE = "Não encontramos uma prova disponível com os dados informados."

EXAM_ROW_COLUMNS = """
    id_prova,
    id_teste,
    id_registro,
    id_entrevista,
    id_processo,
    id_processo_ref,
    nome_candidato,
    email_acesso,
    telefone_acesso,
    cpf,
    vaga,
    operacao,
    trilha,
    nivel,
    tempo_total,
    quantidade_questoes,
    etapas_json,
    categorias_json,
    competencias_json,
    configuracao_json,
    questoes_json,
    instrucoes_operacao,
    status,
    codigo_acesso,
    token_sessao_publica,
    token_expira_em,
    metodo_acesso,
    login_method,
    tentativas_acesso,
    gerada_por,
    gerada_em,
    iniciada_em,
    revisada_em,
    finalizada_em,
    expira_em,
    reaberta_em,
    reaberta_por,
    motivo_reabertura,
    respostas_anteriores_mantidas,
    cancelada_em,
    cancelada_por,
    motivo_cancelamento,
    dados_confirmados_em,
    atualizado_em
"""


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _normalize_email(value: Any) -> str:
    return normalize_text(value).lower()


def _normalize_phone(value: Any) -> str:
    digits = re.sub(r"\D", "", normalize_text(value))
    if digits.startswith("55") and len(digits) in (12, 13):
        return digits[2:]
    return digits


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = normalize_text(value)
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except ValueError:
        return None


def _format_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return normalize_text(value)


def _score_to_old_history_scale(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    if number > 10:
        number /= 10
    return f"{number:.1f}".replace(".", ",")


def _strip_html(value: Any) -> str:
    return re.sub(r"<[^>]+>", " ", normalize_text(value)).strip()


def _map_rh_decision_to_candidate_status(decision: Any) -> str:
    safe_decision = normalize_compare_text(decision)
    if not safe_decision:
        return ""
    if safe_decision in {"aprovado", "aprovado com ressalvas"}:
        return CANDIDATE_STATUS_APPROVED
    if safe_decision in {"reprovado", "eliminado"} or "eliminado" in safe_decision:
        return CANDIDATE_STATUS_ELIMINATED
    if safe_decision in {"pendente", "pendente de confirmacao", "pendente confirmacao"}:
        return CANDIDATE_STATUS_PENDING_CONFIRMATION
    if safe_decision in {"reavaliar", "reavaliacao"}:
        return CANDIDATE_STATUS_ANALYSIS

    candidate_status = canonicalize_candidate_status(decision)
    return candidate_status if candidate_status in KNOWN_CANDIDATE_STATUSES else ""


ESSAY_MAX_LINES = 20
ESSAY_MAX_CHARACTERS = 2200
ESSAY_ORIENTATION = (
    "Seu texto deve ter introdução, desenvolvimento e conclusão. "
    f"Escreva uma redação de até {ESSAY_MAX_LINES} linhas."
)
ESSAY_CRITERIA = [
    "Clareza",
    "Coerência",
    "Coesão",
    "Ortografia",
    "Organização das ideias",
    "Adequação ao tema",
    "Argumentação",
    f"Cumprimento do limite de até {ESSAY_MAX_LINES} linhas",
]
PROMPT_INTERNAL_PHRASES = [
    "Imagine uma situação",
    "Use linguagem humanizada",
    "A resposta deve mostrar",
    "Avalie organização",
    "sem cobrar experiência prévia",
    "Use atendimento, rotina operacional",
    "O cenário pode usar como referência",
    "A personalização deve",
    "Considere o cliente",
    "Considere a operação",
    "com foco em empatia",
    "capacidade de aprender",
    "use linguagem simples e situações de primeiro emprego",
    "Use como eixo da questão",
    "Use tom",
    "A demanda deve considerar conhecimentos",
]
INTERNAL_QUESTION_FIELDS = {
    "contextoInternoGeracao",
    "contexto_interno_geracao",
    "criteriosAvaliacao",
    "criterios_avaliacao",
    "respostaEsperadaInterna",
    "resposta_esperada_interna",
    "rubricaInterna",
    "rubrica_interna",
    "oQueDeveSerAvaliado",
    "o_que_deve_ser_avaliado",
    "gabaritoInterno",
    "gabarito_interno",
    "personalizacaoInteligente",
    "prompt",
    "promptInterno",
    "prompt_interno",
    "personalizationPrompt",
    "generationContext",
    "generation_context",
}


def _text_has_internal_prompt(value: Any) -> bool:
    base = normalize_compare_text(value)
    return bool(base) and any(normalize_compare_text(phrase) in base for phrase in PROMPT_INTERNAL_PHRASES)


def _clean_candidate_text(value: Any) -> str:
    text = normalize_text(value)
    text = re.sub(r"^\s*Texto-(base|motivador)\s*\d+\s*:\s*", "", text, flags=re.I)
    text = re.sub(r"^\s*Texto\s+motivador\s*\d+\s*:\s*", "", text, flags=re.I)
    text = re.sub(r"^\s*Contexto\s*:\s*", "", text, flags=re.I)
    text = re.sub(r"\b(central de agendamento)\s+\1\b", r"\1", text, flags=re.I)
    text = re.sub(r"\s+([,.?!;:])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    if not text or _text_has_internal_prompt(text):
        return ""
    return text


def _is_essay_question(question: dict[str, Any]) -> bool:
    return normalize_text(question.get("stageKey")) == "professional_essay" or bool(
        question.get("essay") or (isinstance(question.get("expected"), dict) and question["expected"].get("essay"))
    )


def _safe_essay_max_characters(value: Any) -> int:
    try:
        amount = int(value or 0)
    except (TypeError, ValueError):
        amount = 0
    return amount if amount >= 1800 else ESSAY_MAX_CHARACTERS


def _essay_support_texts(question: dict[str, Any]) -> list[str]:
    essay = question.get("essay") if isinstance(question.get("essay"), dict) else {}
    source = essay.get("supportTexts") or essay.get("motivatingTexts") or []
    texts = [_clean_candidate_text(item) for item in source if _clean_candidate_text(item)]
    if len(texts) >= 2:
        return texts[:2]
    return [
        "O início da vida profissional costuma ser marcado por descobertas, dúvidas e aprendizados. Para muitos jovens, esse período representa o primeiro contato com regras, horários, responsabilidades e formas de comunicação próprias do ambiente de trabalho. Atitudes simples, como ouvir com atenção, anotar orientações, confirmar informações e cumprir combinados, ajudam a construir confiança e demonstram disposição para aprender. Elas também tornam a rotina mais segura para a pessoa e para a equipe.",
        "Em uma situação cotidiana, uma pessoa recebeu uma lista curta de tarefas e percebeu que uma orientação estava incompleta. Antes de seguir adiante, ela decidiu conferir a informação com a pessoa responsável, evitando retrabalho e reduzindo o risco de repassar dados incorretos. Essa postura mostra que responsabilidade não depende apenas de experiência, mas também de cuidado, comunicação respeitosa e organização. Mesmo uma atividade simples pode exigir atenção aos detalhes.",
    ]


def _essay_criteria(criteria: Any) -> list[str]:
    visible = []
    if isinstance(criteria, list):
        visible = [
            normalize_text(item)
            for item in criteria
            if normalize_text(item) and "caracteres" not in normalize_compare_text(item)
        ]
    return list(dict.fromkeys([*visible, *ESSAY_CRITERIA]))


def _fallback_candidate_fields(question: dict[str, Any]) -> tuple[str, str]:
    title = normalize_compare_text(question.get("title") or question.get("titulo"))
    base = normalize_compare_text(
        " ".join(
            str(question.get(key) or "")
            for key in (
                "stage",
                "category",
                "categoria",
                "description",
                "enunciadoCandidato",
                "instrucaoCandidato",
            )
        )
    )
    if ("email" in title or "e mail" in title) and (
        "davita" in base or "paciente" in base or "agendamento" in base or "consulta" in base
    ):
        return (
            "Você trabalha em uma central de agendamento. Um paciente informou que está com dúvida sobre o horário e a unidade da consulta. A equipe precisa registrar a situação com atenção para evitar informações incorretas.",
            "Escreva um registro curto de atendimento explicando o ocorrido e indicando que os dados da consulta devem ser conferidos antes do atendimento.",
        )
    if "comunicado" in title:
        return (
            "A equipe recebeu uma orientação simples que precisa ser comunicada de forma clara para manter a rotina organizada e evitar dúvidas.",
            "Escreva um comunicado curto, com título adequado, explicando a orientação principal de maneira objetiva e profissional.",
        )
    if "lista" in title or "procedimento" in title:
        return (
            "Antes de iniciar uma atividade de atendimento, a equipe precisa organizar informações, conferir ferramentas e seguir passos básicos.",
            "Crie uma lista com pelo menos três procedimentos simples que ajudem a preparar a rotina antes do atendimento.",
        )
    if normalize_text(question.get("type")) == "multiple":
        return (
            "Uma orientação de trabalho chegou com informação incompleta e pode gerar erro se for seguida sem conferência.",
            "Marque a alternativa que melhor demonstra cuidado, responsabilidade e comunicação clara.",
        )
    return (
        "Durante uma rotina de trabalho, uma pessoa precisa registrar uma informação simples para que a equipe consiga dar continuidade sem dúvida.",
        "Responda explicando o que deve ser comunicado e qual próximo passo precisa ser acompanhado.",
    )


def _sanitize_question_for_storage(question: dict[str, Any]) -> dict[str, Any]:
    item = dict(question or {})
    item["titulo"] = normalize_text(item.get("titulo") or item.get("title"))
    item["tipo"] = normalize_text(item.get("tipo") or item.get("type"))
    item["categoria"] = normalize_text(item.get("categoria") or item.get("stage") or item.get("stageKey"))

    if _is_essay_question(item):
        essay = dict(item.get("essay") or {})
        proposal = _clean_candidate_text(essay.get("proposal") or item.get("enunciadoCandidato") or item.get("description"))
        if not proposal:
            proposal = "Com base nos textos-base e em seus conhecimentos, escreva um texto explicando a importância de agir com organização, clareza e responsabilidade em situações profissionais."
        support_texts = _essay_support_texts(item)
        essay["supportTexts"] = support_texts
        essay["motivatingTexts"] = support_texts
        essay["proposal"] = proposal
        essay["orientation"] = ESSAY_ORIENTATION
        essay["maxLines"] = ESSAY_MAX_LINES
        essay["maxCharacters"] = _safe_essay_max_characters(essay.get("maxCharacters"))
        essay["criteria"] = _essay_criteria(essay.get("criteria"))
        item["essay"] = essay
        expected = dict(item.get("expected") or {})
        expected["essay"] = True
        expected["maxLines"] = ESSAY_MAX_LINES
        expected["maxCharacters"] = essay["maxCharacters"]
        expected["criteria"] = essay["criteria"]
        item["expected"] = expected
        item["enunciadoCandidato"] = proposal
        item["instrucaoCandidato"] = ESSAY_ORIENTATION
        item["criteriosAvaliacao"] = essay["criteria"]
        item["description"] = f"{proposal}\n\n{ESSAY_ORIENTATION}".strip()
        return item

    enunciado = _clean_candidate_text(item.get("enunciadoCandidato") or item.get("description"))
    instrucao = _clean_candidate_text(item.get("instrucaoCandidato"))
    if not enunciado or _text_has_internal_prompt(item.get("description")):
        enunciado, instrucao = _fallback_candidate_fields(item)
    item["enunciadoCandidato"] = enunciado
    item["instrucaoCandidato"] = instrucao
    item["description"] = "\n\n".join(part for part in (enunciado, instrucao) if part).strip()
    item.setdefault("contextoInternoGeracao", "")
    item.setdefault("criteriosAvaliacao", [])
    item.setdefault("respostaEsperadaInterna", item.get("answer", item.get("correctIndex", "")))
    return item


def _sanitize_questions_for_storage(questions: Any) -> list[dict[str, Any]]:
    if not isinstance(questions, list):
        return []
    return [
        _sanitize_question_for_storage(question)
        for question in questions
        if isinstance(question, dict)
    ]


def _public_question_payload(question: dict[str, Any]) -> dict[str, Any]:
    item = _sanitize_question_for_storage(question)
    for key in INTERNAL_QUESTION_FIELDS:
        item.pop(key, None)
    item.pop("gabarito", None)
    item.pop("expected", None)
    for collection_key in ("items", "itens"):
        if isinstance(item.get(collection_key), list):
            sanitized_items = []
            for raw_item in item[collection_key]:
                if not isinstance(raw_item, dict):
                    sanitized_items.append(raw_item)
                    continue
                visible_item = dict(raw_item)
                visible_item.pop("answer", None)
                visible_item.pop("gabarito", None)
                sanitized_items.append(visible_item)
            item[collection_key] = sanitized_items
    if isinstance(item.get("essay"), dict):
        essay = dict(item["essay"])
        essay.pop("criteria", None)
        item["essay"] = essay
    if not _is_essay_question(item):
        item.pop("criteriosAvaliacao", None)
    item.pop("answer", None)
    item.pop("correctIndex", None)
    return item


def _public_questions_payload(questions: Any) -> list[dict[str, Any]]:
    return [
        _public_question_payload(question)
        for question in questions
        if isinstance(question, dict)
    ] if isinstance(questions, list) else []


def _safe_exam_minutes(value: Any, fallback: int = 40) -> int:
    try:
        minutes = int(value or 0)
    except (TypeError, ValueError):
        minutes = 0
    if minutes < 1:
        return fallback
    return min(minutes, 300)


def _is_public_answer_complete(question: dict, answer: Any) -> bool:
    if question.get("required") is False:
        return True

    question_type = normalize_text(question.get("type"))
    if answer in (None, ""):
        return False

    if question_type == "multiple":
        if isinstance(answer, dict):
            return answer.get("selected") not in (None, "")
        return answer not in (None, "")

    if question_type == "compact_choice_group":
        if not isinstance(answer, dict):
            return False
        selections = answer.get("selections")
        if not isinstance(selections, dict):
            return False
        items = question.get("items") if isinstance(question.get("items"), list) else question.get("itens")
        required_items = items if isinstance(items, list) else []
        return bool(required_items) and all(
            selections.get(str(item.get("id") or "")) not in (None, "")
            for item in required_items
            if isinstance(item, dict)
        )

    if question_type == "excel_external":
        if not isinstance(answer, dict):
            return False
        return bool(
            normalize_text(answer.get("filename"))
            and (answer.get("validation") or normalize_text(answer.get("contentBase64")))
        )

    if question_type == "word":
        if not isinstance(answer, dict):
            return bool(_strip_html(answer))
        return bool(_strip_html(answer.get("content") or answer.get("text")))

    if isinstance(answer, dict):
        return any(value not in (None, "", []) for value in answer.values())
    return True


class GeneratedExamRepositoryMixin:
    @staticmethod
    def _is_public_exam_available(row: dict) -> bool:
        status_value = normalize_text(row.get("status"))
        if status_value not in PUBLIC_ACCESS_ALLOWED_STATUSES:
            return False
        expires_at = _parse_datetime(row.get("expira_em"))
        return not (expires_at and expires_at < datetime.now())

    @staticmethod
    def _public_exam_summary(row: dict, *, token: str) -> dict:
        return {
            "token": token,
            "vaga": normalize_text(row.get("vaga")),
            "operacao": normalize_text(row.get("operacao")),
            "trilha": normalize_text(row.get("trilha")),
            "nivel": normalize_text(row.get("nivel")),
            "status": normalize_text(row.get("status")),
            "gerada_em": _format_datetime(row.get("gerada_em")),
            "tempo_total": _safe_exam_minutes(row.get("tempo_total")),
        }

    @staticmethod
    def _public_stage_key_for_question(question: dict, index: int = 0) -> str:
        q_type = normalize_text(question.get("type"))
        stage_key_raw = normalize_compare_text(question.get("stageKey") or question.get("stage") or "")
        label = normalize_compare_text(
            question.get("stageKey")
            or question.get("stage")
            or question.get("category")
            or question.get("title")
            or ""
        )
        expected = question.get("expected") if isinstance(question.get("expected"), dict) else {}
        # Redação usa a mesma fábrica de pergunta "word" (texto livre) das demais
        # etapas discursivas — o único jeito de identificá-la de verdade é pelo
        # stageKey/flag de essay, nunca pelo "type" bruto. Precisa ser checado
        # ANTES do branch "word" abaixo, senão toda redação cai em "word" e o
        # candidato recebe "Etapa não encontrada" ao concluir (espelha
        # etapaEhRedacao() em conecta-provas/index.js).
        has_essay_flag = bool(expected.get("essay") or question.get("essay"))
        if stage_key_raw == "professional_essay" or has_essay_flag or q_type in {"essay", "redacao"} or "redacao" in label:
            return "redacao"
        # Personalidade/espontaneidade também usam a fábrica "word" e precisam de
        # etapa própria — sem isso, caem no branch "word" logo abaixo e se
        # misturam à prova de Word (Correções.txt item 7).
        if any(term in stage_key_raw for term in ("personalidade", "espontane")) or any(
            term in label for term in ("personalidade", "espontane")
        ):
            return "personalidade"
        if q_type == "excel_external" or "excel" in label:
            return "excel"
        if q_type == "word" or "word" in label:
            return "word"
        if any(term in label for term in ("tech", "tecnico")):
            return "conhecimentos_tecnicos"
        if any(term in label for term in ("general", "geral")):
            return "conhecimentos_gerais"
        if "conhecimento" in label:
            return "conhecimentos"
        raw_key = stage_key_raw
        return re.sub(r"[^a-z0-9]+", "-", raw_key).strip("-") or f"etapa-{index + 1}"

    @staticmethod
    def _public_stage_indices(questions: list[dict], stage_key: str) -> list[int]:
        normalized_key = normalize_compare_text(stage_key)
        return [
            index
            for index, question in enumerate(questions)
            if GeneratedExamRepositoryMixin._public_stage_key_for_question(question, index) == normalized_key
        ]

    @staticmethod
    def _exam_shuffle_seed(row: dict) -> str:
        # Determinístico por prova + candidato: mesma pessoa recarregando a página
        # vê sempre a mesma ordem; candidatos diferentes veem ordens diferentes.
        id_prova = row.get("id_prova")
        identificador_candidato = (
            row.get("id_teste") or row.get("token_sessao_publica") or row.get("email_acesso") or ""
        )
        return f"{id_prova}:{identificador_candidato}"

    @staticmethod
    def _shuffled_order(length: int, seed: str) -> list[int]:
        order = list(range(length))
        random.Random(seed).shuffle(order)
        return order

    @staticmethod
    def _apply_question_shuffle(questions: list[dict], row: dict) -> list[dict]:
        """Reordena questões e (para múltipla escolha) alternativas apenas para
        apresentação/leitura pelo candidato. NUNCA altera o que está persistido em
        questoes_json (o snapshot original permanece intacto no banco). O índice da
        alternativa correta ("answer"/"correctIndex") é remapeado junto com as
        alternativas embaralhadas, então a correção continua funcionando: basta usar
        a lista retornada por esta função (em vez da lista crua do banco) tanto para
        montar o payload público quanto para validar/pontuar a resposta do candidato.
        """
        if not isinstance(questions, list) or not questions:
            return questions
        seed = GeneratedExamRepositoryMixin._exam_shuffle_seed(row)
        order = GeneratedExamRepositoryMixin._shuffled_order(len(questions), f"{seed}:questoes")
        shuffled: list[dict] = []
        for new_index, original_index in enumerate(order):
            question = dict(questions[original_index])
            if normalize_text(question.get("type")) == "multiple" and isinstance(question.get("options"), list) and question["options"]:
                original_options = question["options"]
                opt_order = GeneratedExamRepositoryMixin._shuffled_order(
                    len(original_options), f"{seed}:opcoes:{original_index}"
                )
                question["options"] = [original_options[i] for i in opt_order]
                expected = question.get("answer", question.get("correctIndex"))
                try:
                    expected_int = int(expected)
                except (TypeError, ValueError):
                    expected_int = None
                if expected_int is not None and 0 <= expected_int < len(opt_order):
                    new_expected = opt_order.index(expected_int)
                    if "answer" in question:
                        question["answer"] = new_expected
                    if "correctIndex" in question:
                        question["correctIndex"] = new_expected
            shuffled.append(question)
        return shuffled

    @staticmethod
    def _internal_stage_states(config: dict | None) -> dict:
        states = (config or {}).get("estado_etapas_publicas")
        return states if isinstance(states, dict) else {}

    @staticmethod
    def _sanitize_public_config(config: dict | None) -> dict:
        public_config = dict(config or {})
        states = GeneratedExamRepositoryMixin._internal_stage_states(public_config)
        public_states: dict[str, dict[str, Any]] = {}
        for key, state in states.items():
            if not isinstance(state, dict):
                continue
            status_value = normalize_compare_text(state.get("status"))
            if status_value == "interrompida":
                public_states[str(key)] = {"status": "realizada", "indisponivel": True}
            elif status_value == "concluida":
                public_states[str(key)] = {"status": "concluida"}
        public_config.pop("estado_etapas_publicas", None)
        if public_states:
            public_config["estado_etapas_candidato"] = public_states
        return public_config

    @staticmethod
    def _set_stage_state(config: dict | None, stage_key: str, state: dict) -> dict:
        next_config = dict(config or {})
        states = dict(GeneratedExamRepositoryMixin._internal_stage_states(next_config))
        previous = states.get(stage_key) if isinstance(states.get(stage_key), dict) else {}
        states[stage_key] = {**previous, **state}
        next_config["estado_etapas_publicas"] = states
        return next_config

    @staticmethod
    def _exam_public_payload(row: dict) -> dict:
        config = safe_json_loads(row.get("configuracao_json"), {})
        return {
            "token": normalize_text(row.get("token_sessao_publica")),
            "status": normalize_text(row.get("status")),
            "candidato": {
                "nome_candidato": normalize_text(row.get("nome_candidato")),
                "email": normalize_text(row.get("email_acesso")),
                "telefone": normalize_text(row.get("telefone_acesso")),
                "whatsapp": normalize_text(row.get("telefone_acesso")),
                "dados_confirmados": bool(row.get("dados_confirmados_em")),
            },
            "prova": {
                "vaga": normalize_text(row.get("vaga")),
                "operacao": normalize_text(row.get("operacao")),
                "trilha": normalize_text(row.get("trilha")),
                "nivel": normalize_text(row.get("nivel")),
                "tempo_total": _safe_exam_minutes(row.get("tempo_total")),
                "quantidade_questoes": int(row.get("quantidade_questoes") or 0),
                "etapas": safe_json_loads(row.get("etapas_json"), []),
                "categorias": safe_json_loads(row.get("categorias_json"), []),
                "competencias": safe_json_loads(row.get("competencias_json"), []),
                "questoes": _public_questions_payload(
                    GeneratedExamRepositoryMixin._apply_question_shuffle(
                        safe_json_loads(row.get("questoes_json"), []), row
                    )
                ),
                "configuracao": GeneratedExamRepositoryMixin._sanitize_public_config(config),
                "instrucoes_operacao": normalize_text(row.get("instrucoes_operacao")),
                "iniciada_em": _format_datetime(row.get("iniciada_em")),
                "finalizada": normalize_text(row.get("status")) in {
                    EXAM_STATUS_FINISHED,
                    EXAM_STATUS_CORRECTED,
                    EXAM_STATUS_PENDING_MANUAL,
                },
            },
        }

    @staticmethod
    def _exam_detail_payload(row: dict) -> dict:
        detail = dict(row)
        detail["etapas"] = safe_json_loads(row.get("etapas_json"), [])
        detail["categorias"] = safe_json_loads(row.get("categorias_json"), [])
        detail["competencias"] = safe_json_loads(row.get("competencias_json"), [])
        detail["configuracao"] = safe_json_loads(row.get("configuracao_json"), {})
        detail["questoes"] = safe_json_loads(row.get("questoes_json"), [])
        detail["score"] = safe_json_loads(row.get("score_payload_json"), {})
        detail["resultado"] = safe_json_loads(row.get("resultado_payload_json"), {})
        detail["decisao_rh"] = safe_json_loads(row.get("decisao_rh_payload_json"), {})
        detail.pop("etapas_json", None)
        detail.pop("categorias_json", None)
        detail.pop("competencias_json", None)
        detail.pop("configuracao_json", None)
        detail.pop("questoes_json", None)
        detail.pop("score_payload_json", None)
        detail.pop("resultado_payload_json", None)
        detail.pop("decisao_rh_payload_json", None)
        return detail

    def _generate_candidate_id(self, cursor) -> str:
        while True:
            candidate_id = f"CP-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"
            cursor.execute(
                """
                SELECT COUNT(*) FROM candidatos_metadata WHERE id_teste = ?
                """,
                (candidate_id,),
            )
            if int(cursor.fetchone()[0] or 0) == 0:
                return candidate_id

    def _find_candidate_id(self, cursor, data: dict) -> str:
        explicit_id = normalize_text(data.get("id_teste") or data.get("candidato_id"))
        if explicit_id:
            return explicit_id

        id_registro = int(data.get("id_registro") or 0)
        if id_registro:
            cursor.execute(
                """
                SELECT TOP 1 id_teste
                FROM candidatos_processos
                WHERE id_registro = ? AND ISNULL(id_teste, '') <> ''
                """,
                (id_registro,),
            )
            row = cursor.fetchone()
            if row and normalize_text(row[0]):
                return normalize_text(row[0])

        email = _normalize_email(data.get("email"))
        if email:
            cursor.execute(
                """
                SELECT TOP 1 id_teste
                FROM candidatos_metadata
                WHERE LOWER(LTRIM(RTRIM(email))) = ?
                ORDER BY atualizado_em DESC
                """,
                (email,),
            )
            row = cursor.fetchone()
            if row and normalize_text(row[0]):
                return normalize_text(row[0])

        phone = _normalize_phone(data.get("telefone") or data.get("whatsapp"))
        if phone:
            cursor.execute(
                """
                SELECT id_teste, telefone, whatsapp
                FROM candidatos_metadata
                """
            )
            for row in rows_to_dicts(cursor, cursor.fetchall()):
                phones = {
                    _normalize_phone(row.get("telefone")),
                    _normalize_phone(row.get("whatsapp")),
                }
                phones.discard("")
                if phone in phones:
                    return normalize_text(row.get("id_teste"))

        return self._generate_candidate_id(cursor)

    def _generate_access_code(self, cursor) -> str:
        alphabet = string.ascii_uppercase
        for _ in range(200):
            code = f"{secrets.choice(alphabet)}{secrets.choice(alphabet)}{secrets.randbelow(10)}{secrets.randbelow(10)}"
            cursor.execute(
                """
                SELECT COUNT(*) FROM dbo.provas_geradas WHERE codigo_acesso = ?
                """,
                (code,),
            )
            if int(cursor.fetchone()[0] or 0) == 0:
                return code
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível gerar um código único para a prova.",
        )

    def _issue_public_session(self, cursor, row: dict, method: str) -> str:
        token = secrets.token_urlsafe(36)
        cursor.execute(
            """
            UPDATE dbo.provas_geradas
            SET
                token_sessao_publica = ?,
                token_expira_em = DATEADD(hour, 8, GETDATE()),
                metodo_acesso = ?,
                tentativas_acesso = ISNULL(tentativas_acesso, 0) + 1,
                atualizado_em = GETDATE()
            WHERE id_prova = ?
            """,
            (token, method, int(row.get("id_prova") or 0)),
        )
        row["token_sessao_publica"] = token
        return token

    def _get_exam_row_by_token(self, cursor, token: str) -> dict:
        safe_token = normalize_text(token)
        if not safe_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão da prova não encontrada.")

        cursor.execute(
            f"""
            SELECT
                {EXAM_ROW_COLUMNS}
            FROM dbo.provas_geradas
            WHERE token_sessao_publica = ?
              AND token_expira_em IS NOT NULL
              AND token_expira_em >= GETDATE()
            """,
            (safe_token,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão da prova expirada ou inválida.")

        row = rows[0]
        if normalize_text(row.get("status")) == EXAM_STATUS_CANCELLED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova indisponível.")
        if normalize_text(row.get("status")) == EXAM_STATUS_EXPIRED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova indisponível.")

        expires_at = _parse_datetime(row.get("expira_em"))
        if expires_at and expires_at < datetime.now():
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET status = ?, atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_EXPIRED, int(row.get("id_prova") or 0)),
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova indisponível.")

        return row

    def _get_exam_row_with_result(self, cursor, id_prova: int) -> dict:
        cursor.execute(
            """
            SELECT
                prova.*,
                resultado.nota_objetiva,
                resultado.nota_redacao,
                resultado.nota_excel,
                resultado.nota_tecnica,
                resultado.nota_comunicacao,
                resultado.nota_lgpd,
                resultado.nota_final_prova,
                resultado.status_correcao,
                resultado.pendente_avaliacao_manual,
                resultado.score_por_categoria_json,
                resultado.resumo_etapas_json,
                (
                    SELECT TOP 1
                        score_final,
                        classificacao,
                        confiabilidade,
                        status_analise,
                        componentes_json,
                        pontos_fortes_json,
                        pontos_atencao_json,
                        alertas_criticos_json,
                        dados_ausentes_json,
                        justificativa
                    FROM dbo.scores_conecta score
                    WHERE score.id_prova = prova.id_prova
                    ORDER BY score.calculado_em DESC, score.id_score DESC
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
                ) AS score_payload_json,
                (
                    SELECT TOP 1
                        nota_objetiva,
                        nota_redacao,
                        nota_excel,
                        nota_tecnica,
                        nota_comunicacao,
                        nota_lgpd,
                        nota_final_prova,
                        status_correcao,
                        pendente_avaliacao_manual,
                        score_por_categoria_json,
                        resumo_etapas_json
                    FROM dbo.resultados_provas resultado_json
                    WHERE resultado_json.id_prova = prova.id_prova
                    ORDER BY resultado_json.atualizado_em DESC, resultado_json.id_resultado DESC
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
                ) AS resultado_payload_json,
                (
                    SELECT TOP 1
                        decisao,
                        justificativa,
                        observacao,
                        usuario_responsavel,
                        data_decisao,
                        score_no_momento,
                        classificacao_no_momento,
                        score_considerado
                    FROM dbo.decisoes_rh decisao_json
                    WHERE decisao_json.id_teste = prova.id_teste
                      AND (
                        ISNULL(decisao_json.id_processo_ref, '') = ISNULL(prova.id_processo_ref, '')
                        OR ISNULL(decisao_json.id_processo, '') = ISNULL(prova.id_processo, '')
                        OR (ISNULL(decisao_json.id_processo_ref, '') = '' AND ISNULL(prova.id_processo_ref, '') = '')
                      )
                    ORDER BY decisao_json.data_decisao DESC, decisao_json.id_decisao DESC
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
                ) AS decisao_rh_payload_json
            FROM dbo.provas_geradas prova
            OUTER APPLY (
                SELECT TOP 1 *
                FROM dbo.resultados_provas resultado
                WHERE resultado.id_prova = prova.id_prova
                ORDER BY resultado.atualizado_em DESC, resultado.id_resultado DESC
            ) resultado
            WHERE prova.id_prova = ?
            """,
            (int(id_prova or 0),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova não encontrada.")
        return rows[0]

    def create_generated_exam(self, data: dict, *, generated_by: str = "") -> dict:
        name = normalize_text(data.get("nome_candidato"))
        email = normalize_text(data.get("email"))
        phone = normalize_text(data.get("telefone") or data.get("whatsapp"))
        questions = data.get("questoes_snapshot") or []
        vaga = normalize_text(data.get("vaga") or data.get("cargo"))
        nivel = normalize_text(data.get("nivel"))
        area_prova = normalize_text(data.get("area") or data.get("area_prova") or data.get("area_atuacao") or data.get("trilha"))
        configuracao_inicial = data.get("configuracao") if isinstance(data.get("configuracao"), dict) else {}
        tempo_total = _safe_exam_minutes(
            data.get("tempo_total")
            or data.get("tempo_minutos")
            or configuracao_inicial.get("tempo_total")
            or configuracao_inicial.get("tempo_minutos")
        )
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome do candidato.")
        if not email or not is_valid_email(email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um e-mail válido para acesso do candidato.")
        if not phone or not is_valid_phone(phone):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um telefone válido para acesso do candidato.")
        if not vaga:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a vaga da prova.")
        if not area_prova:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a área da prova.")
        if not nivel:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nível da prova.")
        if not isinstance(questions, list) or not questions:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A prova precisa ter questões geradas.")
        questions = _sanitize_questions_for_storage(questions)
        if not questions:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A prova precisa ter questões válidas.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_candidate_metadata_table(cursor)
            ensure_candidate_metadata_columns(cursor)
            ensure_conecta_exams_tables(cursor)

            processo = None
            process_ref = normalize_text(data.get("id_processo_ref") or data.get("id_processo"))
            if process_ref:
                processo = get_process_row(cursor, process_ref)
            operacao = normalize_text(data.get("operacao") or (processo or {}).get("operacao"))
            trilha = normalize_text(data.get("trilha") or (processo or {}).get("trilha"))
            area_prova = normalize_text(data.get("area") or data.get("area_prova") or data.get("area_atuacao") or trilha)
            if not area_prova:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a área da prova.")

            id_teste = self._find_candidate_id(cursor, data)
            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=name,
                email=email or None,
                telefone=phone or None,
                whatsapp=normalize_text(data.get("whatsapp")) or phone or None,
            )
            if hasattr(self, "_sync_candidate_identity_copies"):
                self._sync_candidate_identity_copies(
                    cursor,
                    id_teste=id_teste,
                    nome_candidato=name,
                    email=email or None,
                    telefone=phone or None,
                    whatsapp=normalize_text(data.get("whatsapp")) or phone or None,
                )

            access_code = self._generate_access_code(cursor)
            etapas = data.get("etapas") or []
            categorias = data.get("categorias") or []
            competencias = data.get("competencias") or []
            configuracao = data.get("configuracao") or {}
            personalizacao = data.get("personalizacao") or {}
            if isinstance(configuracao, dict):
                personalizacao_config = configuracao.get("personalizacao") or {}
                if not isinstance(personalizacao_config, dict):
                    personalizacao_config = {}
                if not isinstance(personalizacao, dict):
                    personalizacao = {}
                configuracao = {
                    **configuracao,
                    "area_prova": configuracao.get("area_prova") or area_prova,
                    "area": configuracao.get("area") or area_prova,
                    "operacao": configuracao.get("operacao") or operacao,
                    "trilha": configuracao.get("trilha") or trilha or area_prova,
                    "personalizacao": {
                        **personalizacao_config,
                        **personalizacao,
                        "setor_cliente": normalize_text(
                            personalizacao.get("setor_cliente")
                            or personalizacao_config.get("setor_cliente")
                            or operacao
                        ),
                        "tom_prova": normalize_text(
                            personalizacao.get("tom_prova")
                            or personalizacao_config.get("tom_prova")
                            or data.get("tom_prova")
                        ),
                        "situacao_pratica": normalize_text(
                            personalizacao.get("situacao_pratica")
                            or personalizacao.get("situacao_pratica_operacao")
                            or personalizacao_config.get("situacao_pratica")
                            or personalizacao_config.get("situacao_pratica_operacao")
                            or data.get("situacao_pratica_operacao")
                        ),
                    },
                }
            expires_at = _parse_datetime(data.get("expira_em"))

            cursor.execute(
                """
                INSERT INTO dbo.provas_geradas
                (
                    id_teste,
                    id_registro,
                    id_entrevista,
                    id_processo,
                    id_processo_ref,
                    nome_candidato,
                    email_acesso,
                    telefone_acesso,
                    cpf,
                    vaga,
                    operacao,
                    trilha,
                    nivel,
                    tempo_total,
                    quantidade_questoes,
                    etapas_json,
                    categorias_json,
                    competencias_json,
                    configuracao_json,
                    questoes_json,
                    instrucoes_operacao,
                    status,
                    codigo_acesso,
                    login_method,
                    gerada_por,
                    gerada_em,
                    expira_em,
                    atualizado_em
                )
                OUTPUT INSERTED.id_prova
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, GETDATE())
                """,
                (
                    id_teste,
                    int(data.get("id_registro") or 0) or None,
                    int(data.get("id_entrevista") or 0) or None,
                    normalize_text(data.get("id_processo")) or normalize_text(processo.get("id_processo") if processo else ""),
                    normalize_text(data.get("id_processo_ref")) or normalize_text(processo.get("id_processo_ref") if processo else ""),
                    name,
                    email,
                    phone,
                    normalize_text(data.get("cpf")),
                    vaga,
                    operacao,
                    trilha or area_prova,
                    nivel,
                    tempo_total,
                    int(data.get("quantidade_questoes") or len(questions)),
                    _json_dumps(etapas),
                    _json_dumps(categorias),
                    _json_dumps(competencias),
                    _json_dumps(configuracao),
                    _json_dumps(questions),
                    normalize_text(data.get("instrucoes_operacao")),
                    EXAM_STATUS_AVAILABLE,
                    access_code,
                    normalize_text(data.get("login_method")) or None,
                    generated_by,
                    expires_at,
                ),
            )
            row = cursor.fetchone()
            id_prova = int(row[0])

            id_registro = int(data.get("id_registro") or 0)
            if id_registro:
                cursor.execute(
                    """
                    UPDATE dbo.candidatos_processos
                    SET
                        id_teste = ?,
                        nome_candidato = ?,
                        vaga = COALESCE(NULLIF(?, ''), vaga),
                        data_atualizacao_pipeline = GETDATE()
                    WHERE id_registro = ?
                    """,
                    (id_teste, name, normalize_text(data.get("vaga")), id_registro),
                )

            conn.commit()
            return {
                "success": True,
                "id_prova": id_prova,
                "id_teste": id_teste,
                "codigo_acesso": access_code,
                "link_publico": "/conecta-provas",
                "status": EXAM_STATUS_AVAILABLE,
            }
        finally:
            conn.close()

    def list_generated_exams(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            cursor.execute(
                """
                SELECT
                    prova.*,
                    resultado.nota_objetiva,
                    resultado.nota_redacao,
                    resultado.nota_excel,
                    resultado.nota_tecnica,
                    resultado.nota_comunicacao,
                    resultado.nota_lgpd,
                    resultado.nota_final_prova,
                    resultado.status_correcao,
                    resultado.pendente_avaliacao_manual,
                    score.score_final,
                    score.classificacao,
                    score.confiabilidade,
                    score.status_analise,
                    score.alertas_criticos_json,
                    decisao.decisao AS decisao_rh,
                    decisao.data_decisao AS data_decisao_rh,
                    decisao.usuario_responsavel AS decisao_rh_usuario
                FROM dbo.provas_geradas prova
                OUTER APPLY (
                    SELECT TOP 1 *
                    FROM dbo.resultados_provas resultado
                    WHERE resultado.id_prova = prova.id_prova
                    ORDER BY resultado.atualizado_em DESC, resultado.id_resultado DESC
                ) resultado
                OUTER APPLY (
                    SELECT TOP 1 *
                    FROM dbo.scores_conecta score
                    WHERE score.id_prova = prova.id_prova
                    ORDER BY score.calculado_em DESC, score.id_score DESC
                ) score
                OUTER APPLY (
                    SELECT TOP 1 *
                    FROM dbo.decisoes_rh decisao
                    WHERE decisao.id_teste = prova.id_teste
                      AND (
                        ISNULL(decisao.id_processo_ref, '') = ISNULL(prova.id_processo_ref, '')
                        OR ISNULL(decisao.id_processo, '') = ISNULL(prova.id_processo, '')
                        OR (ISNULL(decisao.id_processo_ref, '') = '' AND ISNULL(prova.id_processo_ref, '') = '')
                      )
                    ORDER BY decisao.data_decisao DESC, decisao.id_decisao DESC
                ) decisao
                ORDER BY prova.gerada_em DESC, prova.id_prova DESC
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            for row in rows:
                row["alertas_criticos"] = safe_json_loads(row.get("alertas_criticos_json"), [])
                row["competencias"] = safe_json_loads(row.get("competencias_json"), [])
                row.pop("token_sessao_publica", None)
                row.pop("token_expira_em", None)
            return rows
        finally:
            conn.close()

    def update_generated_exam(self, id_prova: int, data: dict, *, updated_by: str = "") -> dict:
        name = normalize_text(data.get("nome_candidato"))
        email = normalize_text(data.get("email"))
        phone = normalize_text(data.get("telefone") or data.get("whatsapp"))
        vaga = normalize_text(data.get("vaga") or data.get("cargo"))
        area_prova = normalize_text(
            data.get("area") or data.get("area_prova") or data.get("area_atuacao") or data.get("trilha")
        )
        nivel = normalize_text(data.get("nivel"))
        questions = _sanitize_questions_for_storage(data.get("questoes_snapshot") or [])
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome do candidato.")
        if not email or not is_valid_email(email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um e-mail válido para acesso do candidato.")
        if not phone or not is_valid_phone(phone):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um telefone válido para acesso do candidato.")
        if not vaga or not area_prova or not nivel or not questions:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe vaga, área, nível e questões válidas.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            cursor.execute(
                """
                SELECT id_prova, id_teste, iniciada_em,
                       (SELECT COUNT(*) FROM dbo.respostas_provas resposta WHERE resposta.id_prova = prova.id_prova) AS respostas
                FROM dbo.provas_geradas prova
                WHERE id_prova = ?
                """,
                (int(id_prova or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova não encontrada.")
            current = rows[0]
            if current.get("iniciada_em") or int(current.get("respostas") or 0) > 0:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A prova já foi iniciada e seus parâmetros não podem mais ser editados.",
                )

            configuracao = data.get("configuracao") if isinstance(data.get("configuracao"), dict) else {}
            personalizacao = data.get("personalizacao") if isinstance(data.get("personalizacao"), dict) else {}
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET nome_candidato = ?, email_acesso = ?, telefone_acesso = ?, cpf = ?,
                    vaga = ?, operacao = ?, trilha = ?, nivel = ?, tempo_total = ?,
                    quantidade_questoes = ?, etapas_json = ?, categorias_json = ?, competencias_json = ?,
                    configuracao_json = ?, questoes_json = ?, instrucoes_operacao = ?,
                    expira_em = ?, login_method = ?, atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (
                    name,
                    email,
                    phone,
                    normalize_text(data.get("cpf")),
                    vaga,
                    normalize_text(data.get("operacao")),
                    normalize_text(data.get("trilha")) or area_prova,
                    nivel,
                    _safe_exam_minutes(data.get("tempo_total") or data.get("tempo_minutos")),
                    int(data.get("quantidade_questoes") or len(questions)),
                    _json_dumps(data.get("etapas") or []),
                    _json_dumps(data.get("categorias") or []),
                    _json_dumps(data.get("competencias") or []),
                    _json_dumps({**configuracao, "personalizacao": personalizacao}),
                    _json_dumps(questions),
                    normalize_text(data.get("instrucoes_operacao")),
                    _parse_datetime(data.get("expira_em")),
                    normalize_text(data.get("login_method")) or None,
                    int(id_prova or 0),
                ),
            )
            self._upsert_candidate_profile(
                cursor,
                id_teste=normalize_text(current.get("id_teste")),
                nome_candidato=name,
                email=email,
                telefone=phone,
                whatsapp=normalize_text(data.get("whatsapp")) or phone,
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_generated_exam(id_prova)

    def delete_generated_exam(self, id_prova: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            cursor.execute("SELECT id_prova FROM dbo.provas_geradas WHERE id_prova = ?", (int(id_prova or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova não encontrada.")
            cursor.execute("DELETE FROM dbo.scores_conecta WHERE id_prova = ?", (int(id_prova or 0),))
            cursor.execute("DELETE FROM dbo.resultados_provas WHERE id_prova = ?", (int(id_prova or 0),))
            cursor.execute("DELETE FROM dbo.respostas_provas WHERE id_prova = ?", (int(id_prova or 0),))
            cursor.execute("DELETE FROM dbo.provas_geradas WHERE id_prova = ?", (int(id_prova or 0),))
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def get_generated_exam(self, id_prova: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_with_result(cursor, id_prova)
            detail = self._exam_detail_payload(row)
            detail["respostas"] = self._get_exam_answers(cursor, id_prova)
            return detail
        finally:
            conn.close()

    def preview_generated_exam_session(self, id_prova: int) -> dict:
        """Sessao somente-leitura para o RH pre-visualizar a prova exatamente como o
        candidato ve (mesmo payload sanitizado de public_get_exam_session), sem
        persistir nada — nao escreve em respostas_provas nem em provas_geradas."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_with_result(cursor, id_prova)
            payload = self._exam_public_payload(row)
            payload["candidato"].update(
                {
                    "nome_candidato": "Pré-visualização (RH)",
                    "dados_confirmados": True,
                }
            )
            payload["respostas"] = []
            payload["preview"] = True
            return payload
        finally:
            conn.close()

    def _get_exam_answers(self, cursor, id_prova: int) -> list[dict]:
        cursor.execute(
            """
            SELECT
                id_resposta,
                id_prova,
                id_teste,
                questao_indice,
                questao_id,
                texto_questao_snapshot,
                alternativas_snapshot,
                resposta_json,
                resposta_correta,
                categoria,
                peso,
                correta,
                nota,
                respondida_em,
                atualizado_em
            FROM dbo.respostas_provas
            WHERE id_prova = ?
            ORDER BY questao_indice ASC, id_resposta ASC
            """,
            (int(id_prova or 0),),
        )
        answers = rows_to_dicts(cursor, cursor.fetchall())
        for answer in answers:
            answer["alternativas"] = safe_json_loads(answer.get("alternativas_snapshot"), [])
            answer["resposta"] = safe_json_loads(answer.get("resposta_json"), None)
            answer["resposta_correta_payload"] = safe_json_loads(answer.get("resposta_correta"), None)
            answer.pop("alternativas_snapshot", None)
            answer.pop("resposta_json", None)
        return answers

    @staticmethod
    def _replay_result_label(correta: Any) -> str:
        if correta is None:
            return "não avaliada objetivamente"
        return "correta" if bool(correta) else "incorreta"

    def get_exam_replay(self, id_prova: int) -> dict:
        """Reconstroi, em ordem cronológica, os eventos de uma prova já
        respondida (etapas iniciadas/concluídas + questões vistas/respondidas)
        a partir das tabelas de telemetria (analise_metricas_respostas,
        analise_sessoes_etapas) e do conteúdo já corrigido (respostas_provas).

        Não depende do job assíncrono de analytics (resultados_analiticos_processos):
        funciona para qualquer prova assim que ela tem telemetria registrada,
        sem esperar processamento em lote.
        """
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            self._get_exam_row_with_result(cursor, id_prova)
            ensure_exam_analytics_tables(cursor)

            safe_id_prova = int(id_prova or 0)
            cursor.execute(
                """
                SELECT
                    questao_indice, questao_id, etapa_chave, primeiro_acesso_em,
                    ultima_alteracao_em, tempo_ativo_segundos, quantidade_alteracoes
                FROM dbo.analise_metricas_respostas
                WHERE id_prova = ?
                ORDER BY questao_indice
                """,
                (safe_id_prova,),
            )
            metrics = rows_to_dicts(cursor, cursor.fetchall())

            cursor.execute(
                """
                SELECT etapa_chave, iniciada_em, finalizada_em, status_etapa, tempo_ativo_segundos
                FROM dbo.analise_sessoes_etapas
                WHERE id_prova = ?
                ORDER BY id_sessao
                """,
                (safe_id_prova,),
            )
            sessions = rows_to_dicts(cursor, cursor.fetchall())

            answers = self._get_exam_answers(cursor, safe_id_prova)
            answers_by_index = {int(answer.get("questao_indice") or 0): answer for answer in answers}

            status_labels = {
                "iniciada": "iniciada",
                "concluida": "concluída",
                "interrompida": "interrompida",
                "expirada": "expirada",
                "cancelada": "cancelada",
            }

            events: list[dict] = []
            for session in sessions:
                etapa_chave = normalize_text(session.get("etapa_chave")) or "-"
                if session.get("iniciada_em"):
                    events.append({
                        "tipo": "etapa_iniciada",
                        "titulo": f'Etapa "{etapa_chave}" iniciada',
                        "descricao": "",
                        "data": session.get("iniciada_em"),
                    })
                if session.get("finalizada_em"):
                    status_label = status_labels.get(
                        normalize_compare_text(session.get("status_etapa")),
                        normalize_text(session.get("status_etapa")) or "finalizada",
                    )
                    tempo_ativo = session.get("tempo_ativo_segundos")
                    events.append({
                        "tipo": "etapa_finalizada",
                        "titulo": f'Etapa "{etapa_chave}" {status_label}',
                        "descricao": f"Tempo ativo: {round(float(tempo_ativo))}s" if tempo_ativo else "",
                        "data": session.get("finalizada_em"),
                    })

            for metric in metrics:
                indice = int(metric.get("questao_indice") or 0)
                answer = answers_by_index.get(indice, {})
                titulo_questao = normalize_text(answer.get("texto_questao_snapshot")) or f"Questão {indice + 1}"
                if metric.get("primeiro_acesso_em"):
                    events.append({
                        "tipo": "questao_vista",
                        "titulo": f"Questão {indice + 1} visualizada",
                        "descricao": titulo_questao[:140],
                        "data": metric.get("primeiro_acesso_em"),
                    })
                if metric.get("ultima_alteracao_em"):
                    resultado_label = self._replay_result_label(answer.get("correta"))
                    tempo_ativo = round(float(metric.get("tempo_ativo_segundos") or 0))
                    alteracoes = int(metric.get("quantidade_alteracoes") or 0)
                    events.append({
                        "tipo": "questao_respondida",
                        "titulo": f"Questão {indice + 1} respondida ({resultado_label})",
                        "descricao": f"Tempo ativo: {tempo_ativo}s · {alteracoes} alteração(ões)",
                        "data": metric.get("ultima_alteracao_em"),
                    })

            events.sort(key=lambda item: normalize_text(item.get("data")) or "")

            return {
                "success": True,
                "eventos": events,
                "resumo": {
                    "tempo_ativo_total_segundos": round(sum(float(m.get("tempo_ativo_segundos") or 0) for m in metrics)),
                    "questoes_visitadas": len({m.get("questao_indice") for m in metrics if m.get("primeiro_acesso_em")}),
                    "total_questoes": len(answers),
                },
            }
        finally:
            conn.close()

    def get_question_heatmap(self, *, trilha: str = "") -> dict:
        """Agrega, por questão (questao_id) dentro de uma trilha, a taxa de
        acerto entre todos os candidatos que já responderam objetivamente
        (correta IS NOT NULL — exclui questões discursivas/manuais ainda sem
        avaliação). Agrupar por trilha evita comparar acerto de questões de
        provas diferentes; questao_indice não serve para agrupar porque a
        ordem das questões é embaralhada por candidato (_apply_question_shuffle).
        """
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            safe_trilha = normalize_text(trilha)
            filtro_trilha = "AND p.trilha = ?" if safe_trilha else ""
            params: tuple = (safe_trilha,) if safe_trilha else ()
            cursor.execute(
                f"""
                SELECT
                    r.questao_id,
                    r.categoria,
                    MAX(r.texto_questao_snapshot) AS texto_questao_snapshot,
                    p.trilha,
                    COUNT(*) AS total_respostas,
                    SUM(CASE WHEN r.correta = 1 THEN 1 ELSE 0 END) AS total_corretas
                FROM dbo.respostas_provas r
                INNER JOIN dbo.provas_geradas p ON p.id_prova = r.id_prova
                WHERE r.correta IS NOT NULL
                  {filtro_trilha}
                GROUP BY r.questao_id, r.categoria, p.trilha
                """,
                params,
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())

            itens = []
            for row in rows:
                total = int(row.get("total_respostas") or 0)
                if total <= 0:
                    continue
                corretas = int(row.get("total_corretas") or 0)
                itens.append({
                    "questao_id": normalize_text(row.get("questao_id")),
                    "texto_questao": normalize_text(row.get("texto_questao_snapshot")),
                    "categoria": normalize_text(row.get("categoria")),
                    "trilha": normalize_text(row.get("trilha")),
                    "total_respostas": total,
                    "total_corretas": corretas,
                    "taxa_acerto": round(corretas / total, 4),
                })
            itens.sort(key=lambda item: item["taxa_acerto"])

            cursor.execute("SELECT DISTINCT trilha FROM dbo.provas_geradas WHERE ISNULL(trilha, '') <> ''")
            trilhas_disponiveis = sorted(
                {normalize_text(trilha_row[0]) for trilha_row in cursor.fetchall() if normalize_text(trilha_row[0])}
            )

            return {"success": True, "itens": itens, "trilhas_disponiveis": trilhas_disponiveis}
        finally:
            conn.close()

    def _available_exam_rows(self, cursor) -> list[dict]:
        cursor.execute(
            f"""
            SELECT
                {EXAM_ROW_COLUMNS}
            FROM dbo.provas_geradas
            WHERE status IN (?, ?, ?, ?, ?, ?)
            ORDER BY gerada_em DESC, id_prova DESC
            """,
            (
                EXAM_STATUS_GENERATED,
                EXAM_STATUS_AVAILABLE,
                EXAM_STATUS_WAITING,
                EXAM_STATUS_IN_PROGRESS,
                EXAM_STATUS_REVIEW,
                EXAM_STATUS_REOPENED,
            ),
        )
        return [
            row
            for row in rows_to_dicts(cursor, cursor.fetchall())
            if self._is_public_exam_available(row)
        ]

    def public_access_by_email(self, email: str) -> dict:
        safe_email = _normalize_email(email)
        if not safe_email or not is_valid_email(safe_email):
            return {"success": False, "message": GENERIC_ACCESS_MESSAGE, "provas": []}

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            matches = [
                row
                for row in self._available_exam_rows(cursor)
                if _normalize_email(row.get("email_acesso")) == safe_email
                and normalize_text(row.get("login_method")) in ("", "email")
            ]
            provas = [
                self._public_exam_summary(row, token=self._issue_public_session(cursor, row, "email"))
                for row in matches
            ]
            conn.commit()
            if not provas:
                return {"success": False, "message": GENERIC_ACCESS_MESSAGE, "provas": []}
            return {"success": True, "message": "", "provas": provas}
        finally:
            conn.close()

    def public_access_by_phone(self, phone: str) -> dict:
        safe_phone = _normalize_phone(phone)
        if not safe_phone or len(safe_phone) < 10:
            return {"success": False, "message": GENERIC_ACCESS_MESSAGE, "provas": []}

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            matches = []
            for row in self._available_exam_rows(cursor):
                if normalize_text(row.get("login_method")) not in ("", "celular"):
                    continue
                row_phone = _normalize_phone(row.get("telefone_acesso"))
                if row_phone and (row_phone == safe_phone or row_phone.endswith(safe_phone[-10:]) or safe_phone.endswith(row_phone[-10:])):
                    matches.append(row)
            provas = [
                self._public_exam_summary(row, token=self._issue_public_session(cursor, row, "telefone"))
                for row in matches
            ]
            conn.commit()
            if not provas:
                return {"success": False, "message": GENERIC_ACCESS_MESSAGE, "provas": []}
            return {"success": True, "message": "", "provas": provas}
        finally:
            conn.close()

    def public_access_by_code(self, code: str) -> dict:
        safe_code = normalize_text(code).upper().replace(" ", "")
        if not re.fullmatch(r"[A-Z]{2}\d{2}", safe_code):
            return {"success": False, "message": "Código inválido ou prova indisponível.", "provas": []}

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            matches = [
                row
                for row in self._available_exam_rows(cursor)
                if normalize_text(row.get("codigo_acesso")).upper() == safe_code
                and normalize_text(row.get("login_method")) in ("", "codigo_prova")
            ]
            provas = [
                self._public_exam_summary(row, token=self._issue_public_session(cursor, row, "codigo"))
                for row in matches
            ]
            conn.commit()
            if not provas:
                return {"success": False, "message": "Código inválido ou prova indisponível.", "provas": []}
            return {"success": True, "message": "", "provas": provas}
        finally:
            conn.close()

    def public_get_exam_session(self, token: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, token)
            payload = self._exam_public_payload(row)
            profile = self._get_candidate_profile_map(cursor).get(normalize_text(row.get("id_teste")), {})
            payload["candidato"].update(
                {
                    "nome_candidato": profile.get("nome_candidato") or payload["candidato"].get("nome_candidato", ""),
                    "email": profile.get("email") or payload["candidato"].get("email", ""),
                    "telefone": profile.get("telefone") or payload["candidato"].get("telefone", ""),
                    "whatsapp": profile.get("whatsapp") or payload["candidato"].get("whatsapp", ""),
                    "cep": profile.get("cep", ""),
                    "endereco": profile.get("endereco", ""),
                    "numero": profile.get("numero", ""),
                    "bairro": profile.get("bairro", ""),
                    "cidade": profile.get("cidade", ""),
                    "idade": profile.get("idade"),
                    "escolaridade": profile.get("escolaridade", ""),
                    "dados_confirmados": bool(row.get("dados_confirmados_em")),
                }
            )
            payload["respostas"] = [
                item.get("resposta")
                for item in self._get_exam_answers(cursor, int(row.get("id_prova") or 0))
            ]
            return payload
        finally:
            conn.close()

    def public_update_candidate_data(self, data: dict) -> dict:
        name = normalize_text(data.get("nome_candidato"))
        email = normalize_text(data.get("email"))
        phone = normalize_text(data.get("telefone"))
        whatsapp = normalize_text(data.get("whatsapp"))
        confirmation_email = normalize_text(data.get("confirmar_email"))
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome completo.")
        if not is_valid_email(email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um e-mail válido.")
        if confirmation_email.lower() != email.lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A confirmação do e-mail não corresponde ao e-mail informado.")
        if not is_valid_phone(phone):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um telefone válido.")
        if not is_valid_phone(whatsapp):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um WhatsApp válido.")
        required_fields = {
            "CEP": normalize_text(data.get("cep")),
            "endereço": normalize_text(data.get("endereco")),
            "número": normalize_text(data.get("numero")),
            "bairro": normalize_text(data.get("bairro")),
            "cidade": normalize_text(data.get("cidade")),
            "escolaridade": normalize_text(data.get("escolaridade")),
        }
        missing = [label for label, value in required_fields.items() if not value]
        if missing or data.get("idade") is None:
            fields = ", ".join([*missing, *(["idade"] if data.get("idade") is None else [])])
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Preencha os campos obrigatórios: {fields}.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, data.get("token"))
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova já finalizada.")
            started_at = datetime.now()
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET
                    nome_candidato = ?,
                    email_acesso = ?,
                    telefone_acesso = ?,
                    dados_confirmados_em = ISNULL(dados_confirmados_em, GETDATE()),
                    atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (name, email, phone, int(row.get("id_prova") or 0)),
            )
            self._upsert_candidate_profile(
                cursor,
                id_teste=row.get("id_teste"),
                nome_candidato=name,
                email=email,
                telefone=phone,
                whatsapp=whatsapp,
                cep=data.get("cep"),
                endereco=data.get("endereco"),
                numero=data.get("numero"),
                bairro=data.get("bairro"),
                cidade=data.get("cidade"),
                idade=data.get("idade"),
                escolaridade=data.get("escolaridade"),
            )
            conn.commit()
            return {
                "success": True,
                "tempo_total": _safe_exam_minutes(row.get("tempo_total")),
                "iniciada_em": _format_datetime(row.get("iniciada_em") or started_at),
                "dados_confirmados": True,
            }
        finally:
            conn.close()

    def public_start_exam(self, token: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, token)
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova já finalizada.")
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET
                    status = ?,
                    iniciada_em = ISNULL(iniciada_em, GETDATE()),
                    atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_IN_PROGRESS, int(row.get("id_prova") or 0)),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def public_start_exam_stage(self, data: dict) -> dict:
        stage_key = normalize_compare_text(data.get("etapa_chave"))
        if not stage_key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Etapa invalida.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, data.get("token"))
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova ja finalizada.")
            questions = self._apply_question_shuffle(
                safe_json_loads(row.get("questoes_json"), []), row
            )
            if not self._public_stage_indices(questions, stage_key):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Etapa nao encontrada.")
            id_prova = int(row.get("id_prova") or 0)
        finally:
            conn.close()
        try:
            payload = {**data, "etapa_chave": stage_key, "etapa_iniciada_em": data.get("etapa_iniciada_em") or datetime.now(timezone.utc).isoformat()}
            self.capture_exam_telemetry(id_prova, payload, stage_status="Iniciada")
        except Exception as exc:
            self.logger.warning("Inicio da etapa preservado sem telemetria complementar: %s", exc)
        return {"success": True}

    def _save_answer_rows(self, cursor, row: dict, answers: list[Any], questions: list[dict], graded: list[dict] | None = None) -> None:
        id_prova = int(row.get("id_prova") or 0)
        id_teste = normalize_text(row.get("id_teste"))
        cursor.execute("DELETE FROM dbo.respostas_provas WHERE id_prova = ?", (id_prova,))
        graded = graded or []
        if not questions:
            return

        rows_params: list[tuple] = []
        for index, question in enumerate(questions):
            answer = answers[index] if index < len(answers) else None
            if isinstance(answer, str):
                answer = sanitize_rich_text_html(answer)
            grade = graded[index] if index < len(graded) else {}
            correct_answer = question.get("answer", question.get("correctIndex"))
            rows_params.append(
                (
                    id_prova,
                    id_teste,
                    index,
                    normalize_text(question.get("id") or question.get("title") or f"q-{index + 1}"),
                    normalize_text(question.get("description") or question.get("title")),
                    _json_dumps(question.get("options") or []),
                    _json_dumps(answer),
                    _json_dumps(correct_answer),
                    normalize_text(question.get("stage") or question.get("stageKey") or question.get("category")),
                    float(question.get("points") or 0),
                    1 if grade.get("correct") is True else 0 if grade.get("correct") is False else None,
                    grade.get("score"),
                )
            )

        # Correções.txt item 9: "concluir etapa" no Excel demorava muito porque
        # cada questão virava um round-trip HTTP->SQL isolado (uma prova com 20-30
        # questões = 20-30 INSERTs sequenciais). Um único INSERT multi-linha por
        # lote reduz isso a poucos round-trips, mantendo os mesmos parâmetros
        # ligados por posição (sem risco de truncar o resposta_json grande do
        # Excel, ao contrário de fast_executemany com colunas NVARCHAR(MAX)).
        CHUNK_SIZE = 100
        for start in range(0, len(rows_params), CHUNK_SIZE):
            chunk = rows_params[start : start + CHUNK_SIZE]
            values_sql = ", ".join(["(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())"] * len(chunk))
            flat_params = [param for row_params in chunk for param in row_params]
            cursor.execute(
                f"""
                INSERT INTO dbo.respostas_provas
                (
                    id_prova,
                    id_teste,
                    questao_indice,
                    questao_id,
                    texto_questao_snapshot,
                    alternativas_snapshot,
                    resposta_json,
                    resposta_correta,
                    categoria,
                    peso,
                    correta,
                    nota,
                    respondida_em,
                    atualizado_em
                )
                VALUES {values_sql}
                """,
                flat_params,
            )

    def public_save_answers(self, data: dict, *, status_value: str = EXAM_STATUS_IN_PROGRESS) -> dict:
        answers = data.get("respostas") or []
        if not isinstance(answers, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Respostas inválidas.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, data.get("token"))
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova já finalizada.")
            questions = self._apply_question_shuffle(
                safe_json_loads(row.get("questoes_json"), []), row
            )
            self._save_answer_rows(cursor, row, answers, questions)
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET status = ?, atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (status_value, int(row.get("id_prova") or 0)),
            )
            conn.commit()
            try:
                self.capture_exam_telemetry(int(row.get("id_prova") or 0), data)
            except Exception as exc:
                self.logger.warning("Respostas salvas sem telemetria complementar: %s", exc)
            return {"success": True}
        finally:
            conn.close()

    def public_complete_stage(self, data: dict) -> dict:
        answers = data.get("respostas") or []
        stage_key = normalize_compare_text(data.get("etapa_chave"))
        question_index = data.get("questao_indice")
        if not isinstance(answers, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Respostas invÃ¡lidas.")
        if not stage_key or question_index is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Etapa invÃ¡lida para conclusÃ£o.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, data.get("token"))
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova jÃ¡ finalizada.")
            questions = self._apply_question_shuffle(
                safe_json_loads(row.get("questoes_json"), []), row
            )
            indices = self._public_stage_indices(questions, stage_key)
            if not indices:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Etapa nÃ£o encontrada.")
            if int(question_index) != int(indices[-1]):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A etapa sÃ³ pode ser concluÃ­da na Ãºltima questÃ£o.")

            config = safe_json_loads(row.get("configuracao_json"), {})
            current_state = self._internal_stage_states(config).get(stage_key) or {}
            if normalize_compare_text(current_state.get("status")) == "interrompida":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Etapa indisponÃ­vel.")

            self._save_answer_rows(cursor, row, answers, questions)
            next_config = self._set_stage_state(
                config,
                stage_key,
                {
                    "status": "concluida",
                    "concluida": True,
                    "finalizada_em": datetime.now().isoformat(),
                    "questao_indice": int(question_index),
                },
            )
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET status = ?, configuracao_json = ?, atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_IN_PROGRESS, _json_dumps(next_config), int(row.get("id_prova") or 0)),
            )
            conn.commit()
            try:
                telemetry_payload = {**data, "etapa_finalizada_em": data.get("etapa_finalizada_em") or datetime.now(timezone.utc).isoformat()}
                self.capture_exam_telemetry(int(row.get("id_prova") or 0), telemetry_payload, stage_status="Concluida")
            except Exception as exc:
                self.logger.warning("Etapa concluida sem telemetria complementar: %s", exc)
            return {"success": True, "etapa": {"key": stage_key, "status": "concluida"}}
        finally:
            conn.close()

    def public_interrupt_stage(self, data: dict) -> dict:
        answers = data.get("respostas") or []
        stage_key = normalize_compare_text(data.get("etapa_chave"))
        question_index = data.get("questao_indice")
        if not isinstance(answers, list):
            answers = []
        if not stage_key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Etapa invÃ¡lida para interrupÃ§Ã£o.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, data.get("token"))
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                return {"success": True, "etapa": {"key": stage_key, "status": "realizada"}}
            questions = self._apply_question_shuffle(
                safe_json_loads(row.get("questoes_json"), []), row
            )
            if not self._public_stage_indices(questions, stage_key):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Etapa nÃ£o encontrada.")
            config = safe_json_loads(row.get("configuracao_json"), {})
            current_state = self._internal_stage_states(config).get(stage_key) or {}
            current_status = normalize_compare_text(current_state.get("status"))
            if current_status == "interrompida":
                return {"success": True, "etapa": {"key": stage_key, "status": "realizada"}}
            if current_status == "concluida":
                # Etapa já concluída não pode ser derrubada por um beacon de saída
                # (ex.: reload da página) — sem essa checagem, um pagehide tardio ou
                # duplicado reabre uma etapa já entregue como "interrompida", e ela
                # passa a aparecer indisponível para o candidato (Correções.txt item 12).
                return {"success": True, "etapa": {"key": stage_key, "status": "concluida"}}

            self._save_answer_rows(cursor, row, answers, questions)
            next_config = self._set_stage_state(
                config,
                stage_key,
                {
                    "status": "interrompida",
                    "interrompida": True,
                    "invalidada": True,
                    "nota_zerada": True,
                    "interrompida_em": datetime.now().isoformat(),
                    "questao_indice": int(question_index) if question_index is not None else None,
                },
            )
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET status = ?, configuracao_json = ?, atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_IN_PROGRESS, _json_dumps(next_config), int(row.get("id_prova") or 0)),
            )
            conn.commit()
            try:
                telemetry_payload = {**data, "etapa_finalizada_em": data.get("etapa_finalizada_em") or datetime.now(timezone.utc).isoformat()}
                self.capture_exam_telemetry(int(row.get("id_prova") or 0), telemetry_payload, stage_status="Interrompida")
            except Exception as exc:
                self.logger.warning("Etapa interrompida sem telemetria complementar: %s", exc)
            return {"success": True, "etapa": {"key": stage_key, "status": "realizada"}}
        finally:
            conn.close()

    def _grade_answers(self, questions: list[dict], answers: list[Any], etapas_config: list[dict], configuracao: dict | None = None) -> dict:
        graded = []
        categories: dict[str, dict[str, float]] = {}
        stage_map: dict[str, dict[str, Any]] = {}
        pending_manual = False
        objective_score = 0.0
        objective_max = 0.0
        excel_score = 0.0
        excel_max = 0.0
        communication_score = 0.0
        communication_max = 0.0
        technical_score = 0.0
        technical_max = 0.0
        lgpd_score = 0.0
        lgpd_max = 0.0
        essay_score = 0.0
        essay_max = 0.0

        weights_by_stage = {
            normalize_text(item.get("key") or item.get("stageKey")): float(item.get("weight") or 0)
            for item in etapas_config
            if isinstance(item, dict)
        }
        stage_states = self._internal_stage_states(configuracao or {})
        interrupted_stage_keys = {
            normalize_compare_text(key)
            for key, state in stage_states.items()
            if isinstance(state, dict) and normalize_compare_text(state.get("status")) == "interrompida"
        }

        for index, question in enumerate(questions):
            answer = answers[index] if index < len(answers) else None
            q_type = normalize_text(question.get("type"))
            points = float(question.get("points") or 10)
            score = 0.0
            correct = None
            manual = False
            stage_key = normalize_text(question.get("stageKey") or "geral")
            public_stage_key = self._public_stage_key_for_question(question, index)
            stage_interrupted = public_stage_key in interrupted_stage_keys

            if q_type == "multiple":
                selected = answer.get("selected") if isinstance(answer, dict) else answer
                expected = question.get("answer", question.get("correctIndex"))
                correct = selected is not None and str(selected) == str(expected)
                score = points if correct else 0.0
                objective_score += score
                objective_max += points
            elif q_type == "compact_choice_group":
                selections = answer.get("selections") if isinstance(answer, dict) else {}
                items = question.get("items") if isinstance(question.get("items"), list) else question.get("itens")
                valid_items = [item for item in (items or []) if isinstance(item, dict)]
                item_points = points / len(valid_items) if valid_items else points
                answered = 0
                correct_items = 0
                for item in valid_items:
                    key = str(item.get("id") or "")
                    selected = selections.get(key) if isinstance(selections, dict) else None
                    expected = item.get("answer")
                    if expected is None and item.get("gabarito"):
                        alternatives = item.get("alternativas") if isinstance(item.get("alternativas"), list) else []
                        expected = next(
                            (
                                idx
                                for idx, alt in enumerate(alternatives)
                                if normalize_text(alt.get("id")) == normalize_text(item.get("gabarito"))
                            ),
                            None,
                        )
                    if selected not in (None, ""):
                        answered += 1
                    if expected is not None and selected is not None and str(selected) == str(expected):
                        correct_items += 1
                        score += item_points
                correct = bool(valid_items) and correct_items == len(valid_items)
                if answered < len(valid_items):
                    manual = True
                    pending_manual = True
                objective_score += score
                objective_max += points
            elif q_type == "excel_external":
                validation = answer.get("validation") if isinstance(answer, dict) else None
                if isinstance(validation, dict):
                    score = float(validation.get("score") or 0)
                    points = float(validation.get("max") or points)
                    manual = bool(validation.get("pendingManual", True))
                else:
                    manual = True
                pending_manual = pending_manual or manual
                excel_score += score
                excel_max += points
            else:
                # Correções.txt item 12: `score` (usado abaixo em graded[]/
                # stage["rawScore"]) NÃO era preenchido aqui antes — só o
                # acumulador agregado de comunicação era. Isso fazia cada
                # questão de Word/Redação/Personalidade (e a etapa inteira,
                # já que rawScore nunca saía de 0) aparecer com nota zerada
                # mesmo quando havia texto respondido e a heurística abaixo
                # calculava um valor positivo.
                manual = True
                pending_manual = True
                text = _strip_html(
                    (answer.get("content") or answer.get("text")) if isinstance(answer, dict) else answer
                )
                if text:
                    score = min(points, max(0, len(text) / 80))
                if public_stage_key == "redacao":
                    essay_score += score
                    essay_max += points
                else:
                    communication_score += score
                    communication_max += points

            if stage_interrupted:
                if q_type in {"multiple", "compact_choice_group"}:
                    objective_score = max(0.0, objective_score - score)
                elif q_type == "excel_external":
                    excel_score = max(0.0, excel_score - score)
                elif public_stage_key == "redacao":
                    essay_score = max(0.0, essay_score - score)
                else:
                    communication_score = max(0.0, communication_score - score)
                score = 0.0
                correct = False
                manual = False

            stage = stage_map.setdefault(
                stage_key,
                {
                    "key": stage_key,
                    "label": normalize_text(question.get("stage")) or stage_key or "Etapa",
                    "rawScore": 0.0,
                    "rawMax": 0.0,
                    "questionCount": 0,
                    "pendings": 0,
                    "weight": weights_by_stage.get(stage_key, 0),
                },
            )
            stage["rawScore"] += score
            stage["rawMax"] += points
            stage["questionCount"] += 1
            if manual:
                stage["pendings"] += 1
            if stage_interrupted:
                stage["status"] = "Etapa interrompida - nota zerada"
                stage["invalidated"] = True
                stage["interrupted"] = True
                stage["zeroed"] = True

            category = normalize_text(question.get("stage") or question.get("category") or question.get("stageKey") or "Geral")
            category_bucket = categories.setdefault(category, {"score": 0.0, "max": 0.0})
            category_bucket["score"] += score
            category_bucket["max"] += points

            category_cmp = normalize_compare_text(category)
            if any(term in category_cmp for term in ("tecnico", "sistema", "ti")):
                technical_score += score
                technical_max += points
            if "lgpd" in category_cmp:
                lgpd_score += score
                lgpd_max += points

            graded.append({
                "score": score,
                "max": points,
                "correct": correct,
                "pendingManual": manual,
                "stageKey": stage_key,
                "interrupted": stage_interrupted,
            })

        resumo_etapas = []
        for stage in stage_map.values():
            raw_max = float(stage["rawMax"] or 0)
            percent = (float(stage["rawScore"]) / raw_max) if raw_max else 0
            stage["percent"] = round(percent, 4)
            stage["weightedScore"] = round(percent * float(stage.get("weight") or 0), 2)
            resumo_etapas.append(stage)

        nota_objetiva = round((objective_score / objective_max) * 100, 2) if objective_max else None
        nota_excel = round((excel_score / excel_max) * 100, 2) if excel_max else None
        nota_comunicacao = round((communication_score / communication_max) * 100, 2) if communication_max else None
        nota_tecnica = round((technical_score / technical_max) * 100, 2) if technical_max else None
        nota_lgpd = round((lgpd_score / lgpd_max) * 100, 2) if lgpd_max else None
        # Correções.txt item 12: a redação usava sempre nota_redacao=None (nunca
        # calculada aqui, só via avaliação manual do RH) — agora recebe a mesma
        # heurística por tamanho de texto usada nas demais questões dissertativas,
        # como estimativa automática sujeita a revisão manual (pendingManual=True).
        nota_redacao = round((essay_score / essay_max) * 100, 2) if essay_max else None
        valid_scores = [
            item for item in (nota_objetiva, nota_excel, nota_comunicacao, nota_tecnica, nota_redacao)
            if item is not None
        ]
        nota_final = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else 0.0
        score_por_categoria = {
            key: round((value["score"] / value["max"]) * 100, 2) if value["max"] else 0
            for key, value in categories.items()
        }
        pending_manual = any(item.get("pendingManual") and not item.get("interrupted") for item in graded)
        return {
            "graded": graded,
            "nota_objetiva": nota_objetiva,
            "nota_excel": nota_excel,
            "nota_comunicacao": nota_comunicacao,
            "nota_tecnica": nota_tecnica,
            "nota_lgpd": nota_lgpd,
            "nota_redacao": nota_redacao,
            "nota_final_prova": nota_final,
            "score_por_categoria": score_por_categoria,
            "resumo_etapas": resumo_etapas,
            "pendente_avaliacao_manual": pending_manual,
        }

    def public_finalize_exam(self, data: dict) -> dict:
        answers = data.get("respostas") or []
        if not isinstance(answers, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Respostas inválidas.")
        force_finalize = bool(data.get("finalizar_mesmo_assim"))

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_by_token(cursor, data.get("token"))
            if normalize_text(row.get("status")) in {EXAM_STATUS_FINISHED, EXAM_STATUS_CORRECTED, EXAM_STATUS_PENDING_MANUAL}:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prova já finalizada.")
            questions = self._apply_question_shuffle(
                safe_json_loads(row.get("questoes_json"), []), row
            )
            etapas_config = safe_json_loads(row.get("etapas_json"), [])
            configuracao = safe_json_loads(row.get("configuracao_json"), {})
            stage_states = self._internal_stage_states(configuracao)
            interrupted_stage_keys = {
                normalize_compare_text(key)
                for key, state in stage_states.items()
                if isinstance(state, dict) and normalize_compare_text(state.get("status")) == "interrompida"
            }
            missing_required = []
            for index, question in enumerate(questions):
                if self._public_stage_key_for_question(question, index) in interrupted_stage_keys:
                    continue
                answer = answers[index] if index < len(answers) else None
                if not _is_public_answer_complete(question, answer):
                    missing_required.append(index + 1)
            if missing_required and not force_finalize:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Existem respostas obrigatórias pendentes: {', '.join(map(str, missing_required))}.",
                )

            grade = self._grade_answers(questions, answers, etapas_config, configuracao)
            if missing_required:
                grade["pendente_avaliacao_manual"] = True
                grade["resumo_etapas"] = [
                    {
                        **stage,
                        "pendings": int(stage.get("pendings") or 0)
                        + sum(
                            1
                            for index in missing_required
                            if normalize_text(questions[index - 1].get("type")) == "multiple"
                            and normalize_text(
                                questions[index - 1].get("stageKey") or "geral"
                            )
                            == normalize_text(stage.get("key"))
                        ),
                    }
                    for stage in grade.get("resumo_etapas", [])
                ]
            self._save_answer_rows(cursor, row, answers, questions, grade["graded"])

            cursor.execute(
                """
                SELECT id_resultado
                FROM dbo.resultados_provas
                WHERE id_prova = ?
                """,
                (int(row.get("id_prova") or 0),),
            )
            exists = cursor.fetchone()
            result_values = (
                grade["nota_objetiva"],
                grade["nota_redacao"],
                grade["nota_excel"],
                grade["nota_tecnica"],
                grade["nota_comunicacao"],
                grade["nota_lgpd"],
                grade["nota_final_prova"],
                _json_dumps(grade["score_por_categoria"]),
                _json_dumps(grade["resumo_etapas"]),
                EXAM_STATUS_PENDING_MANUAL if grade["pendente_avaliacao_manual"] else EXAM_STATUS_CORRECTED,
                1 if grade["pendente_avaliacao_manual"] else 0,
            )
            if exists:
                cursor.execute(
                    """
                    UPDATE dbo.resultados_provas
                    SET
                        nota_objetiva = ?,
                        nota_redacao = ?,
                        nota_excel = ?,
                        nota_tecnica = ?,
                        nota_comunicacao = ?,
                        nota_lgpd = ?,
                        nota_final_prova = ?,
                        score_por_categoria_json = ?,
                        resumo_etapas_json = ?,
                        status_correcao = ?,
                        pendente_avaliacao_manual = ?,
                        atualizado_em = GETDATE()
                    WHERE id_prova = ?
                    """,
                    (*result_values, int(row.get("id_prova") or 0)),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO dbo.resultados_provas
                    (
                        id_prova,
                        id_teste,
                        nota_objetiva,
                        nota_redacao,
                        nota_excel,
                        nota_tecnica,
                        nota_comunicacao,
                        nota_lgpd,
                        nota_final_prova,
                        score_por_categoria_json,
                        resumo_etapas_json,
                        status_correcao,
                        pendente_avaliacao_manual,
                        criado_em,
                        atualizado_em
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                    """,
                    (int(row.get("id_prova") or 0), normalize_text(row.get("id_teste")), *result_values),
                )

            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET
                    status = ?,
                    finalizada_em = GETDATE(),
                    atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_FINISHED, int(row.get("id_prova") or 0)),
            )
            if normalize_text(row.get("id_registro")):
                cursor.execute(
                    """
                    UPDATE dbo.candidatos_processos
                    SET pontuacao_final = ?, data_prova = GETDATE()
                    WHERE id_registro = ?
                    """,
                    (_score_to_old_history_scale(grade["nota_final_prova"]), int(row.get("id_registro") or 0)),
                )
            conn.commit()
        finally:
            conn.close()

        try:
            self.capture_exam_telemetry(int(row.get("id_prova") or 0), data)
            self.enqueue_exam_analytics(
                int(row.get("id_prova") or 0),
                reason="finalizacao-oficial",
            )
        except Exception as exc:
            self.logger.warning("Prova finalizada sem bloquear por falha analitica complementar: %s", exc)

        try:
            self._sync_generated_exam_history(int(row.get("id_prova") or 0), answers, grade)
            score_payload = self.recalculate_score_conecta(
                int(row.get("id_prova") or 0),
                recalculated_by="Conecta Provas",
                reason="Finalização da prova pelo candidato",
            )
        except Exception as exc:
            self.logger.warning("Prova finalizada, mas integração complementar falhou: %s", exc)
            score_payload = {}

        return {
            "success": True,
            "status": EXAM_STATUS_FINISHED,
            "pendente_avaliacao_manual": grade["pendente_avaliacao_manual"],
            "score": score_payload,
        }

    def _sync_generated_exam_history(self, id_prova: int, answers: list[Any], grade: dict) -> None:
        detail = self.get_generated_exam(id_prova)
        record_id = normalize_text(detail.get("id_teste"))
        payload = {
            "idResultado": record_id,
            "candidate": {
                "name": detail.get("nome_candidato"),
                "email": detail.get("email_acesso"),
                "whatsapp": detail.get("telefone_acesso"),
                "role": detail.get("vaga"),
                "level": detail.get("nivel"),
                "track": detail.get("trilha"),
            },
            "questions": detail.get("questoes") or [],
            "answers": answers,
            "stageSummary": grade.get("resumo_etapas") or [],
            "totalScore": grade.get("nota_final_prova"),
            "totalMax": 100,
            "notaFinalPonderada": round(float(grade.get("nota_final_prova") or 0) / 10, 2),
            "textContent": "Resultado gerado pelo Conecta Provas.",
        }
        self.save_history(
            {
                "id_teste": record_id,
                "id_processo": detail.get("id_processo") or "",
                "id_processo_ref": detail.get("id_processo_ref") or "",
                "nome_candidato": detail.get("nome_candidato") or "",
                "vaga": detail.get("vaga") or "",
                "nivel": detail.get("nivel") or "",
                "trilha": detail.get("trilha") or "",
                "data_iso": datetime.now().isoformat(),
                "data_exibicao": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
                "pontuacao_final": _score_to_old_history_scale(grade.get("nota_final_prova")),
                "pontuacao_bruta": f"{grade.get('nota_final_prova', 0)}/100",
                "status": EXAM_STATUS_FINISHED,
                "tempo_minutos": int(detail.get("tempo_total") or 0),
                "arquivo_gabarito": "Resultado gerado pelo Conecta Provas.",
                "etapas_json": _json_dumps(grade.get("resumo_etapas") or []),
            }
        )
        self.save_answer_file({"recordId": record_id, "payload": _json_dumps(payload)})

    def _candidate_payload_for_score(self, cursor, row: dict) -> dict:
        id_teste = normalize_text(row.get("id_teste"))
        cursor.execute(
            """
            SELECT TOP 1
                meta.*,
                cv.score_final AS cv_score_final,
                cv.classificacao AS cv_classificacao
            FROM dbo.candidatos_metadata meta
            LEFT JOIN dbo.cv_pre_analises cv
                ON LOWER(LTRIM(RTRIM(cv.email))) = LOWER(LTRIM(RTRIM(meta.email)))
            WHERE meta.id_teste = ?
            ORDER BY cv.criado_em DESC
            """,
            (id_teste,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        payload = rows[0] if rows else {}
        payload.update(
            {
                "id_teste": id_teste,
                "nome_candidato": row.get("nome_candidato"),
                "vaga": row.get("vaga"),
                "pontuacao_final": row.get("nota_final_prova"),
            }
        )
        return payload

    def _save_score_payload(self, cursor, row: dict, score: dict, *, recalculated_by: str = "", reason: str = "") -> None:
        cursor.execute(
            """
            INSERT INTO dbo.scores_conecta
            (
                id_teste,
                id_prova,
                id_processo,
                id_processo_ref,
                score_final,
                classificacao,
                confiabilidade,
                status_analise,
                componentes_json,
                pontos_fortes_json,
                pontos_atencao_json,
                alertas_criticos_json,
                dados_ausentes_json,
                justificativa,
                calculado_em,
                recalculado_por,
                motivo_recalculo
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?)
            """,
            (
                normalize_text(row.get("id_teste")),
                int(row.get("id_prova") or 0),
                normalize_text(row.get("id_processo")),
                normalize_text(row.get("id_processo_ref")),
                float(score.get("score_final") or 0),
                normalize_text(score.get("classificacao")),
                normalize_text(score.get("confiabilidade")),
                normalize_text(score.get("status_analise")),
                _json_dumps(score.get("componentes")),
                _json_dumps(score.get("pontos_fortes")),
                _json_dumps(score.get("pontos_atencao")),
                _json_dumps(score.get("alertas_criticos")),
                _json_dumps(score.get("dados_ausentes")),
                normalize_text(score.get("justificativa")),
                recalculated_by,
                reason,
            ),
        )

    def recalculate_score_conecta(self, id_prova: int, *, recalculated_by: str = "", reason: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_with_result(cursor, id_prova)
            resultado = {
                "nota_objetiva": row.get("nota_objetiva"),
                "nota_redacao": row.get("nota_redacao"),
                "nota_excel": row.get("nota_excel"),
                "nota_tecnica": row.get("nota_tecnica"),
                "nota_comunicacao": row.get("nota_comunicacao"),
                "nota_lgpd": row.get("nota_lgpd"),
                "nota_final_prova": row.get("nota_final_prova"),
                "score_por_categoria": safe_json_loads(row.get("score_por_categoria_json"), {}),
            }
            prova = {
                "id_prova": row.get("id_prova"),
                "vaga": row.get("vaga"),
                "trilha": row.get("trilha"),
                "nivel": row.get("nivel"),
                "etapas": safe_json_loads(row.get("etapas_json"), []),
                "resultado": resultado,
            }
            candidato = self._candidate_payload_for_score(cursor, row)
            configuracao = safe_json_loads(row.get("configuracao_json"), {})
            score = calcular_score_conecta(candidato, prova, {}, configuracao)
            self._save_score_payload(
                cursor,
                row,
                score,
                recalculated_by=recalculated_by,
                reason=reason,
            )
            conn.commit()
            return score
        finally:
            conn.close()

    def update_manual_evaluation(self, id_prova: int, data: dict, *, updated_by: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_with_result(cursor, id_prova)
            cursor.execute(
                """
                UPDATE dbo.resultados_provas
                SET
                    nota_redacao = COALESCE(?, nota_redacao),
                    nota_excel = COALESCE(?, nota_excel),
                    nota_tecnica = COALESCE(?, nota_tecnica),
                    nota_comunicacao = COALESCE(?, nota_comunicacao),
                    nota_lgpd = COALESCE(?, nota_lgpd),
                    pendente_avaliacao_manual = 0,
                    status_correcao = ?,
                    atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (
                    data.get("nota_redacao"),
                    data.get("nota_excel"),
                    data.get("nota_tecnica"),
                    data.get("nota_comunicacao"),
                    data.get("nota_lgpd"),
                    EXAM_STATUS_CORRECTED,
                    int(row.get("id_prova") or 0),
                ),
            )
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET status = ?, atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_CORRECTED, int(row.get("id_prova") or 0)),
            )
            conn.commit()
        finally:
            conn.close()

        try:
            self.record_manual_correction_history(
                id_prova,
                row,
                data,
                updated_by=updated_by,
            )
        except Exception as exc:
            self.logger.warning("Avaliacao manual salva sem bloquear por falha no historico complementar: %s", exc)
        try:
            score = self.recalculate_score_conecta(
                id_prova,
                recalculated_by=updated_by,
                reason="Avaliação manual atualizada",
            )
        finally:
            try:
                self.enqueue_exam_analytics(id_prova, reason="avaliacao-manual")
            except Exception as exc:
                self.logger.warning("Avaliacao manual salva sem bloquear por falha de enfileiramento analitico: %s", exc)
        return {"success": True, "score": score}

    def reopen_generated_exam(self, id_prova: int, data: dict, *, reopened_by: str = "") -> dict:
        reason = normalize_text(data.get("motivo"))
        if not reason:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o motivo da reabertura.")
        keep_answers = bool(data.get("manter_respostas", True))
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            if not keep_answers:
                cursor.execute("DELETE FROM dbo.respostas_provas WHERE id_prova = ?", (int(id_prova or 0),))
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET
                    status = ?,
                    reaberta_em = GETDATE(),
                    reaberta_por = ?,
                    motivo_reabertura = ?,
                    respostas_anteriores_mantidas = ?,
                    finalizada_em = NULL,
                    atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_REOPENED, reopened_by, reason, 1 if keep_answers else 0, int(id_prova or 0)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova não encontrada.")
            conn.commit()
            try:
                self.enqueue_exam_analytics(id_prova, reason="reabertura")
            except Exception as exc:
                self.logger.warning("Prova reaberta sem bloquear por falha de invalidacao analitica: %s", exc)
            return {"success": True}
        finally:
            conn.close()

    def cancel_generated_exam(self, id_prova: int, data: dict, *, cancelled_by: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            cursor.execute(
                """
                UPDATE dbo.provas_geradas
                SET
                    status = ?,
                    cancelada_em = GETDATE(),
                    cancelada_por = ?,
                    motivo_cancelamento = ?,
                    token_sessao_publica = NULL,
                    token_expira_em = NULL,
                    atualizado_em = GETDATE()
                WHERE id_prova = ?
                """,
                (EXAM_STATUS_CANCELLED, cancelled_by, normalize_text(data.get("motivo")), int(id_prova or 0)),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova não encontrada.")
            conn.commit()
            try:
                self.enqueue_exam_analytics(id_prova, reason="cancelamento")
            except Exception as exc:
                self.logger.warning("Prova cancelada sem bloquear por falha de invalidacao analitica: %s", exc)
            return {"success": True}
        finally:
            conn.close()

    def _find_process_candidate_for_exam(self, cursor, row: dict) -> dict:
        ensure_pipeline_columns(cursor)
        ensure_process_reference_columns(cursor)
        id_registro = int(row.get("id_registro") or 0)
        id_teste = normalize_text(row.get("id_teste"))
        id_processo = normalize_text(row.get("id_processo"))
        id_processo_ref = normalize_text(row.get("id_processo_ref"))
        select_sql = """
            SELECT TOP 1
                id_registro,
                id_processo,
                id_processo_ref,
                id_teste,
                nome_candidato,
                vaga,
                status_candidato,
                pontuacao_final,
                data_prova,
                origem,
                etapa_pipeline,
                data_atualizacao_pipeline,
                aprovado_em,
                eliminado_em,
                motivo_eliminacao,
                etapa_eliminacao,
                eh_indicacao,
                tipo_indicacao
            FROM dbo.candidatos_processos
        """
        if id_registro:
            cursor.execute(f"{select_sql} WHERE id_registro = ? ORDER BY id_registro DESC", (id_registro,))
        elif id_teste and (id_processo_ref or id_processo):
            cursor.execute(
                f"""
                {select_sql}
                WHERE id_teste = ?
                  AND (
                    id_processo_ref = ?
                    OR id_processo = ?
                    OR id_processo_ref = ?
                    OR id_processo = ?
                  )
                ORDER BY id_registro DESC
                """,
                (id_teste, id_processo_ref, id_processo_ref, id_processo, id_processo),
            )
        elif id_teste:
            cursor.execute(
                f"{select_sql} WHERE id_teste = ? ORDER BY id_registro DESC",
                (id_teste,),
            )
        else:
            return {}

        rows = rows_to_dicts(cursor, cursor.fetchall())
        return rows[0] if rows else {}

    def register_rh_decision(self, id_prova: int, data: dict, *, user_name: str = "") -> dict:
        decision = normalize_text(data.get("decisao"))
        if not decision:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a decisão final.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_conecta_exams_tables(cursor)
            row = self._get_exam_row_with_result(cursor, id_prova)
            cursor.execute(
                """
                SELECT TOP 1 score_final, classificacao
                FROM dbo.scores_conecta
                WHERE id_prova = ?
                ORDER BY calculado_em DESC, id_score DESC
                """,
                (int(id_prova or 0),),
            )
            score_row = cursor.fetchone()
            cursor.execute(
                """
                INSERT INTO dbo.decisoes_rh
                (
                    id_teste,
                    id_processo,
                    id_processo_ref,
                    decisao,
                    justificativa,
                    observacao,
                    usuario_responsavel,
                    data_decisao,
                    score_no_momento,
                    classificacao_no_momento,
                    score_considerado
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?, ?)
                """,
                (
                    normalize_text(row.get("id_teste")),
                    normalize_text(row.get("id_processo")),
                    normalize_text(row.get("id_processo_ref")),
                    decision,
                    normalize_text(data.get("justificativa")),
                    normalize_text(data.get("observacao")),
                    user_name,
                    score_row[0] if score_row else None,
                    score_row[1] if score_row else "",
                    1 if data.get("score_considerado", True) else 0,
                ),
            )
            candidate_status = _map_rh_decision_to_candidate_status(decision)
            candidate_row = self._find_process_candidate_for_exam(cursor, row) if candidate_status else {}
            status_synced = False
            if candidate_status and candidate_row and normalize_text(candidate_row.get("id_processo")):
                old_status = canonicalize_candidate_status(candidate_row.get("status_candidato"))
                if normalize_compare_text(old_status) != normalize_compare_text(candidate_status):
                    justification = normalize_text(data.get("justificativa"))
                    observation = normalize_text(data.get("observacao"))
                    movement_note = justification or observation or f"Decisao RH: {decision}"
                    approval_payload = {
                        **data,
                        "mensagem_aprovacao": movement_note,
                        "motivo_eliminacao": movement_note,
                        "etapa_eliminacao": "Decisao RH",
                        "usuario_responsavel": user_name,
                    }
                    self._apply_candidate_status_update(
                        cursor,
                        current_row=candidate_row,
                        new_status=candidate_status,
                        new_stage=infer_pipeline_stage(
                            candidate_status,
                            candidate_row.get("origem"),
                            current_stage=candidate_row.get("etapa_pipeline"),
                        ),
                        data_movimentacao=datetime.now().isoformat(),
                        approval_payload=approval_payload,
                    )
                status_synced = True
            conn.commit()
            return {
                "success": True,
                "status_sincronizado": status_synced,
                "status_candidato": candidate_status,
            }
        finally:
            conn.close()

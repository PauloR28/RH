from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
import unicodedata
from collections.abc import Iterable
from typing import Any

ANALYTICS_ALGORITHM_VERSION = "exam-analytics-1.0.0"
TELEMETRY_VERSION = "1.0"
MINIMUM_COMPARABLE_SAMPLE = 5
EXECUTION_LOW_THRESHOLD = 30.0
EXECUTION_HIGH_THRESHOLD = 70.0

_WORD_PATTERN = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:[-'][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?", re.UNICODE)
_SENTENCE_PATTERN = re.compile(r"[^.!?]+(?:[.!?]+|$)", re.UNICODE)


def category_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    key = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return (key or "geral")[:120]


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def answer_key_version(questions: list[dict], configuration: dict) -> str:
    explicit = configuration.get("gabaritoVersion") or configuration.get("answerVersion")
    if explicit is not None and str(explicit).strip():
        return str(explicit).strip()[:80]
    versions = sorted(
        {
            str(question.get("answerVersion") or question.get("gabaritoVersion")).strip()
            for question in (questions or [])
            if isinstance(question, dict) and (question.get("answerVersion") or question.get("gabaritoVersion"))
        }
    )
    return "|".join(versions)[:80] if versions else "legado"


def comparison_signature(questions: list[dict], stages: list[dict], configuration: dict) -> str:
    safe_questions = []
    for index, question in enumerate(questions or []):
        if not isinstance(question, dict):
            continue
        safe_questions.append(
            {
                "index": index,
                "id": question.get("id") or question.get("questionId") or question.get("title"),
                "type": question.get("type"),
                "stage": question.get("stageKey") or question.get("stage") or question.get("category"),
                "points": question.get("points"),
                "answerVersion": question.get("answerVersion") or question.get("gabaritoVersion"),
            }
        )
    safe_stages = [
        {
            "key": item.get("key") or item.get("stageKey"),
            "weight": item.get("weight"),
            "version": item.get("version"),
        }
        for item in (stages or [])
        if isinstance(item, dict)
    ]
    safe_configuration = {
        key: configuration.get(key)
        for key in (
            "version",
            "versao",
            "configVersion",
            "algorithmVersion",
            "questionBankVersion",
            "gabaritoVersion",
        )
        if configuration.get(key) is not None
    }
    payload = {"questions": safe_questions, "stages": safe_stages, "configuration": safe_configuration}
    return hashlib.sha256(stable_json(payload).encode("utf-8")).hexdigest()


def percentile_midrank(values: Iterable[float]) -> list[float | None]:
    numbers = [float(value) for value in values]
    size = len(numbers)
    if size <= 1:
        return [None] * size
    if len(set(numbers)) == 1:
        return [50.0] * size

    sorted_values = sorted(numbers)
    rank_bounds: dict[float, list[int]] = {}
    for rank, value in enumerate(sorted_values, start=1):
        bounds = rank_bounds.setdefault(value, [rank, rank])
        bounds[1] = rank
    percentile_by_value = {
        value: round(100.0 * ((((first + last) / 2.0) - 1.0) / (size - 1.0)), 3)
        for value, (first, last) in rank_bounds.items()
    }
    return [percentile_by_value[value] for value in numbers]


def z_scores(values: Iterable[float]) -> list[float | None]:
    numbers = [float(value) for value in values]
    if len(numbers) <= 1:
        return [None] * len(numbers)
    deviation = statistics.pstdev(numbers)
    if deviation == 0:
        return [None] * len(numbers)
    mean = statistics.fmean(numbers)
    return [round((value - mean) / deviation, 6) for value in numbers]


def dense_ranks_desc(values: Iterable[float | None]) -> list[int | None]:
    raw = list(values)
    distinct = sorted({float(value) for value in raw if value is not None}, reverse=True)
    rank_by_value = {value: index + 1 for index, value in enumerate(distinct)}
    return [None if value is None else rank_by_value[float(value)] for value in raw]


def weighted_analytical_score(
    percentiles: dict[str, float | None],
    weights: dict[str, float],
    *,
    required_categories: set[str] | None = None,
) -> tuple[float | None, str]:
    required = set(weights)
    if required_categories:
        required.update(required_categories)
    if not weights or not required:
        return None, "Pesos analiticos ainda nao configurados."
    if abs(sum(weights.values()) - 1.0) > 0.0001:
        return None, "Os pesos analiticos nao totalizam 100%."
    missing = sorted(key for key in required if percentiles.get(key) is None)
    if missing:
        return None, "Percentis indisponiveis para: " + ", ".join(missing)
    return round(sum(float(weights[key]) * float(percentiles[key]) for key in required), 3), ""


def profile_adherence(
    scores: dict[str, float | None],
    ideal_profile: dict[str, float],
    weights: dict[str, float],
) -> tuple[float | None, str]:
    if not ideal_profile:
        return None, "Perfil ideal nao configurado."
    categories = set(ideal_profile)
    if any(scores.get(key) is None for key in categories):
        return None, "Aderencia indisponivel por categoria sem resultado valido."
    raw_weights = {key: max(0.0, float(weights.get(key, 0.0))) for key in categories}
    weight_total = sum(raw_weights.values())
    if weight_total <= 0:
        return None, "Pesos do perfil ideal invalidos."
    raw_weights = {key: value / weight_total for key, value in raw_weights.items()}
    distance = math.sqrt(
        sum(
            raw_weights[key] * ((float(scores[key]) - float(ideal_profile[key])) / 100.0) ** 2
            for key in categories
        )
    )
    return round(100.0 * (1.0 - min(1.0, distance)), 3), ""


def execution_indicator(
    performance_percentile: float | None,
    time_percentile: float | None,
    *,
    complete: bool,
    interrupted: bool,
    low: float = EXECUTION_LOW_THRESHOLD,
    high: float = EXECUTION_HIGH_THRESHOLD,
) -> str | None:
    if not complete or interrupted or performance_percentile is None or time_percentile is None:
        return None
    performance = "alta" if performance_percentile >= high else "baixa" if performance_percentile <= low else "media"
    speed = "rapida" if time_percentile <= low else "lenta" if time_percentile >= high else "intermediaria"
    labels = {
        ("alta", "rapida"): "Desempenho alto com execucao mais rapida",
        ("alta", "intermediaria"): "Desempenho alto com tempo intermediario",
        ("alta", "lenta"): "Desempenho alto com execucao mais lenta",
        ("media", "rapida"): "Desempenho intermediario com execucao mais rapida",
        ("media", "intermediaria"): "Desempenho e tempo intermediarios",
        ("media", "lenta"): "Desempenho intermediario com execucao mais lenta",
        ("baixa", "rapida"): "Desempenho baixo com execucao mais rapida",
        ("baixa", "intermediaria"): "Desempenho baixo com tempo intermediario",
        ("baixa", "lenta"): "Desempenho baixo com execucao mais lenta",
    }
    return labels[(performance, speed)]


def text_metrics(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        available = "text" in value or "content" in value
        text = value.get("text") or value.get("content") or ""
    else:
        available = True
        text = value or ""
    plain = re.sub(r"<[^>]+>", " ", str(text))
    plain = re.sub(r"\s+", " ", plain).strip()
    words = _WORD_PATTERN.findall(plain)
    unique_words = {word.casefold() for word in words}
    sentences = [item.strip() for item in _SENTENCE_PATTERN.findall(plain) if item.strip()]
    paragraphs = [item for item in re.split(r"\n\s*\n", str(text)) if item.strip()]
    word_count = len(words)
    sentence_count = len(sentences)
    average = word_count / sentence_count if sentence_count else None
    lexical = len(unique_words) / word_count if word_count else None
    # Proxy local e explicavel; nao substitui avaliacao linguistica humana.
    readability = None
    if average is not None:
        readability = max(0.0, min(100.0, 100.0 - (average - 12.0) * 2.5))
    return {
        "available": available,
        "character_count": len(plain),
        "word_count": word_count,
        "unique_word_count": len(unique_words),
        "sentence_count": sentence_count,
        "paragraph_count": len(paragraphs) if plain else 0,
        "average_words_per_sentence": round(average, 3) if average is not None else None,
        "lexical_richness": round(lexical, 6) if lexical is not None else None,
        "readability_index": round(readability, 3) if readability is not None else None,
        "spelling_status": "Indisponivel",
    }


def sanitized_excel_details(answer: Any) -> list[dict[str, Any]]:
    if not isinstance(answer, dict) or not isinstance(answer.get("validation"), dict):
        return []
    validation = answer["validation"]
    details = validation.get("taskDetails") if isinstance(validation.get("taskDetails"), list) else []
    result = []
    for index, item in enumerate(details):
        if not isinstance(item, dict):
            continue
        result.append(
            {
                "key": str(item.get("id") or item.get("key") or f"item-{index + 1}")[:180],
                "label": str(item.get("label") or item.get("description") or f"Item {index + 1}")[:300],
                "status": "Concluido" if item.get("done") is True else "Pendente" if item.get("done") is False else "Indeterminado",
                "score": item.get("score"),
                "max": item.get("max"),
                "confidence": item.get("confidence"),
                "expectedCell": item.get("expectedAddress") or item.get("address"),
                "foundCell": item.get("address") if item.get("done") else None,
                "expectedValue": item.get("expectedValue"),
                "foundValue": item.get("actualValue") if "actualValue" in item else item.get("foundValue"),
                "foundFormula": item.get("formula"),
                "method": "Formula identificada" if item.get("formula") else "Valor ou metodo alternativo",
                "tolerance": item.get("tolerance"),
                "justification": str(item.get("description") or item.get("label") or "")[:1000],
                "details": {
                    "sheetName": item.get("sheetName"),
                    "address": item.get("address"),
                    "formulaDetected": bool(item.get("formula")),
                },
            }
        )
    return result


def derive_categories(result: dict) -> list[dict[str, Any]]:
    stages = result.get("resumo_etapas") if isinstance(result.get("resumo_etapas"), list) else []
    categories = []
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        label = str(stage.get("label") or stage.get("key") or "Geral")
        percent = stage.get("percent")
        if percent is not None:
            percent = float(percent) * 100.0 if float(percent) <= 1.0 else float(percent)
        categories.append(
            {
                "key": category_key(stage.get("key") or label),
                "name": label[:180],
                "score": None if percent is None else round(max(0.0, min(100.0, percent)), 3),
                "raw_score": float(stage.get("rawScore") or 0.0),
                "raw_max": float(stage.get("rawMax") or 0.0),
                "expected_components": int(stage.get("questionCount") or 0),
                "completed_components": max(0, int(stage.get("questionCount") or 0) - int(stage.get("pendings") or 0)),
                "weight": float(stage.get("weight") or 0.0) / (100.0 if float(stage.get("weight") or 0.0) > 1 else 1.0),
                "complete": int(stage.get("pendings") or 0) == 0,
                "interrupted": bool(stage.get("interrupted") or stage.get("invalidated")),
                "completion_status": "Interrompida" if bool(stage.get("interrupted") or stage.get("invalidated")) else "Concluida" if int(stage.get("pendings") or 0) == 0 else "Aguardando correcao",
            }
        )
    if categories:
        return categories
    score_map = result.get("score_por_categoria") if isinstance(result.get("score_por_categoria"), dict) else {}
    for name, score in score_map.items():
        categories.append(
            {
                "key": category_key(name),
                "name": str(name)[:180],
                "score": None if score is None else round(max(0.0, min(100.0, float(score))), 3),
                "raw_score": None if score is None else float(score),
                "raw_max": 100.0,
                "expected_components": 1,
                "completed_components": 1 if score is not None else 0,
                "weight": 0.0,
                "complete": score is not None,
                "interrupted": False,
                "completion_status": "Concluida" if score is not None else "Aguardando correcao",
            }
        )
    return categories


__all__ = [
    "ANALYTICS_ALGORITHM_VERSION",
    "EXECUTION_HIGH_THRESHOLD",
    "EXECUTION_LOW_THRESHOLD",
    "MINIMUM_COMPARABLE_SAMPLE",
    "TELEMETRY_VERSION",
    "answer_key_version",
    "category_key",
    "comparison_signature",
    "dense_ranks_desc",
    "derive_categories",
    "execution_indicator",
    "percentile_midrank",
    "profile_adherence",
    "sanitized_excel_details",
    "stable_json",
    "text_metrics",
    "weighted_analytical_score",
    "z_scores",
]

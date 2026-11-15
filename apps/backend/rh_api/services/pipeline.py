from __future__ import annotations

from datetime import datetime

from .helpers import normalize_compare_text
from .process_flow import (
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

PIPELINE_STAGES = ("Triagem", "Prova", "Entrevista", "Aprovado", "Reprovado")
NON_TERMINAL_PIPELINE_STAGES = {"Triagem", "Prova", "Entrevista"}


def normalize_pipeline_stage(stage: str | None) -> str:
    safe_stage = normalize_compare_text(stage)

    if safe_stage == "triagem":
        return "Triagem"
    if safe_stage == "prova":
        return "Prova"
    if safe_stage == "entrevista":
        return "Entrevista"
    if safe_stage == "aprovado":
        return "Aprovado"
    if safe_stage == "reprovado":
        return "Reprovado"

    return "Triagem"


def infer_pipeline_stage(
    status_candidato: str | None,
    origem: str | None,
    current_stage: str | None = None,
) -> str:
    status = canonicalize_candidate_status(status_candidato)
    current = normalize_pipeline_stage(current_stage) if current_stage else None
    origem_normalizada = normalize_compare_text(origem)

    if status == CANDIDATE_STATUS_APPROVED:
        return "Aprovado"

    if status in {
        CANDIDATE_STATUS_ELIMINATED,
        CANDIDATE_STATUS_NOT_QUALIFIED,
        CANDIDATE_STATUS_TALENT_BANK,
        CANDIDATE_STATUS_WITHDREW,
    }:
        return "Reprovado"

    if status in {
        CANDIDATE_STATUS_PENDING_CONFIRMATION,
        CANDIDATE_STATUS_SCHEDULED,
        CANDIDATE_STATUS_CONFIRMED,
        CANDIDATE_STATUS_RESCHEDULED,
        CANDIDATE_STATUS_NO_RESPONSE,
        CANDIDATE_STATUS_CANCELED,
        CANDIDATE_STATUS_ATTENDED,
        CANDIDATE_STATUS_MISSED,
    }:
        return "Entrevista"

    if status == CANDIDATE_STATUS_QUALIFIED:
        return "Prova"

    if status == CANDIDATE_STATUS_ANALYSIS:
        return "Triagem"

    if current in PIPELINE_STAGES:
        return current

    if "pre-analise" in origem_normalizada or "pre analise" in origem_normalizada or "cv" in origem_normalizada:
        return "Triagem"

    if "prova" in origem_normalizada:
        return "Prova"

    return "Triagem"


def map_pipeline_stage_to_status(stage: str, current_status: str | None = None) -> str:
    normalized_stage = normalize_pipeline_stage(stage)
    current_status_safe = canonicalize_candidate_status(current_status)

    if normalized_stage == "Triagem":
        return CANDIDATE_STATUS_ANALYSIS

    if normalized_stage == "Prova":
        return CANDIDATE_STATUS_QUALIFIED

    if normalized_stage == "Entrevista":
        if current_status_safe in {
            CANDIDATE_STATUS_PENDING_CONFIRMATION,
            CANDIDATE_STATUS_SCHEDULED,
            CANDIDATE_STATUS_CONFIRMED,
            CANDIDATE_STATUS_RESCHEDULED,
            CANDIDATE_STATUS_NO_RESPONSE,
            CANDIDATE_STATUS_CANCELED,
            CANDIDATE_STATUS_ATTENDED,
            CANDIDATE_STATUS_MISSED,
        }:
            return current_status_safe
        return CANDIDATE_STATUS_QUALIFIED

    if normalized_stage == "Aprovado":
        return CANDIDATE_STATUS_APPROVED

    if current_status_safe == CANDIDATE_STATUS_TALENT_BANK:
        return CANDIDATE_STATUS_TALENT_BANK
    return CANDIDATE_STATUS_ELIMINATED


def build_pipeline_update_payload(stage: str, current_status: str | None = None) -> dict:
    normalized_stage = normalize_pipeline_stage(stage)
    return {
        "etapa_pipeline": normalized_stage,
        "status_candidato": map_pipeline_stage_to_status(normalized_stage, current_status),
        "data_movimentacao": datetime.now().isoformat(),
    }

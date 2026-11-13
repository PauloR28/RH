from __future__ import annotations

import re
from datetime import datetime

from pydantic import field_validator, model_validator

from ..services.interviews import normalize_interview_status
from ..services.process_flow import CANDIDATE_STATUS_PENDING_CONFIRMATION
from .common import BaseSchema


def normalize_interview_datetime_input(value):
    if value is None or isinstance(value, datetime):
        return value

    safe_value = str(value or "").strip()
    if not safe_value:
        return None

    normalized = safe_value.replace(" ", "T", 1)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", normalized):
        return f"{normalized}:00"

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", normalized):
        return normalized

    raise ValueError("Informe data e hora da entrevista no formato YYYY-MM-DDTHH:MM:SS.")


def validate_future_interview_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None

    comparable_value = value.replace(tzinfo=None) if value.tzinfo else value
    if comparable_value < datetime.now():
        raise ValueError("A data da entrevista deve ser futura.")
    return value


class InterviewCreateRequest(BaseSchema):
    id_registro: int
    id_slot: int | None = None
    id_processo: str = ""
    id_processo_ref: str = ""
    data_entrevista: datetime | None = None
    status_entrevista: str = CANDIDATE_STATUS_PENDING_CONFIRMATION
    link_agendamento: str = ""
    observacoes_rh: str = ""
    mensagem_personalizada: str = ""

    @field_validator("id_registro")
    @classmethod
    def validate_record_id(cls, value: int) -> int:
        if int(value or 0) <= 0:
            raise ValueError("Selecione um candidato valido para agendar a entrevista.")
        return int(value)

    @field_validator("data_entrevista", mode="before")
    @classmethod
    def normalize_interview_date(cls, value):
        return normalize_interview_datetime_input(value)

    @field_validator("data_entrevista")
    @classmethod
    def validate_interview_date(cls, value: datetime | None) -> datetime | None:
        return validate_future_interview_datetime(value)

    @field_validator("status_entrevista")
    @classmethod
    def validate_status(cls, value: str) -> str:
        return normalize_interview_status(value)

    @field_validator("link_agendamento")
    @classmethod
    def validate_link(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if safe_value and not safe_value.lower().startswith(("http://", "https://")):
            raise ValueError("Informe um link de agendamento valido.")
        return safe_value

    @field_validator("observacoes_rh")
    @classmethod
    def validate_notes(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if len(safe_value) > 2000:
            raise ValueError("As observacoes da entrevista devem ter no maximo 2000 caracteres.")
        return safe_value

    @field_validator("mensagem_personalizada")
    @classmethod
    def validate_custom_message(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if len(safe_value) > 2000:
            raise ValueError("A mensagem personalizada deve ter no maximo 2000 caracteres.")
        return safe_value


class InterviewUpdateRequest(BaseSchema):
    id_slot: int | None = None
    data_entrevista: datetime | None = None
    status_entrevista: str | None = None
    link_agendamento: str | None = None
    observacoes_rh: str | None = None
    mensagem_personalizada: str | None = None

    @field_validator("data_entrevista", mode="before")
    @classmethod
    def normalize_interview_date(cls, value):
        return normalize_interview_datetime_input(value)

    @field_validator("data_entrevista")
    @classmethod
    def validate_interview_date(cls, value: datetime | None) -> datetime | None:
        return validate_future_interview_datetime(value)

    @field_validator("status_entrevista")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_interview_status(value)

    @field_validator("link_agendamento")
    @classmethod
    def validate_link(cls, value: str | None) -> str | None:
        if value is None:
            return None

        safe_value = str(value or "").strip()
        if safe_value and not safe_value.lower().startswith(("http://", "https://")):
            raise ValueError("Informe um link de agendamento valido.")
        return safe_value

    @field_validator("observacoes_rh")
    @classmethod
    def validate_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None

        safe_value = str(value or "").strip()
        if len(safe_value) > 2000:
            raise ValueError("As observacoes da entrevista devem ter no maximo 2000 caracteres.")
        return safe_value

    @field_validator("mensagem_personalizada")
    @classmethod
    def validate_custom_message(cls, value: str | None) -> str | None:
        if value is None:
            return None

        safe_value = str(value or "").strip()
        if len(safe_value) > 2000:
            raise ValueError("A mensagem personalizada deve ter no maximo 2000 caracteres.")
        return safe_value

    @model_validator(mode="after")
    def validate_payload(self):
        if (
            self.data_entrevista is None
            and self.id_slot is None
            and self.status_entrevista is None
            and self.link_agendamento is None
            and self.observacoes_rh is None
            and self.mensagem_personalizada is None
        ):
            raise ValueError("Informe ao menos um campo para atualizar a entrevista.")

        return self


class InterviewSlotCreateRequest(BaseSchema):
    id_processo: str = ""
    id_processo_ref: str = ""
    data: str
    somente_dia: bool = False
    hora_inicio: str = ""
    hora_fim: str = ""
    duracao_minutos: int = 30
    capacidade_total: int = 1
    observacoes_rh: str = ""

    @field_validator("data")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if not safe_value:
            raise ValueError("Informe a data para criar o horario.")
        return safe_value

    @model_validator(mode="after")
    def validate_time_range(self):
        if self.somente_dia:
            return self
        if not self.hora_inicio.strip() or not self.hora_fim.strip():
            raise ValueError("Informe a faixa de horario ou marque a opcao 'somente o dia'.")
        return self

    @field_validator("duracao_minutos")
    @classmethod
    def validate_duration(cls, value: int) -> int:
        duration = int(value or 0)
        if duration < 5 or duration > 240:
            raise ValueError("A duracao do slot deve ficar entre 5 e 240 minutos.")
        return duration

    @field_validator("capacidade_total")
    @classmethod
    def validate_capacity(cls, value: int) -> int:
        capacity = int(value or 0)
        if capacity < 1:
            raise ValueError("A capacidade do slot deve ser maior que zero.")
        return capacity

    @field_validator("observacoes_rh")
    @classmethod
    def validate_notes(cls, value: str) -> str:
        safe_value = str(value or "").strip()
        if len(safe_value) > 2000:
            raise ValueError("As observacoes da disponibilidade devem ter no maximo 2000 caracteres.")
        return safe_value


class InterviewSlotUpdateRequest(BaseSchema):
    capacidade_total: int | None = None
    status_slot: str | None = None
    observacoes_rh: str | None = None

    @field_validator("capacidade_total")
    @classmethod
    def validate_capacity(cls, value: int | None) -> int | None:
        if value is None:
            return None
        capacity = int(value or 0)
        if capacity < 1:
            raise ValueError("A capacidade do slot deve ser maior que zero.")
        return capacity

    @field_validator("status_slot")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        if value is None:
            return None
        safe_value = str(value or "").strip()
        if safe_value not in {"Disponivel", "Bloqueado"}:
            raise ValueError("Status do slot invalido.")
        return safe_value

    @field_validator("observacoes_rh")
    @classmethod
    def validate_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        safe_value = str(value or "").strip()
        if len(safe_value) > 2000:
            raise ValueError("As observacoes da disponibilidade devem ter no maximo 2000 caracteres.")
        return safe_value

    @model_validator(mode="after")
    def validate_payload(self):
        if self.capacidade_total is None and self.status_slot is None and self.observacoes_rh is None:
            raise ValueError("Informe ao menos um campo para atualizar o slot.")
        return self

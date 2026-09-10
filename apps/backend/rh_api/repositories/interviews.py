from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status

from ..auth import AuthenticatedUser
from ..services.helpers import normalize_compare_text, normalize_text, rows_to_dicts
from ..services.interviews import build_interview_message, normalize_interview_status
from ..services.pipeline import infer_pipeline_stage
from ..services.process_flow import (
    CANDIDATE_STATUS_CANCELED,
    CANDIDATE_STATUS_CONFIRMED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_PENDING_CONFIRMATION,
    CANDIDATE_STATUS_RESCHEDULED,
    CANDIDATE_STATUS_SCHEDULED,
    CANDIDATE_STATUS_WITHDREW,
    build_process_closed_message,
    canonicalize_candidate_status,
    is_process_closed,
    status_allows_interview_scheduling,
)
from .bootstrap import (
    ensure_interview_slots_table,
    ensure_interviews_table,
    ensure_pipeline_columns,
    ensure_process_columns,
    ensure_process_reference_columns,
    get_process_row,
    resolve_process_row_for_related_record,
)


logger = logging.getLogger(__name__)

SLOT_STATUS_AVAILABLE = "Disponivel"
SLOT_STATUS_PARTIAL = "Parcialmente ocupado"
SLOT_STATUS_FULL = "Lotado"
SLOT_STATUS_BLOCKED = "Bloqueado"
OCCUPYING_INTERVIEW_STATUSES = (
    CANDIDATE_STATUS_PENDING_CONFIRMATION,
    CANDIDATE_STATUS_SCHEDULED,
    CANDIDATE_STATUS_CONFIRMED,
    CANDIDATE_STATUS_RESCHEDULED,
)


class InterviewRepositoryMixin:
    def _parse_slot_datetime(self, data: str, horario: str) -> datetime:
        try:
            parsed_date = date.fromisoformat(normalize_text(data))
            parsed_time = time.fromisoformat(normalize_text(horario))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Informe data e horário em formato válido para os slots.",
            ) from exc

        return datetime.combine(parsed_date, parsed_time)

    def _normalize_slot_status(self, value: str | None) -> str:
        safe_value = normalize_compare_text(value)
        if safe_value in {"ocupado", "parcialmente ocupado"}:
            return SLOT_STATUS_PARTIAL
        if safe_value == "lotado":
            return SLOT_STATUS_FULL
        if safe_value == "bloqueado":
            return SLOT_STATUS_BLOCKED
        return SLOT_STATUS_AVAILABLE

    def _calculate_slot_status(self, status_slot: str | None, capacidade_total: int, ocupados: int) -> str:
        if self._normalize_slot_status(status_slot) == SLOT_STATUS_BLOCKED:
            return SLOT_STATUS_BLOCKED

        capacity = max(1, int(capacidade_total or 1))
        occupied = max(0, int(ocupados or 0))
        if occupied <= 0:
            return SLOT_STATUS_AVAILABLE
        if occupied >= capacity:
            return SLOT_STATUS_FULL
        return SLOT_STATUS_PARTIAL

    def _count_slot_occupancy(self, cursor, id_slot: int, *, current_interview_id: int | None = None) -> int:
        cursor.execute(
            """
            SELECT COUNT(1)
            FROM entrevistas_agendadas
            WHERE id_slot = ?
              AND id_entrevista <> ?
              AND status_entrevista IN (?, ?, ?, ?)
            """,
            (
                int(id_slot or 0),
                int(current_interview_id or 0),
                *OCCUPYING_INTERVIEW_STATUSES,
            ),
        )
        return int(cursor.fetchone()[0] or 0)

    def _refresh_slot_status(self, cursor, id_slot: int | None) -> None:
        if not int(id_slot or 0):
            return

        slot = self._select_slot_for_update(cursor, int(id_slot))
        if self._normalize_slot_status(slot.get("status_slot")) == SLOT_STATUS_BLOCKED:
            return

        occupied = self._count_slot_occupancy(cursor, int(id_slot))
        cursor.execute(
            """
            SELECT TOP 1 id_entrevista
            FROM entrevistas_agendadas
            WHERE id_slot = ?
              AND status_entrevista IN (?, ?, ?, ?)
            ORDER BY data_entrevista ASC, id_entrevista ASC
            """,
            (int(id_slot), *OCCUPYING_INTERVIEW_STATUSES),
        )
        row = cursor.fetchone()
        slot_interview_id = int(row[0]) if row and row[0] is not None else None
        calculated_status = self._calculate_slot_status(
            slot.get("status_slot"),
            slot.get("capacidade_total"),
            occupied,
        )
        cursor.execute(
            """
            UPDATE entrevista_slots
            SET status_slot = ?, id_entrevista = ?, atualizado_em = GETDATE()
            WHERE id_slot = ?
            """,
            (calculated_status, slot_interview_id, int(id_slot)),
        )

    def _select_slot_for_update(self, cursor, id_slot: int) -> dict:
        cursor.execute(
            """
            SELECT
                id_slot,
                id_processo,
                id_processo_ref,
                inicio,
                fim,
                status_slot,
                capacidade_total,
                id_entrevista,
                observacoes_rh
            FROM entrevista_slots WITH (UPDLOCK, ROWLOCK)
            WHERE id_slot = ?
            """,
            (int(id_slot or 0),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Horário de entrevista não encontrado.")
        return rows[0]

    def _assert_slot_available(self, cursor, slot: dict, *, current_interview_id: int | None = None) -> None:
        if self._normalize_slot_status(slot.get("status_slot")) == SLOT_STATUS_BLOCKED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este horário não está disponível para agendamento.")

        occupied = self._count_slot_occupancy(
            cursor,
            int(slot.get("id_slot") or 0),
            current_interview_id=current_interview_id,
        )
        capacity = max(1, int(slot.get("capacidade_total") or 1))
        if occupied >= capacity:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este horário está lotado.")

    def _assert_slot_matches_process(self, slot: dict, process_row: dict) -> None:
        slot_process_ref = normalize_text(slot.get("id_processo_ref"))
        slot_process_id = normalize_text(slot.get("id_processo"))
        process_ref = normalize_text(process_row.get("id_processo_ref"))
        process_id = normalize_text(process_row.get("id_processo"))

        if slot_process_ref and slot_process_ref != process_ref:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="O horário selecionado pertence a outro processo.")
        if not slot_process_ref and slot_process_id and slot_process_id != process_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="O horário selecionado pertence a outro processo.")

    def _release_slot(self, cursor, id_slot: int | None, *, id_entrevista: int | None = None) -> None:
        if not int(id_slot or 0):
            return

        cursor.execute(
            """
            UPDATE entrevista_slots
            SET id_entrevista = NULL, atualizado_em = GETDATE()
            WHERE id_slot = ? AND (id_entrevista = ? OR id_entrevista IS NULL)
            """,
            (int(id_slot), int(id_entrevista or 0)),
        )
        self._refresh_slot_status(cursor, int(id_slot))

    def _occupy_slot(self, cursor, id_slot: int | None, id_entrevista: int) -> None:
        if not int(id_slot or 0):
            return

        cursor.execute(
            """
            UPDATE entrevista_slots
            SET id_entrevista = ?, atualizado_em = GETDATE()
            WHERE id_slot = ?
            """,
            (int(id_entrevista), int(id_slot)),
        )
        self._refresh_slot_status(cursor, int(id_slot))

    def _assert_datetime_without_conflict(
        self,
        cursor,
        interview_date,
        *,
        current_interview_id: int | None = None,
    ) -> None:
        if not interview_date:
            return

        cursor.execute(
            """
            SELECT COUNT(1)
            FROM entrevistas_agendadas
            WHERE data_entrevista = ?
              AND id_entrevista <> ?
              AND status_entrevista IN (?, ?, ?, ?)
            """,
            (
                interview_date,
                int(current_interview_id or 0),
                *OCCUPYING_INTERVIEW_STATUSES,
            ),
        )
        if int(cursor.fetchone()[0] or 0):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe entrevista neste horário.")

    def list_interview_slots(
        self,
        id_processo: str = "",
        date: str = "",
        status_slot: str = "",
    ) -> list[dict]:
        def operation() -> list[dict]:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)
                ensure_process_reference_columns(cursor)

                cursor.execute(
                    """
                    SELECT
                        s.id_slot,
                        s.id_processo,
                        s.id_processo_ref,
                        s.inicio,
                        s.fim,
                        s.capacidade_total,
                        s.status_slot,
                        s.id_entrevista,
                        s.observacoes_rh,
                        s.somente_dia,
                        s.criado_em,
                        s.atualizado_em,
                        ISNULL(o.ocupados, 0) AS ocupados,
                        CASE
                            WHEN ISNULL(s.capacidade_total, 1) - ISNULL(o.ocupados, 0) < 0 THEN 0
                            ELSE ISNULL(s.capacidade_total, 1) - ISNULL(o.ocupados, 0)
                        END AS disponiveis,
                        e.id_registro,
                        e.id_teste,
                        e.nome_candidato,
                        e.vaga,
                        e.status_entrevista
                    FROM entrevista_slots s
                    OUTER APPLY (
                        SELECT COUNT(1) AS ocupados
                        FROM entrevistas_agendadas ea
                        WHERE ea.id_slot = s.id_slot
                          AND ea.status_entrevista IN (?, ?, ?, ?)
                    ) o
                    OUTER APPLY (
                        SELECT TOP 1
                            ea.id_registro,
                            ea.id_teste,
                            ea.nome_candidato,
                            ea.vaga,
                            ea.status_entrevista
                        FROM entrevistas_agendadas ea
                        WHERE ea.id_slot = s.id_slot
                          AND ea.status_entrevista IN (?, ?, ?, ?)
                        ORDER BY ea.data_entrevista ASC, ea.id_entrevista ASC
                    ) e
                    ORDER BY s.inicio ASC, s.id_slot ASC
                    """,
                    (*OCCUPYING_INTERVIEW_STATUSES, *OCCUPYING_INTERVIEW_STATUSES),
                )
                rows = rows_to_dicts(cursor, cursor.fetchall())
                rows = self._attach_process_context(
                    cursor,
                    rows,
                    timestamp_fields=["inicio", "atualizado_em"],
                )

                process_filter = normalize_compare_text(id_processo)
                status_filter = normalize_compare_text(status_slot)
                date_filter = normalize_text(date)
                result = []

                for item in rows:
                    if process_filter:
                        process_value = normalize_text(item.get("id_processo_ref")) or normalize_text(item.get("id_processo"))
                        if process_value and process_filter not in normalize_compare_text(process_value):
                            continue

                    calculated_status = self._calculate_slot_status(
                        item.get("status_slot"),
                        item.get("capacidade_total"),
                        item.get("ocupados"),
                    )
                    item["capacidade_total"] = max(1, int(item.get("capacidade_total") or 1))
                    item["ocupados"] = max(0, int(item.get("ocupados") or 0))
                    item["disponiveis"] = max(0, int(item.get("disponiveis") or 0))
                    item["status_calculado"] = calculated_status
                    if self._normalize_slot_status(item.get("status_slot")) != SLOT_STATUS_BLOCKED:
                        item["status_slot"] = calculated_status

                    if status_filter and status_filter != normalize_compare_text(calculated_status):
                        continue

                    if date_filter:
                        start_value = item.get("inicio")
                        start_date = start_value.date().isoformat() if isinstance(start_value, datetime) else normalize_text(start_value)[:10]
                        if start_date != date_filter:
                            continue

                    result.append(item)

                return result
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            "listar slots de entrevista",
            operation,
            retries=1,
            final_message="Não foi possível consultar os horários de entrevista agora. Tente novamente em instantes.",
        )

    def create_interview_slots(self, data: dict) -> dict:
        def operation() -> dict:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)
                ensure_process_columns(cursor)
                ensure_process_reference_columns(cursor)

                process_row = None
                process_reference = normalize_text(data.get("id_processo_ref")) or normalize_text(data.get("id_processo"))
                if process_reference:
                    process_row = get_process_row(cursor, process_reference)
                    if not process_row:
                        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo seletivo não encontrado para criar horários.")
                    if is_process_closed(process_row.get("status")):
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=build_process_closed_message("criar horários de entrevista", process_row.get("id_processo")),
                        )

                somente_dia = bool(data.get("somente_dia"))
                capacity = int(data.get("capacidade_total") or 1)
                if capacity < 1:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A capacidade do slot deve ser maior que zero.")

                if somente_dia:
                    parsed_date = self._parse_slot_datetime(data.get("data"), "00:00").date()
                    windows = [(datetime.combine(parsed_date, time(0, 0)), datetime.combine(parsed_date, time(23, 59, 59)))]
                else:
                    start = self._parse_slot_datetime(data.get("data"), data.get("hora_inicio"))
                    end = self._parse_slot_datetime(data.get("data"), data.get("hora_fim"))
                    duration = int(data.get("duracao_minutos") or 30)
                    if end <= start:
                        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A hora final deve ser maior que a hora inicial.")
                    windows = []
                    current = start
                    while current + timedelta(minutes=duration) <= end:
                        windows.append((current, current + timedelta(minutes=duration)))
                        current = current + timedelta(minutes=duration)

                created = 0
                skipped = 0
                for current, slot_end in windows:
                    cursor.execute(
                        """
                        SELECT COUNT(1)
                        FROM entrevista_slots
                        WHERE inicio < ? AND fim > ?
                        """,
                        (slot_end, current),
                    )
                    has_conflict = int(cursor.fetchone()[0] or 0) > 0
                    if has_conflict:
                        skipped += 1
                    else:
                        cursor.execute(
                            """
                            INSERT INTO entrevista_slots
                            (
                                id_processo,
                                id_processo_ref,
                                inicio,
                                fim,
                                capacidade_total,
                                status_slot,
                                observacoes_rh,
                                somente_dia
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                process_row.get("id_processo", "") if process_row else "",
                                process_row.get("id_processo_ref", "") if process_row else "",
                                current,
                                slot_end,
                                capacity,
                                SLOT_STATUS_AVAILABLE,
                                normalize_text(data.get("observacoes_rh")),
                                1 if somente_dia else 0,
                            ),
                        )
                        created += 1

                conn.commit()
                return {"success": True, "created": created, "skipped": skipped}
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            "criar slots de entrevista",
            operation,
            retries=1,
            final_message="Não foi possível criar os horários agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

    def update_interview_slot(self, id_slot: int, data: dict, *, user: AuthenticatedUser | None = None) -> dict:
        def operation() -> dict:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)

                slot = self._select_slot_for_update(cursor, id_slot)
                if user is not None:
                    processo = get_process_row(cursor, slot.get("id_processo") or slot.get("id_processo_ref"))
                    if processo and not user.allows_operacao(processo.get("operacao")):
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Este horário pertence a uma operação fora do seu escopo de acesso.",
                        )
                occupied = self._count_slot_occupancy(cursor, id_slot)

                new_capacity = (
                    int(data.get("capacidade_total"))
                    if "capacidade_total" in data
                    else int(slot.get("capacidade_total") or 1)
                )
                if new_capacity < 1:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A capacidade do slot deve ser maior que zero.")
                if new_capacity < occupied:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A capacidade não pode ser menor que a quantidade já ocupada.")

                new_status = (
                    self._normalize_slot_status(data.get("status_slot"))
                    if "status_slot" in data
                    else self._normalize_slot_status(slot.get("status_slot"))
                )
                if new_status not in {SLOT_STATUS_AVAILABLE, SLOT_STATUS_BLOCKED}:
                    new_status = SLOT_STATUS_AVAILABLE

                new_notes = (
                    normalize_text(data.get("observacoes_rh"))
                    if "observacoes_rh" in data
                    else normalize_text(slot.get("observacoes_rh"))
                )

                cursor.execute(
                    """
                    UPDATE entrevista_slots
                    SET
                        capacidade_total = ?,
                        status_slot = ?,
                        observacoes_rh = ?,
                        atualizado_em = GETDATE()
                    WHERE id_slot = ?
                    """,
                    (new_capacity, new_status, new_notes, id_slot),
                )
                self._refresh_slot_status(cursor, id_slot)
                conn.commit()
                return {
                    "success": True,
                    "id_slot": id_slot,
                    "capacidade_total": new_capacity,
                    "ocupados": occupied,
                    "disponiveis": max(0, new_capacity - occupied),
                    "status_calculado": self._calculate_slot_status(new_status, new_capacity, occupied),
                }
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            f"atualizar slot de entrevista {id_slot}",
            operation,
            retries=1,
            final_message="Não foi possível atualizar o horário agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

    def delete_interview_slot(self, id_slot: int) -> dict:
        def operation() -> dict:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)

                self._select_slot_for_update(cursor, id_slot)
                occupied = self._count_slot_occupancy(cursor, id_slot)
                if occupied > 0:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Este horário possui candidato(s) agendado(s). Remova ou reagende os candidatos antes de excluir o slot.",
                    )

                cursor.execute("DELETE FROM entrevista_slots WHERE id_slot = ?", (id_slot,))
                conn.commit()
                return {"success": True, "id_slot": id_slot}
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            f"excluir slot de entrevista {id_slot}",
            operation,
            retries=1,
            final_message="Não foi possível excluir o horário agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

    def list_interviews(
        self,
        id_processo: str = "",
        status_entrevista: str = "",
        search: str = "",
    ) -> list[dict]:
        def operation() -> list[dict]:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)
                ensure_process_reference_columns(cursor)
                profile_map = self._get_candidate_profile_map(cursor)
                cursor.execute(
                    """
                    SELECT
                        e.id_entrevista,
                        e.id_slot,
                        e.id_processo,
                        e.id_processo_ref,
                        e.id_registro,
                        e.id_teste,
                        e.nome_candidato,
                        e.vaga,
                        e.data_entrevista,
                        e.status_entrevista,
                        e.link_agendamento,
                        e.observacoes_rh,
                        e.mensagem_base,
                        e.mensagem_personalizada,
                        e.criado_em,
                        e.atualizado_em,
                        s.inicio AS slot_inicio,
                        s.fim AS slot_fim,
                        s.status_slot,
                        s.capacidade_total AS slot_capacidade_total,
                        cp.status_candidato AS status_candidato_processo
                    FROM entrevistas_agendadas e
                    LEFT JOIN entrevista_slots s ON s.id_slot = e.id_slot
                    LEFT JOIN candidatos_processos cp ON cp.id_registro = e.id_registro
                    ORDER BY CASE WHEN e.data_entrevista IS NULL THEN 1 ELSE 0 END, e.data_entrevista ASC, e.id_entrevista DESC
                    """
                )
                rows = rows_to_dicts(cursor, cursor.fetchall())
                rows = self._attach_process_context(
                    cursor,
                    rows,
                    timestamp_fields=["criado_em", "data_entrevista", "atualizado_em"],
                )
                process_filter = normalize_compare_text(id_processo)
                status_filter = normalize_compare_text(status_entrevista)
                search_filter = normalize_compare_text(search)
                result = []

                for item in rows:
                    safe_process_id = normalize_text(item.get("id_processo"))
                    profile = profile_map.get(normalize_text(item.get("id_teste")), {})
                    effective_link = normalize_text(item.get("link_agendamento"))

                    enriched = {
                        **item,
                        "link_agendamento": effective_link,
                        "tags": profile.get("tags", []),
                        "habilidades": profile.get("habilidades", []),
                        "observacao_candidato_rh": profile.get("observacao_rh", ""),
                    }

                    if process_filter and process_filter not in normalize_compare_text(
                        normalize_text(enriched.get("id_processo_ref")) or safe_process_id,
                    ):
                        continue
                    if status_filter and status_filter != normalize_compare_text(enriched.get("status_entrevista")):
                        continue
                    if canonicalize_candidate_status(enriched.get("status_entrevista")) in {
                        CANDIDATE_STATUS_ELIMINATED,
                        CANDIDATE_STATUS_WITHDREW,
                    } or canonicalize_candidate_status(enriched.get("status_candidato_processo")) in {
                        CANDIDATE_STATUS_ELIMINATED,
                        CANDIDATE_STATUS_WITHDREW,
                    }:
                        continue

                    if search_filter:
                        haystack = " ".join(
                            [
                                normalize_text(enriched.get("nome_candidato")),
                                normalize_text(enriched.get("vaga")),
                                safe_process_id,
                                " ".join(enriched.get("tags", [])),
                                " ".join(enriched.get("habilidades", [])),
                                normalize_text(enriched.get("observacoes_rh")),
                            ]
                        )
                        if search_filter not in normalize_compare_text(haystack):
                            continue

                    result.append(enriched)

                return result
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            "listar entrevistas",
            operation,
            retries=1,
            final_message="Não foi possível consultar a agenda de entrevistas agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

    def create_interview(self, data: dict) -> dict:
        def operation() -> dict:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_pipeline_columns(cursor)
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)
                ensure_process_columns(cursor)
                ensure_process_reference_columns(cursor)

                cursor.execute(
                    """
                    SELECT
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
                        data_atualizacao_pipeline
                    FROM candidatos_processos
                    WHERE id_registro = ?
                    """,
                    (int(data.get("id_registro") or 0),),
                )
                candidate_rows = rows_to_dicts(cursor, cursor.fetchall())
                if not candidate_rows:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato do processo não encontrado para agendamento.")
                candidate_row = candidate_rows[0]

                id_processo = normalize_text(data.get("id_processo")) or normalize_text(candidate_row.get("id_processo"))
                process_row = get_process_row(cursor, data.get("id_processo_ref") or candidate_row.get("id_processo_ref") or id_processo)
                if not process_row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo seletivo não encontrado para a entrevista.")
                if is_process_closed(process_row.get("status")):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=build_process_closed_message("agendar entrevista", id_processo),
                    )
                if not status_allows_interview_scheduling(candidate_row.get("status_candidato")):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="O candidato precisa estar qualificado para seguir ao agendamento da entrevista.",
                    )

                id_slot = int(data.get("id_slot") or 0)
                slot_row = self._select_slot_for_update(cursor, id_slot) if id_slot else None
                if slot_row:
                    self._assert_slot_available(cursor, slot_row)
                    self._assert_slot_matches_process(slot_row, process_row)
                    interview_date = slot_row.get("inicio")
                else:
                    interview_date = data.get("data_entrevista") or datetime.now()
                    self._assert_datetime_without_conflict(cursor, interview_date)

                cursor.execute(
                    """
                    SELECT COUNT(1)
                    FROM entrevistas_agendadas
                    WHERE id_registro = ?
                      AND id_processo_ref = ?
                      AND id_slot = ?
                      AND status_entrevista IN (?, ?, ?, ?)
                    """,
                    (
                        int(candidate_row.get("id_registro") or 0),
                        process_row.get("id_processo_ref", ""),
                        id_slot or 0,
                        *OCCUPYING_INTERVIEW_STATUSES,
                    ),
                )
                if int(cursor.fetchone()[0] or 0):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este candidato já está agendado neste slot para este processo.")

                link_agendamento = normalize_text(data.get("link_agendamento"))
                interview_status = CANDIDATE_STATUS_PENDING_CONFIRMATION
                observacoes_rh = normalize_text(data.get("observacoes_rh"))
                mensagem_personalizada = normalize_text(data.get("mensagem_personalizada"))
                mensagem_base = build_interview_message(
                    candidate_name=candidate_row.get("nome_candidato"),
                    vacancy_name=candidate_row.get("vaga") or process_row.get("vaga", ""),
                    interview_datetime=interview_date,
                    scheduling_link=link_agendamento,
                    custom_message=mensagem_personalizada,
                )
                if not mensagem_base:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Não foi possível gerar a mensagem: confirme nome, vaga, data e horário.")

                cursor.execute(
                    """
                    INSERT INTO entrevistas_agendadas
                    (
                        id_slot,
                        id_processo,
                        id_processo_ref,
                        id_registro,
                        id_teste,
                        nome_candidato,
                        vaga,
                        data_entrevista,
                        status_entrevista,
                        link_agendamento,
                        observacoes_rh,
                        mensagem_base,
                        mensagem_personalizada,
                        atualizado_em
                    )
                    OUTPUT INSERTED.id_entrevista
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
                    """,
                    (
                        id_slot or None,
                        process_row.get("id_processo", ""),
                        process_row.get("id_processo_ref", ""),
                        int(candidate_row.get("id_registro") or 0),
                        candidate_row.get("id_teste"),
                        candidate_row.get("nome_candidato"),
                        candidate_row.get("vaga") or process_row.get("vaga", ""),
                        interview_date,
                        interview_status,
                        link_agendamento,
                        observacoes_rh,
                        mensagem_base,
                        mensagem_personalizada,
                    ),
                )
                row = cursor.fetchone()
                if not row or row[0] is None:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Não foi possível obter o ID da entrevista criada.",
                    )

                id_entrevista = int(row[0])
                self._occupy_slot(cursor, id_slot, id_entrevista)

                candidate_target_status = (
                    CANDIDATE_STATUS_ELIMINATED
                    if canonicalize_candidate_status(interview_status) == CANDIDATE_STATUS_WITHDREW
                    else interview_status
                )
                self._apply_candidate_status_update(
                    cursor,
                    current_row=candidate_row,
                    new_status=candidate_target_status,
                    new_stage=infer_pipeline_stage(
                        candidate_target_status,
                        candidate_row.get("origem"),
                        current_stage=candidate_row.get("etapa_pipeline"),
                    ),
                    data_movimentacao=interview_date.isoformat()
                    if isinstance(interview_date, datetime)
                    else datetime.now().isoformat(),
                    approval_payload=(
                        {
                            "motivo_eliminacao": "Desistência do candidato",
                            "etapa_eliminacao": "Entrevista",
                        }
                        if canonicalize_candidate_status(interview_status) == CANDIDATE_STATUS_WITHDREW
                        else None
                    ),
                )
                self._refresh_slot_status(cursor, id_slot)

                self._upsert_candidate_profile(
                    cursor,
                    id_teste=candidate_row.get("id_teste"),
                    nome_candidato=candidate_row.get("nome_candidato"),
                )
                conn.commit()
                logger.info(
                    "Entrevista %s agendada para o candidato %s.",
                    id_entrevista,
                    candidate_row.get("nome_candidato"),
                )
                return {
                    "success": True,
                    "id_entrevista": id_entrevista,
                    "id_slot": id_slot or None,
                    "mensagem_base": mensagem_base,
                }
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            "agendar entrevista",
            operation,
            retries=1,
            final_message="Não foi possível agendar a entrevista agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

    def update_interview(self, id_entrevista: int, data: dict) -> dict:
        def operation() -> dict:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_interviews_table(cursor)
                ensure_interview_slots_table(cursor)
                ensure_pipeline_columns(cursor)
                ensure_process_columns(cursor)
                ensure_process_reference_columns(cursor)
                cursor.execute(
                    """
                    SELECT
                        id_entrevista,
                        id_slot,
                        id_processo,
                        id_processo_ref,
                        id_registro,
                        id_teste,
                        nome_candidato,
                        vaga,
                        data_entrevista,
                        status_entrevista,
                        link_agendamento,
                        observacoes_rh,
                        mensagem_personalizada,
                        criado_em,
                        atualizado_em
                    FROM entrevistas_agendadas
                    WHERE id_entrevista = ?
                    """,
                    (id_entrevista,),
                )
                current_rows = rows_to_dicts(cursor, cursor.fetchall())
                if not current_rows:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entrevista não encontrada.")
                current = current_rows[0]

                process_row = resolve_process_row_for_related_record(
                    cursor,
                    id_processo=current.get("id_processo"),
                    id_processo_ref=current.get("id_processo_ref", ""),
                    timestamp_values=[
                        current.get("data_entrevista"),
                        current.get("atualizado_em"),
                    ],
                ) or get_process_row(cursor, current.get("id_processo_ref") or current.get("id_processo")) or {}
                if is_process_closed(process_row.get("status")):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=build_process_closed_message("atualizar a entrevista", current.get("id_processo")),
                    )

                current_slot_id = int(current.get("id_slot") or 0)
                new_slot_id = int(data.get("id_slot") or 0) if "id_slot" in data else current_slot_id
                slot_changed = new_slot_id != current_slot_id

                # Correções.txt item 4: reagendar (trocar o slot) fica bloqueado
                # depois que o candidato já iniciou a prova.
                if slot_changed and self._candidate_has_exam_in_progress(cursor, current.get("id_teste")):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Este candidato já iniciou a prova e a entrevista não pode mais ser reagendada.",
                    )

                if slot_changed and new_slot_id:
                    slot_row = self._select_slot_for_update(cursor, new_slot_id)
                    self._assert_slot_available(cursor, slot_row, current_interview_id=id_entrevista)
                    self._assert_slot_matches_process(slot_row, process_row)
                    interview_date = slot_row.get("inicio")
                    interview_status = normalize_interview_status(
                        data.get("status_entrevista") or CANDIDATE_STATUS_RESCHEDULED,
                    )
                    cursor.execute(
                        """
                        SELECT COUNT(1)
                        FROM entrevistas_agendadas
                        WHERE id_registro = ?
                          AND id_processo_ref = ?
                          AND id_slot = ?
                          AND id_entrevista <> ?
                          AND status_entrevista IN (?, ?, ?, ?)
                        """,
                        (
                            int(current.get("id_registro") or 0),
                            process_row.get("id_processo_ref", "") or current.get("id_processo_ref", ""),
                            new_slot_id,
                            id_entrevista,
                            *OCCUPYING_INTERVIEW_STATUSES,
                        ),
                    )
                    if int(cursor.fetchone()[0] or 0):
                        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este candidato já está agendado neste slot para este processo.")
                else:
                    interview_date = data.get("data_entrevista", current.get("data_entrevista")) or current.get("data_entrevista") or datetime.now()
                    interview_status = normalize_interview_status(
                        data.get("status_entrevista", current.get("status_entrevista")),
                    )
                    if not new_slot_id:
                        self._assert_datetime_without_conflict(
                            cursor,
                            interview_date,
                            current_interview_id=id_entrevista,
                        )

                link_agendamento = (
                    normalize_text(data.get("link_agendamento"))
                    if "link_agendamento" in data
                    else normalize_text(current.get("link_agendamento"))
                )
                observacoes_rh = (
                    normalize_text(data.get("observacoes_rh"))
                    if "observacoes_rh" in data
                    else normalize_text(current.get("observacoes_rh"))
                )
                mensagem_personalizada = (
                    normalize_text(data.get("mensagem_personalizada"))
                    if "mensagem_personalizada" in data
                    else normalize_text(current.get("mensagem_personalizada"))
                )
                mensagem_base = build_interview_message(
                    candidate_name=current.get("nome_candidato"),
                    vacancy_name=current.get("vaga"),
                    interview_datetime=interview_date,
                    scheduling_link=link_agendamento,
                    custom_message=mensagem_personalizada,
                )
                if not mensagem_base:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Não foi possível gerar a mensagem: confirme nome, vaga, data e horário.")

                cursor.execute(
                    """
                    UPDATE entrevistas_agendadas
                    SET
                        id_slot = ?,
                        data_entrevista = ?,
                        status_entrevista = ?,
                        link_agendamento = ?,
                        observacoes_rh = ?,
                        mensagem_base = ?,
                        mensagem_personalizada = ?,
                        id_processo_ref = ?,
                        atualizado_em = GETDATE()
                    WHERE id_entrevista = ?
                    """,
                    (
                        new_slot_id or None,
                        interview_date,
                        interview_status,
                        link_agendamento,
                        observacoes_rh,
                        mensagem_base,
                        mensagem_personalizada,
                        process_row.get("id_processo_ref", "") or current.get("id_processo_ref", ""),
                        id_entrevista,
                    ),
                )
                if slot_changed:
                    self._release_slot(cursor, current_slot_id, id_entrevista=id_entrevista)
                    self._occupy_slot(cursor, new_slot_id, id_entrevista)
                else:
                    self._refresh_slot_status(cursor, current_slot_id)

                if int(current.get("id_registro") or 0):
                    cursor.execute(
                        """
                        SELECT
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
                            data_atualizacao_pipeline
                        FROM candidatos_processos
                        WHERE id_registro = ?
                        """,
                        (int(current.get("id_registro")),),
                    )
                    candidate_rows = rows_to_dicts(cursor, cursor.fetchall())
                    candidate_row = candidate_rows[0] if candidate_rows else None
                    canonical_interview_status = canonicalize_candidate_status(interview_status)
                    # Correções.txt item 2: cancelar a entrevista precisa eliminar o
                    # candidato (Reprovados) — antes disso, o candidato ficava com
                    # status_candidato = "Cancelado", um estado sem tela própria e
                    # fora de INTERVIEW_SCHEDULING_ALLOWED_STATUSES (só QUALIFIED),
                    # ou seja, ele "sumia" do fluxo sem chegar a lugar nenhum, no
                    # mesmo padrão do bug de CV não qualificado (item 1).
                    candidato_eliminado_por_cancelamento = canonical_interview_status == CANDIDATE_STATUS_CANCELED
                    candidate_target_status = (
                        CANDIDATE_STATUS_ELIMINATED
                        if canonical_interview_status in (CANDIDATE_STATUS_WITHDREW, CANDIDATE_STATUS_CANCELED)
                        else interview_status
                    )
                    if candidate_row and canonicalize_candidate_status(candidate_row.get("status_candidato")) != canonicalize_candidate_status(candidate_target_status):
                        self._apply_candidate_status_update(
                            cursor,
                            current_row=candidate_row,
                            new_status=candidate_target_status,
                            new_stage=infer_pipeline_stage(
                                candidate_target_status,
                                candidate_row.get("origem"),
                                current_stage=candidate_row.get("etapa_pipeline"),
                            ),
                            data_movimentacao=interview_date.isoformat() if isinstance(interview_date, datetime) else str(interview_date),
                            approval_payload=(
                                {
                                    "motivo_eliminacao": "Desistência do candidato",
                                    "etapa_eliminacao": "Entrevista",
                                }
                                if candidate_target_status == CANDIDATE_STATUS_ELIMINATED
                                and canonical_interview_status == CANDIDATE_STATUS_WITHDREW
                                else {
                                    "motivo_eliminacao": "Entrevista cancelada",
                                    "etapa_eliminacao": "Entrevista",
                                }
                                if candidato_eliminado_por_cancelamento
                                else None
                            ),
                        )
                conn.commit()
                logger.info("Entrevista %s atualizada para o status '%s'.", id_entrevista, interview_status)
                return {"success": True, "mensagem_base": mensagem_base}
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            f"atualizar entrevista {id_entrevista}",
            operation,
            retries=1,
            final_message="Não foi possível atualizar a entrevista agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

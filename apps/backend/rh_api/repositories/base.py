from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime

import pyodbc
from fastapi import HTTPException, status

from ..config import Settings
from ..db import get_connection
from ..task_queue import enfileirar
from ..services.helpers import (
    clamp_limit,
    normalize_compare_text,
    normalize_indication_type,
    normalize_string_list,
    normalize_text,
    rows_to_dicts,
    safe_json_loads,
)
from ..services.pipeline import infer_pipeline_stage
from ..services.process_flow import (
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_TALENT_BANK,
    CANDIDATE_STATUS_WITHDREW,
    INTERVIEW_OPERATIONAL_STATUSES,
    PROCESS_STATUS_CLOSED,
    PROCESS_STATUS_TRAINING,
    build_approved_candidate_locked_message,
    build_candidate_status_action_label,
    build_process_closed_message,
    build_terminal_candidate_locked_message,
    canonicalize_candidate_status,
    get_candidate_visible_status,
    is_process_closed,
    is_terminal_candidate_status,
)
from .bootstrap import (
    _select_process_row_from_rows,
    build_process_where_clause,
    describe_database_error,
    ensure_candidate_metadata_table,
    ensure_candidate_metadata_columns,
    ensure_candidate_attachments_table,
    ensure_candidate_movements_table,
    ensure_talent_bank_table,
    ensure_process_reference_columns,
    get_next_id_banco,
    get_gabaritos_payload_column,
    get_process_rows,
    is_identity_column,
    is_deadlock_error,
    resolve_process_row_for_related_record,
    sort_process_rows,
)


class BaseRepository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.logger = logging.getLogger(self.__class__.__name__)

    def _connect(self):
        return get_connection(self.settings)

    @staticmethod
    def _clamp_limit(value, default: int, maximum: int, minimum: int = 1) -> int:
        """Normaliza um limite/tamanho de pagina recebido de fora para um inteiro seguro.

        Wrapper fino sobre `services.helpers.clamp_limit` (implementação única),
        mantido aqui para não quebrar call-sites já migrados que usam `self._clamp_limit(...)`.
        """
        return clamp_limit(value, default, maximum, minimum)

    def _run_with_deadlock_retry(
        self,
        action: str,
        operation,
        *,
        retries: int = 1,
        base_delay_seconds: float = 0.2,
        final_message: str | None = None,
    ):
        total_attempts = max(1, retries + 1)

        for attempt in range(1, total_attempts + 1):
            try:
                return operation()
            except pyodbc.Error as exc:
                if not is_deadlock_error(exc):
                    raise

                if attempt >= total_attempts:
                    self.logger.error(
                        "Deadlock persistente ao %s apos %s tentativa(s): %s",
                        action,
                        attempt,
                        describe_database_error(exc),
                    )
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=final_message
                        or "O banco de dados ficou temporariamente indisponível por conflito de concorrência. Tente novamente em instantes.",
                    ) from exc

                wait_seconds = base_delay_seconds * attempt
                self.logger.warning(
                    "Deadlock ao %s. Tentativa %s/%s em %.2fs. Detalhes: %s",
                    action,
                    attempt,
                    total_attempts,
                    wait_seconds,
                    describe_database_error(exc),
                )
                time.sleep(wait_seconds)

    def _serialize_candidate_profile(self, row: dict | None = None) -> dict:
        safe_row = row or {}
        return {
            "nome_candidato": normalize_text(safe_row.get("nome_candidato")),
            "habilidades": normalize_string_list(safe_json_loads(safe_row.get("habilidades_json"), [])),
            "tags": normalize_string_list(safe_json_loads(safe_row.get("tags_json"), [])),
            "observacao_rh": normalize_text(safe_row.get("observacao_rh")),
            "classificacao_indicacao": normalize_text(safe_row.get("classificacao_indicacao")),
            "justificativa_indicacao": normalize_text(safe_row.get("justificativa_indicacao")),
            "email": normalize_text(safe_row.get("email")),
            "telefone": normalize_text(safe_row.get("telefone")),
            "whatsapp": normalize_text(safe_row.get("whatsapp")),
            "cep": normalize_text(safe_row.get("cep")),
            "endereco": normalize_text(safe_row.get("endereco")),
            "numero": normalize_text(safe_row.get("numero")),
            "cidade": normalize_text(safe_row.get("cidade")),
            "bairro": normalize_text(safe_row.get("bairro")),
            "idade": safe_row.get("idade"),
            "data_nascimento": normalize_text(safe_row.get("data_nascimento"))[:10],
            "escolaridade": normalize_text(safe_row.get("escolaridade")),
            "possui_experiencia": normalize_text(safe_row.get("possui_experiencia")),
            "musica": normalize_text(safe_row.get("musica")),
            "prato": normalize_text(safe_row.get("prato")),
            "futebol": normalize_text(safe_row.get("futebol")),
            "time": normalize_text(safe_row.get("time")),
            "rede_social": normalize_text(safe_row.get("rede_social")),
            "lgpd_consentimento_aceito_em": safe_row.get("lgpd_consentimento_aceito_em"),
            "lgpd_consentimento_versao": normalize_text(safe_row.get("lgpd_consentimento_versao")),
            "atualizado_em": safe_row.get("atualizado_em"),
        }

    def _get_candidate_profile_map(self, cursor) -> dict[str, dict]:
        ensure_candidate_metadata_table(cursor)
        ensure_candidate_metadata_columns(cursor)
        cursor.execute(
            """
            SELECT
                id_teste,
                nome_candidato,
                habilidades_json,
                tags_json,
                observacao_rh,
                classificacao_indicacao,
                justificativa_indicacao,
                email,
                telefone,
                whatsapp,
                cep,
                endereco,
                numero,
                cidade,
                bairro,
                idade,
                data_nascimento,
                escolaridade,
                possui_experiencia,
                musica,
                prato,
                futebol,
                time,
                rede_social,
                atualizado_em
            FROM candidatos_metadata
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        result = {}
        for row in rows:
            id_teste = normalize_text(row.get("id_teste"))
            if not id_teste:
                continue
            result[id_teste] = self._serialize_candidate_profile(row)
        return result

    def _get_candidate_cv_map(self, cursor) -> dict[str, dict]:
        ensure_candidate_attachments_table(cursor)
        cursor.execute(
            """
            WITH anexos_ordenados AS (
                SELECT
                    id_teste,
                    nome_arquivo_original,
                    nome_arquivo_armazenado,
                    tipo_arquivo,
                    caminho_arquivo,
                    tamanho_bytes,
                    criado_em,
                    ROW_NUMBER() OVER (
                        PARTITION BY id_teste
                        ORDER BY criado_em DESC, id_anexo DESC
                    ) AS ordem
                FROM candidatos_anexos
            )
            SELECT
                id_teste,
                nome_arquivo_original,
                nome_arquivo_armazenado,
                tipo_arquivo,
                caminho_arquivo,
                tamanho_bytes,
                criado_em
            FROM anexos_ordenados
            WHERE ordem = 1
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return {
            normalize_text(item.get("id_teste")): item
            for item in rows
            if normalize_text(item.get("id_teste"))
        }

    def _get_pre_analysis_cv_map(self, cursor) -> dict[str, dict]:
        cursor.execute(
            """
            SELECT
                id_pre_analise,
                nome_arquivo,
                mime_type,
                score_final,
                classificacao,
                arquivo_original_base64
            FROM cv_pre_analises
            WHERE ISNULL(arquivo_original_base64, '') <> ''
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        result = {}
        for item in rows:
            id_pre_analise = item.get("id_pre_analise")
            if id_pre_analise is None:
                continue
            result[f"CV-{id_pre_analise}"] = {
                "nome_arquivo_original": normalize_text(item.get("nome_arquivo")),
                "tipo_arquivo": normalize_text(item.get("mime_type")) or "application/octet-stream",
                "caminho_arquivo": "__cv_pre_analise_base64__",
                "arquivo_original_base64": normalize_text(item.get("arquivo_original_base64")),
                "score_final": item.get("score_final"),
                "classificacao": normalize_text(item.get("classificacao")),
            }
        return result

    def _get_history_result_map(self, cursor) -> dict[str, list[dict]]:
        cursor.execute(
            """
            SELECT
                id_teste,
                id_processo,
                id_processo_ref,
                pontuacao_final,
                data_iso,
                status,
                etapas_json
            FROM historico_provas
            WHERE ISNULL(id_teste, '') <> ''
            ORDER BY data_iso DESC
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        result: dict[str, list[dict]] = {}
        for row in rows:
            id_teste = normalize_text(row.get("id_teste"))
            if not id_teste:
                continue
            result.setdefault(id_teste, []).append(row)
        return result

    def _get_generated_exam_status_maps(self, cursor) -> dict[str, dict]:
        cursor.execute("SELECT OBJECT_ID('dbo.provas_geradas', 'U')")
        if not cursor.fetchone()[0]:
            return {"by_registro": {}, "by_candidate_process": {}, "by_teste": {}}

        cursor.execute(
            """
            WITH provas_ordenadas AS (
                SELECT
                    prova.id_prova,
                    prova.id_registro,
                    prova.id_teste,
                    prova.id_processo,
                    prova.id_processo_ref,
                    prova.status,
                    prova.codigo_acesso,
                    prova.gerada_em,
                    prova.iniciada_em,
                    prova.finalizada_em,
                    prova.cancelada_em,
                    resultado.nota_final_prova,
                    resultado.resumo_etapas_json,
                    ROW_NUMBER() OVER (
                        PARTITION BY ISNULL(prova.id_registro, 0)
                        ORDER BY prova.atualizado_em DESC, prova.id_prova DESC
                    ) AS ordem_registro,
                    ROW_NUMBER() OVER (
                        PARTITION BY prova.id_teste, ISNULL(prova.id_processo_ref, ''), ISNULL(prova.id_processo, '')
                        ORDER BY prova.atualizado_em DESC, prova.id_prova DESC
                    ) AS ordem_processo,
                    ROW_NUMBER() OVER (
                        PARTITION BY prova.id_teste
                        ORDER BY prova.atualizado_em DESC, prova.id_prova DESC
                    ) AS ordem_teste
                FROM dbo.provas_geradas prova
                OUTER APPLY (
                    SELECT TOP 1 nota_final_prova, resumo_etapas_json
                    FROM dbo.resultados_provas resultado
                    WHERE resultado.id_prova = prova.id_prova
                    ORDER BY resultado.atualizado_em DESC, resultado.id_resultado DESC
                ) resultado
                WHERE ISNULL(prova.id_teste, '') <> ''
            )
            SELECT
                id_prova,
                id_registro,
                id_teste,
                id_processo,
                id_processo_ref,
                status,
                codigo_acesso,
                gerada_em,
                iniciada_em,
                finalizada_em,
                cancelada_em,
                nota_final_prova,
                resumo_etapas_json,
                ordem_registro,
                ordem_processo,
                ordem_teste
            FROM provas_ordenadas
            WHERE ordem_registro = 1 OR ordem_processo = 1 OR ordem_teste = 1
            """
        )
        maps = {"by_registro": {}, "by_candidate_process": {}, "by_teste": {}}
        for row in rows_to_dicts(cursor, cursor.fetchall()):
            id_registro = int(row.get("id_registro") or 0)
            id_teste = normalize_text(row.get("id_teste"))
            id_processo = normalize_text(row.get("id_processo"))
            id_processo_ref = normalize_text(row.get("id_processo_ref"))
            if id_registro and int(row.get("ordem_registro") or 0) == 1:
                maps["by_registro"][id_registro] = row
            if id_teste and int(row.get("ordem_processo") or 0) == 1:
                for process_ref in {id_processo_ref, id_processo}:
                    if process_ref:
                        maps["by_candidate_process"][f"{id_teste}@@{process_ref}"] = row
            if id_teste and int(row.get("ordem_teste") or 0) == 1:
                maps["by_teste"][id_teste] = row
        return maps

    def _get_standalone_generated_exam_candidates(
        self,
        cursor,
        existing_candidate_ids: set[str] | None = None,
    ) -> list[dict]:
        cursor.execute("SELECT OBJECT_ID('dbo.provas_geradas', 'U')")
        if not cursor.fetchone()[0]:
            return []

        cursor.execute(
            """
            WITH provas_ordenadas AS (
                SELECT
                    prova.id_prova,
                    prova.id_teste,
                    prova.nome_candidato,
                    prova.email_acesso,
                    prova.telefone_acesso,
                    prova.cpf,
                    prova.vaga,
                    prova.operacao,
                    prova.trilha,
                    prova.nivel,
                    prova.status,
                    prova.codigo_acesso,
                    prova.gerada_em,
                    prova.iniciada_em,
                    prova.finalizada_em,
                    prova.cancelada_em,
                    prova.atualizado_em,
                    resultado.nota_final_prova,
                    resultado.resumo_etapas_json,
                    ROW_NUMBER() OVER (
                        PARTITION BY prova.id_teste
                        ORDER BY prova.atualizado_em DESC, prova.id_prova DESC
                    ) AS ordem
                FROM dbo.provas_geradas prova
                OUTER APPLY (
                    SELECT TOP 1 nota_final_prova, resumo_etapas_json
                    FROM dbo.resultados_provas resultado
                    WHERE resultado.id_prova = prova.id_prova
                    ORDER BY resultado.atualizado_em DESC, resultado.id_resultado DESC
                ) resultado
                WHERE ISNULL(prova.id_teste, '') <> ''
                  AND ISNULL(prova.id_registro, 0) = 0
                  AND ISNULL(prova.id_processo_ref, '') = ''
                  AND ISNULL(prova.id_processo, '') = ''
            )
            SELECT *
            FROM provas_ordenadas
            WHERE ordem = 1
            ORDER BY COALESCE(finalizada_em, gerada_em) DESC, id_prova DESC
            """
        )
        existing_ids = {
            normalize_text(candidate_id)
            for candidate_id in (existing_candidate_ids or set())
            if normalize_text(candidate_id)
        }
        standalone_rows = rows_to_dicts(cursor, cursor.fetchall())

        cursor.execute(
            """
            SELECT id_teste, status
            FROM (
                SELECT
                    id_teste,
                    status,
                    ROW_NUMBER() OVER (
                        PARTITION BY id_teste
                        ORDER BY data_iso DESC
                    ) AS ordem
                FROM historico_provas
                WHERE ISNULL(id_teste, '') <> ''
            ) historico
            WHERE ordem = 1
            """
        )
        status_atual_por_teste = {
            normalize_text(item.get("id_teste")): canonicalize_candidate_status(item.get("status"))
            for item in rows_to_dicts(cursor, cursor.fetchall())
        }
        candidates = []
        for row in standalone_rows:
            id_teste = normalize_text(row.get("id_teste"))
            if not id_teste or id_teste in existing_ids:
                continue

            nota_final = row.get("nota_final_prova")
            data_prova = row.get("finalizada_em") or row.get("gerada_em")
            status_atual = status_atual_por_teste.get(id_teste) or CANDIDATE_STATUS_ANALYSIS
            candidates.append(
                {
                    "id_registro": None,
                    "id_teste": id_teste,
                    "nome_candidato": normalize_text(row.get("nome_candidato")),
                    "email": normalize_text(row.get("email_acesso")),
                    "telefone": normalize_text(row.get("telefone_acesso")),
                    "whatsapp": normalize_text(row.get("telefone_acesso")),
                    "cpf": normalize_text(row.get("cpf")),
                    "vaga": normalize_text(row.get("vaga")),
                    "operacao": normalize_text(row.get("operacao")),
                    "trilha": normalize_text(row.get("trilha")),
                    "nivel": normalize_text(row.get("nivel")),
                    "status_candidato": status_atual,
                    "pontuacao_final": nota_final,
                    "nota_prova": nota_final,
                    "data_prova": data_prova,
                    "data_prova_realizada": data_prova,
                    "origem": "Prova avulsa",
                    "etapa_pipeline": infer_pipeline_stage(
                        status_atual,
                        "Prova avulsa",
                        "",
                    ),
                    "data_atualizacao_pipeline": row.get("atualizado_em"),
                    "prova_disponivel": nota_final is not None,
                    "id_teste_prova": id_teste if nota_final is not None else "",
                    "tem_prova_gerada": True,
                    "id_prova_gerada": row.get("id_prova"),
                    "status_prova_gerada": normalize_text(row.get("status")),
                    "codigo_prova_gerada": normalize_text(row.get("codigo_acesso")),
                    "data_prova_gerada": row.get("gerada_em"),
                    "prova_iniciada_em": row.get("iniciada_em"),
                    "prova_finalizada_em": row.get("finalizada_em"),
                    "prova_cancelada_em": row.get("cancelada_em"),
                    "status_prova": normalize_text(row.get("status")),
                    "etapas_prova_json": normalize_text(row.get("resumo_etapas_json")),
                }
            )
        return candidates

    def _select_history_result_for_candidate(self, candidate: dict, history_rows: list[dict]) -> dict:
        if not history_rows:
            return {}

        candidate_ref = normalize_text(candidate.get("id_processo_ref"))
        candidate_process = normalize_text(candidate.get("id_processo"))

        for row in history_rows:
            row_ref = normalize_text(row.get("id_processo_ref"))
            row_process = normalize_text(row.get("id_processo"))
            if candidate_ref and row_ref and row_ref == candidate_ref:
                return row
            if candidate_ref and row_process and candidate_ref.split("@@", 1)[0] == row_process:
                return row
            if candidate_process and row_process and row_process == candidate_process:
                return row

        return history_rows[0]

    def _format_candidate_origin(self, candidate: dict | None) -> str:
        raw_origin = normalize_text((candidate or {}).get("origem"))
        origin = normalize_compare_text(raw_origin)
        if not origin:
            return "Processo Unico"
        if "pagina" in origin and ("candidatura" in origin or "inscricao" in origin):
            return "Pagina de inscricao"
        if "pre analise" in origin or "pre-analise" in origin or "analise direta" in origin:
            return "Analise direta do CV"
        if "banco" in origin and "talento" in origin:
            return "Banco de Talentos"
        if "processo unico" in origin or "processo_unico" in origin or "avulso" in origin:
            return "Processo Unico"
        if "recebimento" in origin and "email" in origin:
            return "Recebimento de e-mail"
        if origin == "prova":
            return "Processo Unico"
        return raw_origin

    def _get_cv_contact_map(self, cursor) -> dict[str, dict]:
        cursor.execute(
            """
            SELECT id_pre_analise, nome_candidato, email, telefone, whatsapp
            FROM cv_pre_analises
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        result = {}
        for row in rows:
            id_pre_analise = row.get("id_pre_analise")
            if id_pre_analise is None:
                continue
            result[f"CV-{id_pre_analise}"] = {
                "email": normalize_text(row.get("email")),
                "telefone": normalize_text(row.get("telefone")),
                "whatsapp": normalize_text(row.get("whatsapp")),
                "nome_candidato": normalize_text(row.get("nome_candidato")),
            }
        return result

    def _get_latest_interview_map(self, cursor) -> dict[str, dict]:
        ensure_process_reference_columns(cursor)
        cursor.execute(
            """
            WITH entrevistas_ordenadas AS (
                SELECT
                    id_teste,
                    id_registro,
                    id_entrevista,
                    id_processo,
                    id_processo_ref,
                    data_entrevista,
                    status_entrevista,
                    link_agendamento,
                    observacoes_rh,
                    mensagem_base,
                    ROW_NUMBER() OVER (
                        PARTITION BY id_teste
                        ORDER BY data_entrevista DESC, id_entrevista DESC
                    ) AS ordem
                FROM entrevistas_agendadas
                WHERE ISNULL(id_teste, '') <> ''
            )
            SELECT
                id_teste,
                id_registro,
                id_entrevista,
                id_processo,
                id_processo_ref,
                data_entrevista,
                status_entrevista,
                link_agendamento,
                observacoes_rh,
                mensagem_base
            FROM entrevistas_ordenadas
            WHERE ordem = 1
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return {
            normalize_text(item.get("id_teste")): item
            for item in rows
            if normalize_text(item.get("id_teste"))
        }

    def _attach_process_context(self, cursor, rows: list[dict], *, timestamp_fields: list[str]) -> list[dict]:
        # Achado PERF-001/S-19: antes, 1 SELECT por linha de `rows` (N+1) —
        # aqui, no máximo 1 SELECT por id_processo DISTINTO entre as linhas
        # (normalmente 1 único processo numa tela de Kanban filtrada).
        unique_process_ids = {
            normalize_text(item.get("id_processo"))
            for item in rows
            if normalize_text(item.get("id_processo"))
        }
        process_rows_by_id = {
            process_id: get_process_rows(cursor, process_id) for process_id in unique_process_ids
        }

        for item in rows:
            process_id = normalize_text(item.get("id_processo"))
            process_row = _select_process_row_from_rows(
                process_rows_by_id.get(process_id, []),
                process_ref=item.get("id_processo_ref", ""),
                timestamp_values=[item.get(field_name) for field_name in timestamp_fields],
            )

            if process_row:
                item["id_processo_ref"] = normalize_text(item.get("id_processo_ref")) or normalize_text(
                    process_row.get("id_processo_ref"),
                )
                item["status_processo"] = normalize_text(process_row.get("status"))
                item["link_agendamento_processo"] = normalize_text(process_row.get("link_agendamento"))
            else:
                item["id_processo_ref"] = normalize_text(item.get("id_processo_ref"))
                item["status_processo"] = normalize_text(item.get("status_processo"))
                item["link_agendamento_processo"] = normalize_text(item.get("link_agendamento_processo"))

        return rows

    def _enrich_candidate_records(self, cursor, candidates: list[dict]) -> list[dict]:
        profile_map = self._get_candidate_profile_map(cursor)
        interview_map = self._get_latest_interview_map(cursor)
        cv_contact_map = self._get_cv_contact_map(cursor)
        cv_map = self._get_candidate_cv_map(cursor)
        pre_analysis_cv_map = self._get_pre_analysis_cv_map(cursor)
        history_result_map = self._get_history_result_map(cursor)
        generated_exam_maps = self._get_generated_exam_status_maps(cursor)

        for candidate in candidates:
            id_teste = normalize_text(candidate.get("id_teste"))
            id_registro = int(candidate.get("id_registro") or 0)
            process_refs = {
                normalize_text(candidate.get("id_processo_ref")),
                normalize_text(candidate.get("id_processo")),
            }
            profile = profile_map.get(id_teste, {})
            latest_interview = interview_map.get(id_teste, {})
            contato_cv = cv_contact_map.get(id_teste, {})
            cv_attachment = cv_map.get(id_teste, {}) or pre_analysis_cv_map.get(id_teste, {})
            history_result = self._select_history_result_for_candidate(
                candidate,
                history_result_map.get(id_teste, []),
            )
            generated_exam = {}
            if id_registro:
                generated_exam = generated_exam_maps["by_registro"].get(id_registro, {})
            if not generated_exam and id_teste:
                for process_ref in process_refs:
                    if process_ref:
                        generated_exam = generated_exam_maps["by_candidate_process"].get(f"{id_teste}@@{process_ref}", {})
                        if generated_exam:
                            break
            if not generated_exam and id_teste:
                generated_exam = generated_exam_maps["by_teste"].get(id_teste, {})
            raw_candidate_status = normalize_text(candidate.get("status_candidato"))
            raw_interview_status = normalize_text(latest_interview.get("status_entrevista"))
            candidate_status = canonicalize_candidate_status(raw_candidate_status)
            interview_status = (
                canonicalize_candidate_status(raw_interview_status)
                if raw_interview_status
                else ""
            )

            candidate["tags"] = profile.get("tags", [])
            candidate["habilidades"] = profile.get("habilidades", [])
            candidate["observacao_rh"] = profile.get("observacao_rh", "")
            candidate["classificacao_indicacao"] = profile.get("classificacao_indicacao", "")
            candidate["justificativa_indicacao"] = profile.get("justificativa_indicacao", "")
            candidate["nome_candidato"] = (
                profile.get("nome_candidato", "")
                or normalize_text(candidate.get("nome_candidato"))
                or contato_cv.get("nome_candidato", "")
            )
            candidate["status_candidato"] = candidate_status
            candidate["status_entrevista"] = interview_status
            candidate["status_fluxo"] = get_candidate_visible_status(candidate_status, interview_status)
            candidate["data_entrevista"] = latest_interview.get("data_entrevista")
            candidate["link_entrevista"] = normalize_text(latest_interview.get("link_agendamento"))
            candidate["observacoes_entrevista"] = normalize_text(latest_interview.get("observacoes_rh"))
            candidate["mensagem_entrevista"] = normalize_text(latest_interview.get("mensagem_base"))
            candidate["id_entrevista"] = latest_interview.get("id_entrevista")
            candidate["email"] = (
                profile.get("email", "")
                or normalize_text(candidate.get("email"))
                or contato_cv.get("email", "")
            )
            candidate["telefone"] = (
                profile.get("telefone", "")
                or normalize_text(candidate.get("telefone"))
                or contato_cv.get("telefone", "")
            )
            candidate["whatsapp"] = (
                profile.get("whatsapp", "")
                or normalize_text(candidate.get("whatsapp"))
                or contato_cv.get("whatsapp", "")
            )
            candidate["cep"] = profile.get("cep", "") or normalize_text(candidate.get("cep"))
            candidate["endereco"] = profile.get("endereco", "") or normalize_text(candidate.get("endereco"))
            candidate["numero"] = profile.get("numero", "") or normalize_text(candidate.get("numero"))
            candidate["cidade"] = profile.get("cidade", "") or normalize_text(candidate.get("cidade"))
            candidate["bairro"] = profile.get("bairro", "") or normalize_text(candidate.get("bairro"))
            candidate["idade"] = profile.get("idade") or candidate.get("idade")
            candidate["escolaridade"] = profile.get("escolaridade", "") or normalize_text(candidate.get("escolaridade"))
            candidate["eh_indicacao"] = bool(candidate.get("eh_indicacao"))
            candidate["tipo_indicacao"] = normalize_text(candidate.get("tipo_indicacao"))
            candidate["cv_disponivel"] = bool(normalize_text(cv_attachment.get("caminho_arquivo")))
            candidate["cv_nome_arquivo"] = normalize_text(cv_attachment.get("nome_arquivo_original"))
            candidate["cv_tipo_arquivo"] = normalize_text(cv_attachment.get("tipo_arquivo"))
            candidate["cv_tamanho_bytes"] = cv_attachment.get("tamanho_bytes")
            candidate["cv_score_final"] = cv_attachment.get("score_final")
            candidate["cv_classificacao"] = normalize_text(cv_attachment.get("classificacao"))
            history_score = normalize_text(history_result.get("pontuacao_final"))
            generated_score = normalize_text(generated_exam.get("nota_final_prova"))
            if not generated_score:
                generated_score = normalize_text(candidate.get("nota_final_prova"))
            if history_score and not normalize_text(candidate.get("pontuacao_final")):
                candidate["pontuacao_final"] = history_score
            elif generated_score and not normalize_text(candidate.get("pontuacao_final")):
                candidate["pontuacao_final"] = generated_score

            origin_normalized = normalize_compare_text(candidate.get("origem"))
            has_history_score = bool(history_score)
            has_generated_score = bool(generated_score)
            has_process_score = bool(normalize_text(candidate.get("pontuacao_final")))
            id_is_cv = id_teste.upper().startswith("CV-")
            has_real_proof = has_history_score or has_generated_score or (
                has_process_score
                and not id_is_cv
                and "pre analise" not in origin_normalized
                and "pre-analise" not in origin_normalized
            )
            candidate["nota_prova"] = (
                history_score
                or generated_score
                or (normalize_text(candidate.get("pontuacao_final")) if has_real_proof else "")
            )
            candidate["prova_disponivel"] = bool(has_real_proof)
            candidate["id_teste_prova"] = id_teste if has_real_proof else ""
            candidate["data_prova_realizada"] = (
                history_result.get("data_iso")
                or generated_exam.get("finalizada_em")
                or candidate.get("data_prova")
            )
            candidate["status_prova"] = (
                normalize_text(history_result.get("status"))
                or normalize_text(generated_exam.get("status"))
                or normalize_text(candidate.get("status_prova"))
            )
            candidate["tem_prova_gerada"] = bool(generated_exam)
            candidate["id_prova_gerada"] = generated_exam.get("id_prova") if generated_exam else None
            candidate["status_prova_gerada"] = normalize_text(generated_exam.get("status")) if generated_exam else ""
            candidate["codigo_prova_gerada"] = normalize_text(generated_exam.get("codigo_acesso")) if generated_exam else ""
            candidate["data_prova_gerada"] = generated_exam.get("gerada_em") if generated_exam else None
            candidate["prova_iniciada_em"] = generated_exam.get("iniciada_em") if generated_exam else None
            candidate["prova_finalizada_em"] = generated_exam.get("finalizada_em") if generated_exam else None
            candidate["prova_cancelada_em"] = generated_exam.get("cancelada_em") if generated_exam else None
            candidate["etapas_prova_json"] = (
                normalize_text(history_result.get("etapas_json"))
                or normalize_text(generated_exam.get("resumo_etapas_json"))
                or normalize_text(candidate.get("etapas_prova_json"))
            )
            candidate["origem_rotulo"] = self._format_candidate_origin(candidate)

        return candidates

    def _upsert_candidate_profile(
        self,
        cursor,
        *,
        id_teste: str,
        nome_candidato: str = "",
        habilidades: list[str] | None = None,
        tags: list[str] | None = None,
        observacao_rh: str | None = None,
        classificacao_indicacao: str | None = None,
        justificativa_indicacao: str | None = None,
        email: str | None = None,
        telefone: str | None = None,
        whatsapp: str | None = None,
        cep: str | None = None,
        endereco: str | None = None,
        numero: str | None = None,
        cidade: str | None = None,
        bairro: str | None = None,
        idade: int | None = None,
        data_nascimento: str | None = None,
        escolaridade: str | None = None,
        possui_experiencia: str | None = None,
        musica: str | None = None,
        prato: str | None = None,
        futebol: str | None = None,
        time: str | None = None,
        rede_social: str | None = None,
        lgpd_consentimento_novo: bool = False,
        lgpd_consentimento_versao: str | None = None,
        lgpd_consentimento_ip: str | None = None,
    ) -> None:
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            return

        ensure_candidate_metadata_table(cursor)
        ensure_candidate_metadata_columns(cursor)
        cursor.execute(
            """
            SELECT
                nome_candidato,
                habilidades_json,
                tags_json,
                observacao_rh,
                classificacao_indicacao,
                justificativa_indicacao,
                email,
                telefone,
                whatsapp,
                cep,
                endereco,
                numero,
                cidade,
                bairro,
                idade,
                data_nascimento,
                escolaridade,
                possui_experiencia,
                musica,
                prato,
                futebol,
                time,
                rede_social,
                lgpd_consentimento_aceito_em,
                lgpd_consentimento_versao,
                lgpd_consentimento_ip,
                atualizado_em
            FROM candidatos_metadata
            WHERE id_teste = ?
            """,
            (safe_id_teste,),
        )
        existing_rows = rows_to_dicts(cursor, cursor.fetchall())
        existing = existing_rows[0] if existing_rows else None
        existing_profile = self._serialize_candidate_profile(existing)

        merged_name = normalize_text(nome_candidato) or existing_profile.get("nome_candidato", "")
        merged_skills = normalize_string_list(habilidades if habilidades is not None else existing_profile.get("habilidades", []))
        merged_tags = normalize_string_list(tags if tags is not None else existing_profile.get("tags", []))
        merged_observation = (
            normalize_text(observacao_rh)
            if observacao_rh is not None
            else existing_profile.get("observacao_rh", "")
        )
        merged_recommendation = (
            normalize_text(classificacao_indicacao)
            if classificacao_indicacao is not None
            else existing_profile.get("classificacao_indicacao", "")
        )
        merged_justification = (
            normalize_text(justificativa_indicacao)
            if justificativa_indicacao is not None
            else existing_profile.get("justificativa_indicacao", "")
        )
        merged_email = normalize_text(email) if email is not None else existing_profile.get("email", "")
        merged_phone = normalize_text(telefone) if telefone is not None else existing_profile.get("telefone", "")
        merged_whatsapp = normalize_text(whatsapp) if whatsapp is not None else existing_profile.get("whatsapp", "")
        merged_cep = normalize_text(cep) if cep is not None else existing_profile.get("cep", "")
        merged_address = normalize_text(endereco) if endereco is not None else existing_profile.get("endereco", "")
        merged_number = normalize_text(numero) if numero is not None else existing_profile.get("numero", "")
        merged_city = normalize_text(cidade) if cidade is not None else existing_profile.get("cidade", "")
        merged_neighborhood = normalize_text(bairro) if bairro is not None else existing_profile.get("bairro", "")
        merged_age = idade if idade is not None else existing_profile.get("idade")
        merged_birth_date = (
            normalize_text(data_nascimento) or None
            if data_nascimento is not None
            else (existing_profile.get("data_nascimento") or None)
        )
        merged_education = normalize_text(escolaridade) if escolaridade is not None else existing_profile.get("escolaridade", "")
        merged_experience = normalize_text(possui_experiencia) if possui_experiencia is not None else existing_profile.get("possui_experiencia", "")
        merged_music = normalize_text(musica) if musica is not None else existing_profile.get("musica", "")
        merged_dish = normalize_text(prato) if prato is not None else existing_profile.get("prato", "")
        merged_soccer = normalize_text(futebol) if futebol is not None else existing_profile.get("futebol", "")
        merged_team = normalize_text(time) if time is not None else existing_profile.get("time", "")
        merged_social = normalize_text(rede_social) if rede_social is not None else existing_profile.get("rede_social", "")

        # Consentimento LGPD (achado SEC-003): só grava um novo registro
        # quando esta chamada representa um aceite explícito e novo (fluxo de
        # candidatura pública). Chamadas internas de edição de perfil (RH
        # editando ficha, por exemplo) não passam lgpd_consentimento_novo e
        # preservam o que já estiver gravado, sem apagar consentimento real.
        if lgpd_consentimento_novo:
            merged_lgpd_aceito_em = datetime.now()
            merged_lgpd_versao = normalize_text(lgpd_consentimento_versao) or "1.0"
            merged_lgpd_ip = normalize_text(lgpd_consentimento_ip)
        else:
            merged_lgpd_aceito_em = existing.get("lgpd_consentimento_aceito_em") if existing else None
            merged_lgpd_versao = normalize_text(existing.get("lgpd_consentimento_versao")) if existing else ""
            merged_lgpd_ip = normalize_text(existing.get("lgpd_consentimento_ip")) if existing else ""

        if existing:
            cursor.execute(
                """
                UPDATE candidatos_metadata
                SET
                    nome_candidato = ?,
                    habilidades_json = ?,
                    tags_json = ?,
                    observacao_rh = ?,
                    classificacao_indicacao = ?,
                    justificativa_indicacao = ?,
                    email = ?,
                    telefone = ?,
                    whatsapp = ?,
                    cep = ?,
                    endereco = ?,
                    numero = ?,
                    cidade = ?,
                    bairro = ?,
                    idade = ?,
                    data_nascimento = ?,
                    escolaridade = ?,
                    possui_experiencia = ?,
                    musica = ?,
                    prato = ?,
                    futebol = ?,
                    time = ?,
                    rede_social = ?,
                    lgpd_consentimento_aceito_em = ?,
                    lgpd_consentimento_versao = ?,
                    lgpd_consentimento_ip = ?,
                    atualizado_em = GETDATE()
                WHERE id_teste = ?
                """,
                (
                    merged_name,
                    json.dumps(merged_skills, ensure_ascii=False),
                    json.dumps(merged_tags, ensure_ascii=False),
                    merged_observation,
                    merged_recommendation,
                    merged_justification,
                    merged_email,
                    merged_phone,
                    merged_whatsapp,
                    merged_cep,
                    merged_address,
                    merged_number,
                    merged_city,
                    merged_neighborhood,
                    merged_age,
                    merged_birth_date,
                    merged_education,
                    merged_experience,
                    merged_music,
                    merged_dish,
                    merged_soccer,
                    merged_team,
                    merged_social,
                    merged_lgpd_aceito_em,
                    merged_lgpd_versao,
                    merged_lgpd_ip,
                    safe_id_teste,
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO candidatos_metadata
                (
                    id_teste,
                    nome_candidato,
                    habilidades_json,
                    tags_json,
                    observacao_rh,
                    classificacao_indicacao,
                    justificativa_indicacao,
                    email,
                    telefone,
                    whatsapp,
                    cep,
                    endereco,
                    numero,
                    cidade,
                    bairro,
                    idade,
                    data_nascimento,
                    escolaridade,
                    possui_experiencia,
                    musica,
                    prato,
                    futebol,
                    time,
                    rede_social,
                    lgpd_consentimento_aceito_em,
                    lgpd_consentimento_versao,
                    lgpd_consentimento_ip
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    safe_id_teste,
                    merged_name,
                    json.dumps(merged_skills, ensure_ascii=False),
                    json.dumps(merged_tags, ensure_ascii=False),
                    merged_observation,
                    merged_recommendation,
                    merged_justification,
                    merged_email,
                    merged_phone,
                    merged_whatsapp,
                    merged_cep,
                    merged_address,
                    merged_number,
                    merged_city,
                    merged_neighborhood,
                    merged_age,
                    merged_birth_date,
                    merged_education,
                    merged_experience,
                    merged_music,
                    merged_dish,
                    merged_soccer,
                    merged_team,
                    merged_social,
                    merged_lgpd_aceito_em,
                    merged_lgpd_versao,
                    merged_lgpd_ip,
                ),
            )

    def anonymize_candidate(self, id_teste: str) -> dict:
        """Achado SEC-003: implementa de fato a rota atrás da permissão
        `candidatos.anonimizar`/`lgpd.anonimizar`, que já existia no RBAC sem
        nenhuma capacidade real por trás.

        Escopo desta versão: anonimiza o registro de UM `id_teste` (uma
        candidatura/ficha), o mesmo identificador usado em todo o resto do
        sistema para localizar um candidato (`get_candidate_sheet`,
        `download_candidate_cv` etc.). Se a mesma pessoa tiver mais de uma
        candidatura (outro `id_teste`, mesmo e-mail), cada uma precisa ser
        anonimizada separadamente — consolidar isso automaticamente por e-mail
        é um passo futuro, não implementado aqui para não arriscar apagar o
        registro errado por coincidência de e-mail.

        Preserva: id_teste, datas de auditoria e o próprio registro de
        consentimento LGPD (data/versão/IP) — a evidência de que o
        consentimento existiu é, ela própria, parte da conformidade.
        Remove/anonimiza: todo dado pessoal identificável e o currículo
        anexado (referência no banco; o arquivo físico no repositório de
        documentos, se houver, não é removido por esta rotina).
        """
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador do candidato é obrigatório.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_candidate_metadata_table(cursor)
            ensure_candidate_metadata_columns(cursor)
            ensure_candidate_attachments_table(cursor)

            cursor.execute(
                "SELECT lgpd_anonimizado_em FROM candidatos_metadata WHERE id_teste = ?",
                (safe_id_teste,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado.")
            if row[0] is not None:
                return {"success": True, "id_teste": safe_id_teste, "already_anonymized": True}

            anonymized_name = "Candidato anonimizado"
            cursor.execute(
                """
                UPDATE candidatos_metadata
                SET
                    nome_candidato = ?,
                    habilidades_json = N'[]',
                    tags_json = N'[]',
                    observacao_rh = N'',
                    classificacao_indicacao = N'',
                    justificativa_indicacao = N'',
                    email = N'',
                    telefone = N'',
                    whatsapp = N'',
                    cep = N'',
                    endereco = N'',
                    numero = N'',
                    cidade = N'',
                    bairro = N'',
                    idade = NULL,
                    data_nascimento = NULL,
                    escolaridade = N'',
                    possui_experiencia = N'',
                    musica = N'',
                    prato = N'',
                    futebol = N'',
                    time = N'',
                    rede_social = N'',
                    lgpd_anonimizado_em = GETDATE(),
                    atualizado_em = GETDATE()
                WHERE id_teste = ?
                """,
                (anonymized_name, safe_id_teste),
            )
            cursor.execute(
                "UPDATE candidatos_processos SET nome_candidato = ? WHERE id_teste = ?",
                (anonymized_name, safe_id_teste),
            )
            cursor.execute(
                "DELETE FROM candidatos_anexos WHERE id_teste = ?",
                (safe_id_teste,),
            )
            conn.commit()
            return {"success": True, "id_teste": safe_id_teste, "already_anonymized": False}
        finally:
            conn.close()

    def _sync_candidate_identity_copies(
        self,
        cursor,
        *,
        id_teste: str,
        nome_candidato: str = "",
        email: str | None = None,
        telefone: str | None = None,
        whatsapp: str | None = None,
    ) -> None:
        safe_id_teste = normalize_text(id_teste)
        safe_name = normalize_text(nome_candidato)
        if not safe_id_teste:
            return

        if safe_name:
            for table_name in (
                "candidatos_processos",
                "banco_talentos",
                "entrevistas_agendadas",
                "historico_provas",
            ):
                cursor.execute(
                    f"""
                    IF OBJECT_ID('dbo.{table_name}', 'U') IS NOT NULL
                    BEGIN
                        UPDATE dbo.{table_name}
                        SET nome_candidato = ?
                        WHERE id_teste = ?
                    END
                    """,
                    (safe_name, safe_id_teste),
                )

        if safe_id_teste.startswith("CV-"):
            id_pre_analise = safe_id_teste[3:]
            if id_pre_analise.isdigit():
                update_fields = []
                params = []
                if safe_name:
                    update_fields.append("nome_candidato = ?")
                    params.append(safe_name)
                if email is not None:
                    update_fields.append("email = ?")
                    params.append(normalize_text(email))
                if telefone is not None:
                    update_fields.append("telefone = ?")
                    params.append(normalize_text(telefone))
                if whatsapp is not None:
                    update_fields.append("whatsapp = ?")
                    params.append(normalize_text(whatsapp))

                if update_fields:
                    params.append(int(id_pre_analise))
                    cursor.execute(
                        f"""
                        IF OBJECT_ID('dbo.cv_pre_analises', 'U') IS NOT NULL
                        BEGIN
                            UPDATE dbo.cv_pre_analises
                            SET {", ".join(update_fields)}
                            WHERE id_pre_analise = ?
                        END
                        """,
                        tuple(params),
                    )

    def _hydrate_pipeline_fields(self, cursor, candidates: list[dict]) -> list[dict]:
        # Achado PERF-001/S-19: antes, 1 UPDATE por candidato desalinhado
        # (N+1 de escrita dentro de uma rota de leitura). Agora, no máximo 1
        # UPDATE por etapa de pipeline distinta (há só 5 etapas possíveis —
        # ver PIPELINE_STAGES), usando `WHERE id_registro IN (...)`.
        now = datetime.now()
        ids_by_target_stage: dict[str, list[int]] = {}

        for candidate in candidates:
            inferred_stage = infer_pipeline_stage(
                candidate.get("status_candidato"),
                candidate.get("origem"),
                candidate.get("etapa_pipeline"),
            )
            current_stage = normalize_text(candidate.get("etapa_pipeline"))
            if current_stage != inferred_stage:
                ids_by_target_stage.setdefault(inferred_stage, []).append(int(candidate.get("id_registro") or 0))
                candidate["etapa_pipeline"] = inferred_stage
                candidate["data_atualizacao_pipeline"] = now.isoformat()
            else:
                candidate["etapa_pipeline"] = inferred_stage

        for target_stage, ids in ids_by_target_stage.items():
            placeholders = ", ".join("?" for _ in ids)
            cursor.execute(
                f"""
                UPDATE candidatos_processos
                SET etapa_pipeline = ?, data_atualizacao_pipeline = ?
                WHERE id_registro IN ({placeholders})
                """,
                (target_stage, now, *ids),
            )

        if ids_by_target_stage:
            cursor.connection.commit()

        return candidates

    def _get_process_map(self, cursor) -> dict[str, dict]:
        ensure_process_reference_columns(cursor)
        cursor.execute(
            """
            SELECT
                id_processo,
                vaga,
                quantidade_vagas,
                vagas_preenchidas,
                data_encerramento,
                operacao,
                trilha,
                usa_nota_corte,
                nota_corte,
                status,
                data_criacao,
                link_agendamento
            FROM processos_seletivos
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        result = {}
        for item in sort_process_rows(rows):
            process_id = normalize_text(item.get("id_processo"))
            process_ref = normalize_text(item.get("id_processo_ref"))
            if process_ref:
                result[process_ref] = item
            if process_id and process_id not in result:
                result[process_id] = item
        return result

    def _get_process_candidate_map(self, cursor) -> dict[str, dict]:
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
                data_atualizacao_pipeline,
                aprovado_em,
                eliminado_em,
                motivo_eliminacao,
                etapa_eliminacao,
                eh_indicacao,
                tipo_indicacao
            FROM candidatos_processos
            """
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        rows = self._hydrate_pipeline_fields(cursor, rows)
        rows = self._enrich_candidate_records(cursor, rows)
        rows = self._attach_process_context(
            cursor,
            rows,
            timestamp_fields=["data_prova", "data_atualizacao_pipeline", "aprovado_em", "eliminado_em"],
        )

        result = {}
        for item in rows:
            id_teste = normalize_text(item.get("id_teste"))
            if id_teste:
                result[id_teste] = item
        return result

    def _find_talent_bank_duplicate_id(
        self,
        cursor,
        *,
        id_teste: str = "",
        email: str = "",
        telefone: str = "",
        whatsapp: str = "",
        codigo_acesso: str = "",
        nome_candidato: str = "",
        vaga: str = "",
        origem: str = "",
    ) -> int | None:
        safe_id_teste = normalize_text(id_teste)
        safe_codigo = normalize_text(codigo_acesso).upper()
        safe_email = normalize_compare_text(email)
        safe_name = normalize_compare_text(nome_candidato)
        safe_vacancy = normalize_compare_text(vaga)
        safe_origin = normalize_compare_text(origem)

        def only_digits(value: str) -> str:
            digits = re.sub(r"\D", "", normalize_text(value))
            if digits.startswith("55") and len(digits) in (12, 13):
                return digits[2:]
            return digits

        safe_phones = {
            only_digits(item)
            for item in (telefone, whatsapp)
            if only_digits(item)
        }

        ensure_talent_bank_table(cursor)
        generated_exam_ids = set()
        if safe_codigo:
            cursor.execute(
                """
                IF OBJECT_ID('dbo.provas_geradas', 'U') IS NULL
                BEGIN
                    SELECT NULL
                END
                ELSE
                BEGIN
                    SELECT id_teste
                    FROM dbo.provas_geradas
                    WHERE UPPER(codigo_acesso) = ?
                       OR CONVERT(NVARCHAR(50), id_prova) = ?
                END
                """,
                (safe_codigo, safe_codigo),
            )
            generated_exam_ids = {
                normalize_text(row[0])
                for row in cursor.fetchall()
                if normalize_text(row[0])
            }

        ensure_candidate_metadata_table(cursor)
        cursor.execute(
            """
            SELECT
                banco.id_banco,
                banco.id_teste,
                banco.nome_candidato,
                banco.vaga,
                banco.origem,
                meta.email,
                meta.telefone,
                meta.whatsapp
            FROM banco_talentos banco
            LEFT JOIN candidatos_metadata meta
                ON meta.id_teste = banco.id_teste
            """
        )
        for row in rows_to_dicts(cursor, cursor.fetchall()):
            id_banco = int(row.get("id_banco") or 0)
            if not id_banco:
                continue
            if safe_id_teste and normalize_text(row.get("id_teste")) == safe_id_teste:
                return id_banco

            if safe_codigo and normalize_text(row.get("id_teste")).upper() == safe_codigo:
                return id_banco

            if generated_exam_ids and normalize_text(row.get("id_teste")) in generated_exam_ids:
                return id_banco

            row_email = normalize_compare_text(row.get("email"))
            if safe_email and row_email == safe_email:
                return id_banco

            row_phones = {
                only_digits(row.get("telefone")),
                only_digits(row.get("whatsapp")),
            }
            row_phones.discard("")
            if safe_phones and row_phones.intersection(safe_phones):
                return id_banco

            row_name = normalize_compare_text(row.get("nome_candidato"))
            row_vacancy = normalize_compare_text(row.get("vaga"))
            row_origin = normalize_compare_text(row.get("origem"))
            if (
                safe_name
                and row_name == safe_name
                and (not safe_vacancy or not row_vacancy or row_vacancy == safe_vacancy)
                and (not safe_origin or not row_origin or row_origin == safe_origin)
            ):
                return id_banco

        return None

    def _insert_talent_bank_record(self, cursor, data: dict) -> int:
        ensure_talent_bank_table(cursor)

        columns = [
            "id_processo",
            "id_processo_ref",
            "id_teste",
            "nome_candidato",
            "vaga",
            "pontuacao_final",
            "data_movimentacao",
            "origem",
            "eh_indicacao",
            "tipo_indicacao",
            "indicacao_em",
        ]
        indication_type = normalize_indication_type(data.get("tipo_indicacao"))
        is_indication = bool(data.get("eh_indicacao")) or bool(indication_type)
        values = [
            data.get("id_processo", ""),
            data.get("id_processo_ref", ""),
            data.get("id_teste", ""),
            data.get("nome_candidato", ""),
            data.get("vaga", ""),
            data.get("pontuacao_final", ""),
            data.get("data_movimentacao") or datetime.now().isoformat(),
            data.get("origem", ""),
            1 if is_indication else 0,
            indication_type,
            datetime.now() if is_indication else None,
        ]

        id_banco = None
        if not is_identity_column(cursor, "banco_talentos", "id_banco"):
            id_banco = get_next_id_banco(cursor)
            columns.insert(0, "id_banco")
            values.insert(0, id_banco)

        placeholders = ", ".join("?" for _ in columns)
        cursor.execute(
            f"""
            INSERT INTO banco_talentos
            (
                {", ".join(columns)}
            )
            OUTPUT INSERTED.id_banco
            VALUES ({placeholders})
            """,
            tuple(values),
        )
        inserted_row = cursor.fetchone()
        return int(inserted_row[0] or id_banco or 0)

    def _get_answer_files_map(self, cursor) -> dict[str, dict]:
        payload_column = get_gabaritos_payload_column(cursor)
        cursor.execute(f"SELECT record_id, {payload_column} FROM gabaritos")
        rows = cursor.fetchall()
        result = {}
        for row in rows:
            record_id = normalize_text(row[0])
            if record_id:
                result[record_id] = safe_json_loads(row[1], {})
        return result

    def _record_candidate_movement(
        self,
        cursor,
        *,
        id_teste: str = "",
        id_registro: int | None = None,
        id_processo: str = "",
        id_processo_ref: str = "",
        nome_candidato: str = "",
        vaga: str = "",
        origem_inicial: str = "",
        tipo_movimentacao: str = "",
        status_anterior: str = "",
        status_novo: str = "",
        observacao: str = "",
        usuario_responsavel: str = "",
        processo_destino: str = "",
    ) -> None:
        ensure_candidate_movements_table(cursor)
        cursor.execute(
            """
            INSERT INTO candidatos_movimentacoes
            (
                id_teste,
                id_registro,
                id_processo,
                id_processo_ref,
                nome_candidato,
                vaga,
                origem_inicial,
                tipo_movimentacao,
                status_anterior,
                status_novo,
                observacao,
                usuario_responsavel,
                processo_destino,
                criado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
            """,
            (
                normalize_text(id_teste),
                int(id_registro or 0) or None,
                normalize_text(id_processo),
                normalize_text(id_processo_ref),
                normalize_text(nome_candidato),
                normalize_text(vaga),
                normalize_text(origem_inicial),
                normalize_text(tipo_movimentacao),
                normalize_text(status_anterior),
                normalize_text(status_novo),
                normalize_text(observacao),
                normalize_text(usuario_responsavel),
                normalize_text(processo_destino),
            ),
        )

    def _get_candidate_movements_map(self, cursor) -> dict[str, list[dict]]:
        ensure_candidate_movements_table(cursor)
        cursor.execute(
            """
            SELECT
                id_teste,
                id_registro,
                id_processo,
                id_processo_ref,
                nome_candidato,
                vaga,
                origem_inicial,
                tipo_movimentacao,
                status_anterior,
                status_novo,
                observacao,
                usuario_responsavel,
                processo_destino,
                criado_em
            FROM candidatos_movimentacoes
            ORDER BY criado_em DESC, id_movimentacao DESC
            """
        )
        result: dict[str, list[dict]] = {}
        for row in rows_to_dicts(cursor, cursor.fetchall()):
            id_teste = normalize_text(row.get("id_teste"))
            if not id_teste:
                continue
            result.setdefault(id_teste, []).append(row)
        return result

    def _summarize_candidate_movements(
        self,
        item: dict,
        movements: list[dict] | None = None,
    ) -> dict:
        safe_movements = movements or []
        ordered = list(reversed(safe_movements))
        descriptions = []
        first = ordered[0] if ordered else {}
        last = ordered[-1] if ordered else {}

        for movement in ordered:
            movement_type = normalize_text(movement.get("tipo_movimentacao")) or "Movimentacao"
            old_status = normalize_text(movement.get("status_anterior"))
            new_status = normalize_text(movement.get("status_novo"))
            detail = movement_type
            if old_status or new_status:
                detail = f"{detail}: {old_status or '-'} -> {new_status or '-'}"
            if normalize_text(movement.get("processo_destino")):
                detail = f"{detail} ({movement.get('processo_destino')})"
            descriptions.append(detail)

        if not descriptions:
            origem = self._format_candidate_origin(item)
            descriptions.append(f"Candidato criado por {origem}")
            if normalize_text(item.get("nota_prova") or item.get("pontuacao_final")) and item.get("prova_disponivel"):
                descriptions.append("Prova realizada")
            status_atual = canonicalize_candidate_status(item.get("status_candidato"))
            if status_atual == CANDIDATE_STATUS_APPROVED:
                descriptions.append("Candidato aprovado")
            elif status_atual == CANDIDATE_STATUS_ELIMINATED:
                descriptions.append("Candidato eliminado")
            elif status_atual == CANDIDATE_STATUS_TALENT_BANK:
                descriptions.append("Candidato enviado para Banco de Talentos")

        return {
            "origem_inicial": normalize_text(first.get("origem_inicial")) or self._format_candidate_origin(item),
            "movimentacoes": " | ".join(descriptions),
            "data_movimentacao": last.get("criado_em") if last else item.get("data_atualizacao_pipeline") or item.get("data_prova"),
            "status_anterior": normalize_text(last.get("status_anterior")) if last else "",
            "status_novo": normalize_text(last.get("status_novo")) if last else canonicalize_candidate_status(item.get("status_candidato")),
            "usuario_responsavel": normalize_text(last.get("usuario_responsavel")) if last else "",
            "observacao_motivo": normalize_text(last.get("observacao")) if last else "",
            "processo_destino": normalize_text(last.get("processo_destino")) if last else "",
        }

    def _candidate_has_exam_in_progress(self, cursor, id_teste: str) -> bool:
        """Correções.txt item 4: uma vez que o candidato já iniciou a prova
        (id_teste vincula candidatos_processos <-> provas_geradas), nenhuma
        movimentação de pipeline pode mexer nele — eliminar, aprovar, mover
        para banco de talentos ou reagendar a entrevista invalidaria uma prova
        em andamento. Checamos status = 'Em andamento' (não um NOT IN mais
        amplo) porque register_rh_decision() também passa por
        _apply_candidate_status_update() para aprovar/eliminar o candidato
        CONFORME o resultado da prova já finalizada/em avaliação manual — um
        filtro mais amplo bloquearia essa decisão legítima do RH.
        """
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            return False
        cursor.execute(
            """
            SELECT COUNT(1)
            FROM dbo.provas_geradas
            WHERE id_teste = ?
              AND iniciada_em IS NOT NULL
              AND status = 'Em andamento'
            """,
            (safe_id_teste,),
        )
        return bool(int(cursor.fetchone()[0] or 0))

    def _apply_candidate_status_update(
        self,
        cursor,
        *,
        current_row,
        new_status: str,
        new_stage: str,
        data_movimentacao: str | None = None,
        approval_payload: dict | None = None,
    ) -> None:
        id_registro = int(current_row.get("id_registro") or 0)
        id_processo = normalize_text(current_row.get("id_processo"))
        id_processo_ref = normalize_text(current_row.get("id_processo_ref"))
        id_teste = normalize_text(current_row.get("id_teste"))
        nome_candidato = normalize_text(current_row.get("nome_candidato"))
        vaga = normalize_text(current_row.get("vaga"))
        old_status = canonicalize_candidate_status(current_row.get("status_candidato"))
        pontuacao_final = current_row.get("pontuacao_final")
        origem = normalize_text(current_row.get("origem"))
        resolved_new_status = canonicalize_candidate_status(new_status)
        old_status_normalized = normalize_compare_text(old_status)
        new_status_normalized = normalize_compare_text(resolved_new_status)
        payload = approval_payload or {}
        motivo_eliminacao = normalize_text(payload.get("motivo_eliminacao"))
        sub_causa_eliminacao = normalize_text(payload.get("sub_causa_eliminacao"))
        etapa_eliminacao = normalize_text(payload.get("etapa_eliminacao"))

        if is_terminal_candidate_status(old_status):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=build_terminal_candidate_locked_message(old_status),
            )

        if self._candidate_has_exam_in_progress(cursor, id_teste):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este candidato já iniciou a prova e não pode ser movimentado enquanto ela estiver em andamento.",
            )

        if not id_processo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Processo do candidato não encontrado.")

        processo = resolve_process_row_for_related_record(
            cursor,
            id_processo=id_processo,
            id_processo_ref=id_processo_ref,
            timestamp_values=[
                current_row.get("data_prova"),
                current_row.get("data_atualizacao_pipeline"),
                data_movimentacao,
            ],
        )
        if not processo:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo seletivo não encontrado.")
        if is_process_closed(processo.get("status")):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=build_process_closed_message(
                    build_candidate_status_action_label(resolved_new_status),
                    processo.get("id_processo"),
                ),
            )

        data_pipeline = (
            datetime.fromisoformat(str(data_movimentacao).replace("Z", "+00:00"))
            if data_movimentacao
            else datetime.now()
        )

        cursor.execute(
            """
            UPDATE candidatos_processos
            SET
                status_candidato = ?,
                etapa_pipeline = ?,
                data_atualizacao_pipeline = ?,
                id_processo_ref = ?,
                eliminado_em = CASE WHEN ? = ? THEN ISNULL(eliminado_em, GETDATE()) ELSE eliminado_em END,
                motivo_eliminacao = CASE WHEN ? = ? THEN ? ELSE motivo_eliminacao END,
                sub_causa_eliminacao = CASE WHEN ? = ? THEN ? ELSE sub_causa_eliminacao END,
                etapa_eliminacao = CASE WHEN ? = ? THEN ? ELSE etapa_eliminacao END,
                banco_talentos_em = CASE WHEN ? = ? THEN ISNULL(banco_talentos_em, GETDATE()) ELSE banco_talentos_em END
            WHERE id_registro = ?
            """,
            (
                resolved_new_status,
                new_stage,
                data_pipeline,
                processo.get("id_processo_ref", ""),
                new_status_normalized,
                normalize_compare_text(CANDIDATE_STATUS_ELIMINATED),
                new_status_normalized,
                normalize_compare_text(CANDIDATE_STATUS_ELIMINATED),
                motivo_eliminacao,
                new_status_normalized,
                normalize_compare_text(CANDIDATE_STATUS_ELIMINATED),
                sub_causa_eliminacao,
                new_status_normalized,
                normalize_compare_text(CANDIDATE_STATUS_ELIMINATED),
                etapa_eliminacao,
                new_status_normalized,
                normalize_compare_text(CANDIDATE_STATUS_TALENT_BANK),
                id_registro,
            ),
        )

        if old_status_normalized != new_status_normalized:
            self._record_candidate_movement(
                cursor,
                id_teste=id_teste,
                id_registro=id_registro,
                id_processo=id_processo,
                id_processo_ref=processo.get("id_processo_ref", ""),
                nome_candidato=nome_candidato,
                vaga=vaga,
                origem_inicial=origem,
                tipo_movimentacao=(
                    "Candidato aprovado"
                    if new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_APPROVED)
                    else "Candidato eliminado"
                    if new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_ELIMINATED)
                    else "Candidato enviado para Banco de Talentos"
                    if new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_TALENT_BANK)
                    else "Status atualizado"
                ),
                status_anterior=old_status,
                status_novo=resolved_new_status,
                observacao=(
                    motivo_eliminacao + (f" | {etapa_eliminacao}" if etapa_eliminacao else "")
                    if new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_ELIMINATED)
                    else normalize_text(payload.get("mensagem_aprovacao"))
                ),
                usuario_responsavel=normalize_text(payload.get("usuario_responsavel")),
            )

        if new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_APPROVED):
            documentos = [
                normalize_text(item)
                for item in (payload.get("documentos_aprovacao") or [])
                if normalize_text(item)
            ]
            cursor.execute(
                """
                UPDATE candidatos_processos
                SET
                    mensagem_aprovacao = ?,
                    data_comparecimento_aprovacao = ?,
                    documentos_aprovacao_json = ?,
                    anexo_aprovacao_nome = ?,
                    anexo_aprovacao_tipo = ?,
                    anexo_aprovacao_tamanho = ?,
                    anexo_aprovacao_base64 = ?,
                    aprovado_em = ISNULL(aprovado_em, GETDATE())
                WHERE id_registro = ?
                """,
                (
                    normalize_text(payload.get("mensagem_aprovacao")),
                    normalize_text(payload.get("data_comparecimento_aprovacao")),
                    json.dumps(documentos, ensure_ascii=False),
                    normalize_text(payload.get("anexo_aprovacao_nome")),
                    normalize_text(payload.get("anexo_aprovacao_tipo")),
                    int(payload.get("anexo_aprovacao_tamanho") or 0),
                    normalize_text(payload.get("anexo_aprovacao_base64")),
                    id_registro,
                ),
            )

        quantidade_vagas = int(processo.get("quantidade_vagas") or 0)
        vagas_preenchidas = int(processo.get("vagas_preenchidas") or 0)
        status_processo = normalize_text(processo.get("status"))

        if old_status_normalized != normalize_compare_text(CANDIDATE_STATUS_APPROVED) and new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_APPROVED):
            vagas_preenchidas += 1
        elif old_status_normalized == normalize_compare_text(CANDIDATE_STATUS_APPROVED) and new_status_normalized != normalize_compare_text(CANDIDATE_STATUS_APPROVED):
            vagas_preenchidas = max(0, vagas_preenchidas - 1)

        where_clause, params = build_process_where_clause(processo)
        cursor.execute(
            f"""
            UPDATE processos_seletivos
            SET vagas_preenchidas = ?
            WHERE {where_clause}
            """,
            (vagas_preenchidas, *params),
        )

        if (
            status_processo not in {PROCESS_STATUS_CLOSED, PROCESS_STATUS_TRAINING}
            and quantidade_vagas > 0
            and vagas_preenchidas >= quantidade_vagas
        ):
            # Pedido do RH: vagas preenchidas não encerram mais o processo —
            # ele vira "Em treinamento" e continua ativo/gerenciável.
            cursor.execute(
                f"""
                UPDATE processos_seletivos
                SET status = ?
                WHERE {where_clause}
                """,
                (PROCESS_STATUS_TRAINING, *params),
            )

        interview_synced_statuses = {
            normalize_compare_text(status_item)
            for status_item in INTERVIEW_OPERATIONAL_STATUSES
        } | {
            normalize_compare_text(CANDIDATE_STATUS_APPROVED),
            normalize_compare_text(CANDIDATE_STATUS_ELIMINATED),
            normalize_compare_text(CANDIDATE_STATUS_TALENT_BANK),
            normalize_compare_text(CANDIDATE_STATUS_WITHDREW),
        }
        if id_teste and new_status_normalized in interview_synced_statuses:
            cursor.execute(
                """
                UPDATE entrevistas_agendadas
                SET
                    status_entrevista = ?,
                    id_processo_ref = ?,
                    atualizado_em = GETDATE()
                WHERE (id_registro = ? AND ? > 0)
                   OR (
                        id_teste = ? AND ISNULL(id_teste, '') <> ''
                        AND (
                            (? <> '' AND ISNULL(id_processo, '') = ?)
                            OR (? <> '' AND ISNULL(id_processo_ref, '') = ?)
                            OR (ISNULL(id_processo, '') = '' AND ISNULL(id_processo_ref, '') = '')
                        )
                      )
                """,
                (
                    resolved_new_status,
                    processo.get("id_processo_ref", ""),
                    id_registro,
                    id_registro,
                    id_teste,
                    id_processo,
                    id_processo,
                    id_processo_ref,
                    id_processo_ref,
                ),
            )

        if new_status_normalized != normalize_compare_text(CANDIDATE_STATUS_TALENT_BANK):
            cursor.execute(
                """
                DELETE FROM banco_talentos
                WHERE id_teste = ?
                  AND (ISNULL(id_processo, '') = ? OR ISNULL(id_processo, '') = '')
                """,
                (id_teste, id_processo),
            )

        if new_status_normalized == normalize_compare_text(CANDIDATE_STATUS_TALENT_BANK):
            profile_map = self._get_candidate_profile_map(cursor)
            profile = profile_map.get(id_teste, {})
            id_banco_existente = self._find_talent_bank_duplicate_id(
                cursor,
                id_teste=id_teste,
                email=profile.get("email", ""),
                telefone=profile.get("telefone", ""),
                whatsapp=profile.get("whatsapp", ""),
                nome_candidato=nome_candidato,
                vaga=vaga,
                origem=origem or "Prova",
            )

            if id_banco_existente:
                cursor.execute(
                    """
                    UPDATE banco_talentos
                    SET
                        id_processo = ?,
                        id_processo_ref = ?,
                        id_teste = ?,
                        nome_candidato = ?,
                        vaga = ?,
                        pontuacao_final = ?,
                        data_movimentacao = ?,
                        origem = ?
                    WHERE id_banco = ?
                    """,
                    (
                        id_processo,
                        processo.get("id_processo_ref", ""),
                        id_teste,
                        nome_candidato,
                        vaga,
                        pontuacao_final,
                        data_movimentacao or datetime.now().isoformat(),
                        origem or "Prova",
                        id_banco_existente,
                    ),
                )
            else:
                self._insert_talent_bank_record(
                    cursor,
                    {
                        "id_processo": id_processo,
                        "id_processo_ref": processo.get("id_processo_ref", ""),
                        "id_teste": id_teste,
                        "nome_candidato": nome_candidato,
                        "vaga": vaga,
                        "pontuacao_final": pontuacao_final,
                        "data_movimentacao": data_movimentacao or datetime.now().isoformat(),
                        "origem": origem or "Prova",
                    },
                )

        # Roadmap "e-mails automáticos por etapa": ponto único de disparo de
        # notificação por mudança de status. Usa uma conexão própria (dentro de
        # disparar_notificacao_por_etapa) e nunca deve interromper a transação
        # de mudança de status em si — por isso é a última coisa feita aqui,
        # depois de todas as escritas relacionadas ao status já terem sido
        # emitidas nesta conexão/cursor.
        #
        # Roadmap "fila de tarefas assíncronas": o disparo (que faz I/O de
        # e-mail/SMTP) é enviado via `enfileirar()` para não bloquear a
        # resposta HTTP da mudança de status. Se o Redis/RQ não estiver
        # disponível, `enfileirar()` executa exatamente a mesma chamada de
        # forma síncrona/imediata — comportamento idêntico ao anterior.
        if old_status_normalized != new_status_normalized and hasattr(self, "disparar_notificacao_por_etapa"):
            enfileirar(
                self.disparar_notificacao_por_etapa,
                candidato={
                    "id_registro": id_registro,
                    "id_teste": id_teste,
                    "nome_candidato": nome_candidato,
                    "vaga": vaga,
                },
                status_anterior=old_status,
                status_novo=resolved_new_status,
                payload=payload,
                usuario_responsavel=normalize_text(payload.get("usuario_responsavel")),
            )

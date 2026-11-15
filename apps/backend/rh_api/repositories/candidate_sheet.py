from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status

from ..services.helpers import (
    calculate_age_from_birth_date,
    normalize_compare_text,
    normalize_text,
    rows_to_dicts,
    safe_json_loads,
)
from .bootstrap import (
    ensure_candidate_attachments_table,
    ensure_candidate_metadata_columns,
    ensure_candidate_metadata_table,
    ensure_candidate_movements_table,
    ensure_cv_pre_analises_table,
    ensure_decimal_process_columns,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    ensure_talent_bank_table,
)

SHEET_RECOMMENDATION_LABELS = {
    "indicado": "Indicado",
    "indicado com restricoes": "Indicado com restrições",
    "contraindicado": "Contraindicado",
}


def normalize_sheet_recommendation(value) -> str:
    safe_value = normalize_text(value)
    if not safe_value:
        return ""

    normalized = normalize_compare_text(safe_value)
    if normalized not in SHEET_RECOMMENDATION_LABELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Classificação da ficha do candidato inválida.",
        )

    return SHEET_RECOMMENDATION_LABELS[normalized]


def _format_value(value) -> str:
    return str(value).strip() if value is not None else ""


def _format_score(value) -> str:
    safe_value = _format_value(value)
    return safe_value or "Não informado"


class CandidateSheetRepositoryMixin:
    def _get_candidate_sheet_profile(self, cursor, id_teste: str) -> dict:
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
                escolaridade,
                possui_experiencia,
                musica,
                prato,
                futebol,
                time,
                rede_social,
                atualizado_em
            FROM candidatos_metadata
            WHERE id_teste = ?
            """,
            (id_teste,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return self._serialize_candidate_profile(rows[0]) if rows else {}

    def _candidate_sheet_exists(self, cursor, id_teste: str) -> bool:
        checks = [
            ("candidatos_metadata", "id_teste"),
            ("candidatos_processos", "id_teste"),
            ("banco_talentos", "id_teste"),
            ("historico_provas", "id_teste"),
        ]

        for table_name, column_name in checks:
            cursor.execute(
                f"""
                IF OBJECT_ID('dbo.{table_name}', 'U') IS NULL
                BEGIN
                    SELECT 0
                END
                ELSE
                BEGIN
                    SELECT CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.{table_name} WHERE {column_name} = ?
                    ) THEN 1 ELSE 0 END
                END
                """,
                (id_teste,),
            )
            row = cursor.fetchone()
            if row and int(row[0] or 0) == 1:
                return True

        if id_teste.upper().startswith("CV-") and id_teste[3:].isdigit():
            ensure_cv_pre_analises_table(cursor)
            cursor.execute(
                """
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM cv_pre_analises WHERE id_pre_analise = ?
                ) THEN 1 ELSE 0 END
                """,
                (int(id_teste[3:]),),
            )
            row = cursor.fetchone()
            return bool(row and int(row[0] or 0) == 1)

        return False

    def _lookup_candidate_sheet_name(self, cursor, id_teste: str) -> str:
        queries = [
            ("candidatos_metadata", "nome_candidato", "atualizado_em DESC"),
            ("candidatos_processos", "nome_candidato", "id_registro DESC"),
            ("banco_talentos", "nome_candidato", "id_banco DESC"),
            ("historico_provas", "nome_candidato", "data_iso DESC"),
        ]

        for table_name, column_name, order_clause in queries:
            cursor.execute(
                f"""
                IF OBJECT_ID('dbo.{table_name}', 'U') IS NULL
                BEGIN
                    SELECT NULL
                END
                ELSE
                BEGIN
                    SELECT TOP 1 {column_name}
                    FROM dbo.{table_name}
                    WHERE id_teste = ?
                    ORDER BY {order_clause}
                END
                """,
                (id_teste,),
            )
            row = cursor.fetchone()
            candidate_name = normalize_text(row[0] if row else "")
            if candidate_name:
                return candidate_name

        return ""

    def _list_candidate_sheet_process_rows(self, cursor, id_teste: str) -> list[dict]:
        ensure_pipeline_columns(cursor)
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
            WHERE id_teste = ?
            ORDER BY data_prova DESC, id_registro DESC
            """,
            (id_teste,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        rows = self._hydrate_pipeline_fields(cursor, rows)
        rows = self._enrich_candidate_records(cursor, rows)
        return self._attach_process_context(
            cursor,
            rows,
            timestamp_fields=["data_prova", "data_atualizacao_pipeline", "aprovado_em", "eliminado_em"],
        )

    def _list_candidate_sheet_bank_rows(self, cursor, id_teste: str) -> list[dict]:
        ensure_talent_bank_table(cursor)
        ensure_process_reference_columns(cursor)
        cursor.execute(
            """
            SELECT
                id_banco,
                id_processo,
                id_processo_ref,
                id_teste,
                nome_candidato,
                vaga,
                pontuacao_final,
                data_movimentacao,
                origem,
                eh_indicacao,
                tipo_indicacao
            FROM banco_talentos
            WHERE id_teste = ?
            ORDER BY data_movimentacao DESC, id_banco DESC
            """,
            (id_teste,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return self._attach_process_context(
            cursor,
            rows,
            timestamp_fields=["data_movimentacao"],
        )

    def _list_candidate_sheet_history_rows(self, cursor, id_teste: str) -> list[dict]:
        ensure_process_reference_columns(cursor)
        ensure_decimal_process_columns(cursor)
        cursor.execute(
            """
            SELECT
                id_teste,
                id_processo,
                id_processo_ref,
                nome_candidato,
                vaga,
                nivel,
                trilha,
                data_iso,
                data_exibicao,
                pontuacao_final,
                status,
                tempo_minutos,
                arquivo_gabarito,
                etapas_json
            FROM historico_provas
            WHERE id_teste = ?
            ORDER BY data_iso DESC, id_teste DESC
            """,
            (id_teste,),
        )
        return rows_to_dicts(cursor, cursor.fetchall())

    def _list_candidate_sheet_interview_rows(self, cursor, id_teste: str) -> list[dict]:
        ensure_process_reference_columns(cursor)
        cursor.execute(
            """
            SELECT
                id_entrevista,
                id_processo,
                id_processo_ref,
                id_teste,
                nome_candidato,
                vaga,
                data_entrevista,
                status_entrevista,
                observacoes_rh
            FROM entrevistas_agendadas
            WHERE id_teste = ?
            ORDER BY data_entrevista DESC, id_entrevista DESC
            """,
            (id_teste,),
        )
        return rows_to_dicts(cursor, cursor.fetchall())

    def _list_candidate_sheet_movement_rows(self, cursor, id_teste: str) -> list[dict]:
        ensure_candidate_movements_table(cursor)
        cursor.execute(
            """
            SELECT
                tipo_movimentacao,
                status_anterior,
                status_novo,
                observacao,
                usuario_responsavel,
                vaga,
                processo_destino,
                criado_em
            FROM candidatos_movimentacoes
            WHERE id_teste = ?
            ORDER BY criado_em DESC, id_movimentacao DESC
            """,
            (id_teste,),
        )
        return rows_to_dicts(cursor, cursor.fetchall())

    def _serialize_candidate_sheet_timeline(
        self,
        movement_rows: list[dict],
        history_rows: list[dict],
        interview_rows: list[dict],
        cv_pre_analysis: dict,
    ) -> list[dict]:
        eventos = []

        if cv_pre_analysis:
            eventos.append({
                "tipo": "curriculo",
                "icone": "description",
                "titulo": "Currículo avaliado",
                "descricao": f"Classificação: {normalize_text(cv_pre_analysis.get('classificacao')) or 'não avaliado'}.",
                "data": cv_pre_analysis.get("criado_em"),
            })

        for row in history_rows:
            eventos.append({
                "tipo": "prova",
                "icone": "assignment_turned_in",
                "titulo": f"Prova concluída ({normalize_text(row.get('trilha') or row.get('nivel')) or 'Prova'})",
                "descricao": f"Nota: {_format_score(row.get('pontuacao_final'))}. Vaga: {normalize_text(row.get('vaga')) or 'não informada'}.",
                "data": row.get("data_iso") or row.get("data_exibicao"),
            })

        for row in interview_rows:
            eventos.append({
                "tipo": "entrevista",
                "icone": "event",
                "titulo": "Entrevista",
                "descricao": f"Status: {normalize_text(row.get('status_entrevista')) or 'não realizado'}. Vaga: {normalize_text(row.get('vaga')) or 'não informada'}.",
                "data": row.get("data_entrevista"),
            })

        for row in movement_rows:
            tipo_movimentacao = normalize_text(row.get("tipo_movimentacao")) or "Movimentação"
            status_anterior = normalize_text(row.get("status_anterior"))
            status_novo = normalize_text(row.get("status_novo"))
            partes_descricao = []
            if status_anterior or status_novo:
                partes_descricao.append(f"{status_anterior or '-'} → {status_novo or '-'}")
            if normalize_text(row.get("processo_destino")):
                partes_descricao.append(f"Processo destino: {row.get('processo_destino')}")
            if normalize_text(row.get("observacao")):
                partes_descricao.append(normalize_text(row.get("observacao")))
            responsavel = normalize_text(row.get("usuario_responsavel"))
            if responsavel:
                partes_descricao.append(f"Responsável: {responsavel}")
            eventos.append({
                "tipo": "movimentacao",
                "icone": "swap_horiz",
                "titulo": tipo_movimentacao,
                "descricao": " · ".join(partes_descricao) or "Sem detalhes adicionais.",
                "data": row.get("criado_em"),
            })

        eventos.sort(key=lambda evento: normalize_text(evento.get("data")) or "", reverse=True)
        return eventos

    def _get_candidate_sheet_cv_pre_analysis(
        self,
        cursor,
        id_teste: str,
        profile: dict,
        process_rows: list[dict],
    ) -> dict:
        ensure_cv_pre_analises_table(cursor)
        if id_teste.upper().startswith("CV-") and id_teste[3:].isdigit():
            cursor.execute(
                """
                SELECT TOP 1
                    id_pre_analise,
                    score_final,
                    classificacao,
                    classificacao_slug,
                    palavras_chave,
                    problemas,
                    nome_arquivo,
                    mime_type,
                    criado_em
                FROM cv_pre_analises
                WHERE id_pre_analise = ?
                """,
                (int(id_teste[3:]),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if rows:
                return rows[0]

        contacts = {
            "email": normalize_text(profile.get("email")),
            "telefone": normalize_text(profile.get("telefone")),
            "whatsapp": normalize_text(profile.get("whatsapp")),
        }
        for row in process_rows:
            contacts["email"] = contacts["email"] or normalize_text(row.get("email"))
            contacts["telefone"] = contacts["telefone"] or normalize_text(row.get("telefone"))
            contacts["whatsapp"] = contacts["whatsapp"] or normalize_text(row.get("whatsapp"))

        cursor.execute(
            """
            SELECT TOP 1
                id_pre_analise,
                score_final,
                classificacao,
                classificacao_slug,
                palavras_chave,
                problemas,
                nome_arquivo,
                mime_type,
                criado_em
            FROM cv_pre_analises
            WHERE (? <> '' AND LOWER(email) = LOWER(?))
               OR (? <> '' AND telefone = ?)
               OR (? <> '' AND whatsapp = ?)
            ORDER BY criado_em DESC, id_pre_analise DESC
            """,
            (
                contacts["email"],
                contacts["email"],
                contacts["telefone"],
                contacts["telefone"],
                contacts["whatsapp"],
                contacts["whatsapp"],
            ),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return rows[0] if rows else {}

    def _get_candidate_sheet_cv_summary(self, cursor, id_teste: str, cv_pre_analysis: dict) -> dict:
        ensure_candidate_attachments_table(cursor)
        cv_attachment = self._get_candidate_cv_map(cursor).get(id_teste, {})
        pre_analysis_attachment = self._get_pre_analysis_cv_map(cursor).get(id_teste, {})
        attachment = cv_attachment or pre_analysis_attachment
        file_name = (
            normalize_text(attachment.get("nome_arquivo_original"))
            or normalize_text(attachment.get("nome_arquivo"))
            or normalize_text(cv_pre_analysis.get("nome_arquivo"))
        )
        media_type = (
            normalize_text(attachment.get("tipo_arquivo"))
            or normalize_text(attachment.get("mime_type"))
            or normalize_text(cv_pre_analysis.get("mime_type"))
        )
        available = bool(normalize_text(attachment.get("caminho_arquivo")))

        return {
            "disponivel": available,
            "nome_arquivo": file_name,
            "tipo_arquivo": media_type,
            "tamanho_bytes": attachment.get("tamanho_bytes"),
            "url_download": f"/candidate-profiles/{id_teste}/cv" if available else "",
            "status": normalize_text(cv_pre_analysis.get("classificacao")) or "Não avaliado",
        }

    def _serialize_candidate_sheet_processes(
        self,
        process_rows: list[dict],
        bank_rows: list[dict],
    ) -> list[dict]:
        processes = []
        seen = set()

        for row in process_rows:
            key = (
                normalize_text(row.get("id_registro")),
                normalize_text(row.get("id_processo_ref") or row.get("id_processo")),
            )
            seen.add(key)
            processes.append(
                {
                    "id": row.get("id_registro"),
                    "id_processo": normalize_text(row.get("id_processo")),
                    "id_processo_ref": normalize_text(row.get("id_processo_ref")),
                    "vaga": normalize_text(row.get("vaga")) or "Não informado",
                    "status": normalize_text(row.get("status_fluxo") or row.get("status_candidato")) or "Não informado",
                    "etapa": normalize_text(row.get("etapa_pipeline") or row.get("status_fluxo")) or "Não informado",
                    "data_inscricao": row.get("data_prova") or row.get("data_atualizacao_pipeline"),
                    "resultado_geral": _format_value(row.get("nota_prova") or row.get("pontuacao_final") or row.get("status_prova"))
                    or "Não informado",
                    "origem": normalize_text(row.get("origem_rotulo") or row.get("origem")) or "Não informado",
                    "status_processo": normalize_text(row.get("status_processo")),
                    "eh_indicacao": bool(row.get("eh_indicacao")),
                    "tipo_indicacao": normalize_text(row.get("tipo_indicacao")),
                }
            )

        for row in bank_rows:
            key = (
                f"banco-{normalize_text(row.get('id_banco'))}",
                normalize_text(row.get("id_processo_ref") or row.get("id_processo")),
            )
            if key in seen:
                continue
            processes.append(
                {
                    "id": row.get("id_banco"),
                    "id_processo": normalize_text(row.get("id_processo")),
                    "id_processo_ref": normalize_text(row.get("id_processo_ref")),
                    "vaga": normalize_text(row.get("vaga")) or "Banco de Talentos",
                    "status": "Banco de Talentos",
                    "etapa": "Banco de Talentos",
                    "data_inscricao": row.get("data_movimentacao"),
                    "resultado_geral": _format_score(row.get("pontuacao_final")),
                    "origem": normalize_text(row.get("origem")) or "Banco de Talentos",
                    "status_processo": normalize_text(row.get("status_processo")),
                    "eh_indicacao": bool(row.get("eh_indicacao")),
                    "tipo_indicacao": normalize_text(row.get("tipo_indicacao")),
                }
            )

        return processes

    def _serialize_candidate_sheet_results(
        self,
        history_rows: list[dict],
        interview_rows: list[dict],
        cv_pre_analysis: dict,
    ) -> list[dict]:
        results = []

        if cv_pre_analysis:
            results.append(
                {
                    "etapa": "Currículo",
                    "pontuacao": _format_score(cv_pre_analysis.get("score_final")),
                    "status": normalize_text(cv_pre_analysis.get("classificacao")) or "Não avaliado",
                    "processo": "",
                    "data": cv_pre_analysis.get("criado_em"),
                }
            )

        for row in history_rows:
            stages = safe_json_loads(row.get("etapas_json"), [])
            if isinstance(stages, list) and stages:
                for stage in stages:
                    if not isinstance(stage, dict):
                        continue
                    raw_score = _format_value(stage.get("rawScore"))
                    raw_max = _format_value(stage.get("rawMax"))
                    score = f"{raw_score}/{raw_max}" if raw_score and raw_max else _format_score(row.get("pontuacao_final"))
                    results.append(
                        {
                            "etapa": normalize_text(stage.get("label") or stage.get("key")) or "Prova",
                            "pontuacao": score,
                            "status": normalize_text(row.get("status")) or "Concluída",
                            "processo": normalize_text(row.get("vaga")),
                            "data": row.get("data_iso") or row.get("data_exibicao"),
                            "questoes": stage.get("questionCount"),
                        }
                    )
                continue

            results.append(
                {
                    "etapa": normalize_text(row.get("trilha") or row.get("nivel")) or "Prova",
                    "pontuacao": _format_score(row.get("pontuacao_final")),
                    "status": normalize_text(row.get("status")) or "Concluída",
                    "processo": normalize_text(row.get("vaga")),
                    "data": row.get("data_iso") or row.get("data_exibicao"),
                }
            )

        for row in interview_rows:
            results.append(
                {
                    "etapa": "Entrevista",
                    "pontuacao": "Não informado",
                    "status": normalize_text(row.get("status_entrevista")) or "Não realizado",
                    "processo": normalize_text(row.get("vaga")),
                    "data": row.get("data_entrevista"),
                }
            )

        return results

    def get_candidate_sheet(self, id_teste: str) -> dict:
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador do candidato não informado.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            if not self._candidate_sheet_exists(cursor, safe_id_teste):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado.")

            profile = self._get_candidate_sheet_profile(cursor, safe_id_teste)
            process_rows = self._list_candidate_sheet_process_rows(cursor, safe_id_teste)
            bank_rows = self._list_candidate_sheet_bank_rows(cursor, safe_id_teste)
            history_rows = self._list_candidate_sheet_history_rows(cursor, safe_id_teste)
            interview_rows = self._list_candidate_sheet_interview_rows(cursor, safe_id_teste)
            movement_rows = self._list_candidate_sheet_movement_rows(cursor, safe_id_teste)
            cv_pre_analysis = self._get_candidate_sheet_cv_pre_analysis(
                cursor,
                safe_id_teste,
                profile,
                process_rows,
            )
            cv_summary = self._get_candidate_sheet_cv_summary(
                cursor,
                safe_id_teste,
                cv_pre_analysis,
            )

            primary_process = process_rows[0] if process_rows else {}
            primary_history = history_rows[0] if history_rows else {}
            primary_bank = bank_rows[0] if bank_rows else {}
            candidate_name = (
                normalize_text(profile.get("nome_candidato"))
                or normalize_text(primary_process.get("nome_candidato"))
                or normalize_text(primary_history.get("nome_candidato"))
                or normalize_text(primary_bank.get("nome_candidato"))
            )

            recommendation = normalize_text(profile.get("classificacao_indicacao"))
            cv_details = safe_json_loads(cv_pre_analysis.get("problemas"), {})
            if not isinstance(cv_details, dict):
                cv_details = {}
            qualities = cv_details.get("pontos_fortes") or []
            if not isinstance(qualities, list):
                qualities = []
            competencies = cv_details.get("competencias") or {}
            competency_items = []
            if isinstance(competencies, dict):
                for values in competencies.values():
                    if isinstance(values, list):
                        competency_items.extend(values)
            keywords = safe_json_loads(cv_pre_analysis.get("palavras_chave"), [])
            if not isinstance(keywords, list):
                keywords = []
            skills = []
            for value in [*(profile.get("habilidades") or []), *keywords, *competency_items]:
                label = normalize_text(value)
                if label and label.lower() not in {item.lower() for item in skills}:
                    skills.append(label)
            raw_cv_score = cv_pre_analysis.get("score_final")
            try:
                numeric_cv_score = float(str(raw_cv_score).replace(",", "."))
                adherence_percent = round(numeric_cv_score * 10 if numeric_cv_score <= 10 else numeric_cv_score)
                adherence_percent = max(0, min(100, adherence_percent))
            except (TypeError, ValueError):
                adherence_percent = None
            return {
                "success": True,
                "gerado_em": datetime.now().isoformat(timespec="seconds"),
                "candidato": {
                    "id": safe_id_teste,
                    "id_teste": safe_id_teste,
                    "nome_candidato": candidate_name,
                    "email": normalize_text(profile.get("email") or primary_process.get("email")),
                    "telefone": normalize_text(profile.get("telefone") or primary_process.get("telefone")),
                    "whatsapp": normalize_text(profile.get("whatsapp") or primary_process.get("whatsapp")),
                    "cep": normalize_text(profile.get("cep")),
                    "endereco": normalize_text(profile.get("endereco")),
                    "numero": normalize_text(profile.get("numero")),
                    "cidade": normalize_text(profile.get("cidade") or primary_process.get("cidade")),
                    "bairro": normalize_text(profile.get("bairro") or primary_process.get("bairro")),
                    "idade": calculate_age_from_birth_date(profile.get("data_nascimento")) or profile.get("idade"),
                    "data_nascimento": normalize_text(profile.get("data_nascimento")),
                    "escolaridade": normalize_text(profile.get("escolaridade")),
                    "possui_experiencia": normalize_text(profile.get("possui_experiencia")),
                    "musica": normalize_text(profile.get("musica")),
                    "prato": normalize_text(profile.get("prato")),
                    "futebol": normalize_text(profile.get("futebol")),
                    "time": normalize_text(profile.get("time")),
                    "rede_social": normalize_text(profile.get("rede_social")),
                    "skills": skills,
                    "qualidades_cv": [normalize_text(item) for item in qualities if normalize_text(item)],
                    "aderencia_percentual": adherence_percent,
                    "ultima_atualizacao": profile.get("atualizado_em"),
                    "curriculo": cv_summary,
                    "nota_curriculo": cv_pre_analysis.get("score_final"),
                    "status_curriculo": normalize_text(cv_pre_analysis.get("classificacao")) or cv_summary.get("status"),
                },
                "processos": self._serialize_candidate_sheet_processes(process_rows, bank_rows),
                "resultados": self._serialize_candidate_sheet_results(
                    history_rows,
                    interview_rows,
                    cv_pre_analysis,
                ),
                "timeline": self._serialize_candidate_sheet_timeline(
                    movement_rows,
                    history_rows,
                    interview_rows,
                    cv_pre_analysis,
                ),
                "avaliacao_rh": {
                    "observacoes": normalize_text(profile.get("observacao_rh")),
                    "classificacao": recommendation,
                    "classificacao_label": recommendation or "Não definido",
                    "justificativa": normalize_text(profile.get("justificativa_indicacao")),
                },
            }
        finally:
            conn.close()

    def update_candidate_sheet(self, id_teste: str, data: dict) -> dict:
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador do candidato não informado.")

        payload = dict(data or {})
        nested_review = payload.pop("avaliacao_rh", None)
        if isinstance(nested_review, dict):
            payload.update(nested_review)

        classification_key = (
            "classificacao_indicacao"
            if "classificacao_indicacao" in payload
            else "classificacao"
            if "classificacao" in payload
            else ""
        )
        recommendation = (
            normalize_sheet_recommendation(payload.get(classification_key))
            if classification_key
            else None
        )
        observation_key = (
            "observacao_rh"
            if "observacao_rh" in payload
            else "observacoes"
            if "observacoes" in payload
            else ""
        )
        justification_key = (
            "justificativa_indicacao"
            if "justificativa_indicacao" in payload
            else "justificativa"
            if "justificativa" in payload
            else ""
        )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            if not self._candidate_sheet_exists(cursor, safe_id_teste):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado.")

            fallback_name = self._lookup_candidate_sheet_name(cursor, safe_id_teste)
            candidate_name = (
                normalize_text(payload.get("nome_candidato")) or fallback_name
                if "nome_candidato" in payload
                else fallback_name
            )

            self._upsert_candidate_profile(
                cursor,
                id_teste=safe_id_teste,
                nome_candidato=candidate_name,
                observacao_rh=payload.get(observation_key) if observation_key else None,
                classificacao_indicacao=recommendation,
                justificativa_indicacao=payload.get(justification_key) if justification_key else None,
                email=payload.get("email") if "email" in payload else None,
                telefone=payload.get("telefone") if "telefone" in payload else None,
                whatsapp=payload.get("whatsapp") if "whatsapp" in payload else None,
                endereco=payload.get("endereco") if "endereco" in payload else None,
                cidade=payload.get("cidade") if "cidade" in payload else None,
                bairro=payload.get("bairro") if "bairro" in payload else None,
                data_nascimento=payload.get("data_nascimento") if "data_nascimento" in payload else None,
                escolaridade=payload.get("escolaridade") if "escolaridade" in payload else None,
                possui_experiencia=payload.get("possui_experiencia") if "possui_experiencia" in payload else None,
                musica=payload.get("musica") if "musica" in payload else None,
                prato=payload.get("prato") if "prato" in payload else None,
                futebol=payload.get("futebol") if "futebol" in payload else None,
                time=payload.get("time") if "time" in payload else None,
                rede_social=payload.get("rede_social") if "rede_social" in payload else None,
            )
            self._sync_candidate_identity_copies(
                cursor,
                id_teste=safe_id_teste,
                nome_candidato=normalize_text(payload.get("nome_candidato")) if "nome_candidato" in payload else "",
                email=payload.get("email") if "email" in payload else None,
                telefone=payload.get("telefone") if "telefone" in payload else None,
                whatsapp=payload.get("whatsapp") if "whatsapp" in payload else None,
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_candidate_sheet(safe_id_teste)

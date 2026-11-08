from __future__ import annotations

import json
from decimal import Decimal

from fastapi import HTTPException, status

from ..services.helpers import normalize_text, rows_to_dicts, safe_json_loads
from .bootstrap import (
    ensure_candidate_attachments_table,
    ensure_candidate_metadata_table,
    ensure_curriculo_ia_table,
    ensure_process_columns,
    get_process_row,
)

_LIST_FIELDS = (
    "pontos_fortes",
    "pontos_atencao",
    "riscos",
    "perguntas_sugeridas_entrevista",
)


class AnalisesCurriculoIaRepositoryMixin:
    @staticmethod
    def _serialize_curriculo_ia(row: dict | None) -> dict | None:
        if not row:
            return None
        result = dict(row)
        for field in _LIST_FIELDS:
            result[field] = safe_json_loads(result.get(field), [])
        if isinstance(result.get("nota_aderencia"), Decimal):
            result["nota_aderencia"] = float(result["nota_aderencia"])
        result["revisado_por_humano"] = bool(result.get("revisado_por_humano"))
        for field in ("criado_em", "revisado_em"):
            value = result.get(field)
            if hasattr(value, "isoformat"):
                result[field] = value.isoformat()
        result.pop("json_resultado", None)
        return result

    def get_curriculo_ia_context(
        self,
        id_candidato: str,
        id_processo: str = "",
    ) -> dict:
        candidate_id = normalize_text(id_candidato)
        process_id = normalize_text(id_processo)
        if not candidate_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Candidato não informado.",
            )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_candidate_metadata_table(cursor)
            ensure_candidate_attachments_table(cursor)
            ensure_process_columns(cursor)
            cursor.execute(
                """
                SELECT TOP 1
                    cp.id_teste,
                    cp.id_processo,
                    cp.id_processo_ref,
                    cp.nome_candidato,
                    cp.vaga,
                    meta.nome_candidato AS nome_perfil
                FROM candidatos_processos cp
                LEFT JOIN candidatos_metadata meta
                    ON meta.id_teste = cp.id_teste
                WHERE cp.id_teste = ?
                  AND (
                    ? = ''
                    OR cp.id_processo = ?
                    OR cp.id_processo_ref = ?
                  )
                ORDER BY cp.id_registro DESC
                """,
                (candidate_id, process_id, process_id, process_id),
            )
            candidate_rows = rows_to_dicts(cursor, cursor.fetchall())
            candidate = candidate_rows[0] if candidate_rows else None

            if not candidate:
                cursor.execute(
                    """
                    SELECT TOP 1
                        id_teste,
                        nome_candidato AS nome_perfil
                    FROM candidatos_metadata
                    WHERE id_teste = ?
                    """,
                    (candidate_id,),
                )
                profile_rows = rows_to_dicts(cursor, cursor.fetchall())
                candidate = profile_rows[0] if profile_rows else None

            if not candidate:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Candidato não encontrado.",
                )

            cursor.execute(
                """
                SELECT TOP 1
                    id_anexo,
                    nome_arquivo_original,
                    tipo_arquivo,
                    caminho_arquivo,
                    tamanho_bytes
                FROM candidatos_anexos
                WHERE id_teste = ?
                ORDER BY criado_em DESC, id_anexo DESC
                """,
                (candidate_id,),
            )
            attachment_rows = rows_to_dicts(cursor, cursor.fetchall())
            attachment = attachment_rows[0] if attachment_rows else None
            if not attachment or not normalize_text(attachment.get("caminho_arquivo")):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Este candidato não possui currículo disponível.",
                )

            process_reference = (
                process_id
                or normalize_text(candidate.get("id_processo_ref"))
                or normalize_text(candidate.get("id_processo"))
            )
            process_row = get_process_row(cursor, process_reference) if process_reference else None
            if process_id and not process_row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Processo seletivo não encontrado.",
                )

            process_context = dict(process_row or {})
            if not process_context.get("vaga"):
                process_context["vaga"] = normalize_text(candidate.get("vaga"))

            # Correcoes.txt (rodada 03/set/2026): a analise de CV precisa
            # refletir dinamicamente o segmento/area da operacao e os
            # requisitos estruturados definidos na criacao da vaga (item
            # "Detalhes da vaga"), nao so o texto livre publico.
            process_context["detalhes_vaga"] = safe_json_loads(
                process_context.get("detalhes_vaga_json"), {}
            )
            operacao_nome = normalize_text(process_context.get("operacao"))
            if operacao_nome:
                cursor.execute(
                    "SELECT TOP 1 payload_json FROM operacoes WHERE nome = ?",
                    (operacao_nome,),
                )
                operacao_row = cursor.fetchone()
                operacao_payload = safe_json_loads(operacao_row[0], {}) if operacao_row else {}
                process_context["operacao_segmento_mercado"] = operacao_payload.get("segmento_mercado") or ""
                process_context["operacao_area_segmento"] = operacao_payload.get("area_segmento") or ""
                if not process_context.get("descricao_publica"):
                    process_context["operacao_descricao_atividades"] = (
                        operacao_payload.get("descricao_atividades") or ""
                    )

            return {
                "id_candidato": candidate_id,
                "id_processo": normalize_text(process_context.get("id_processo"))
                or process_id,
                "candidato": candidate,
                "processo": process_context,
                "curriculo": attachment,
            }
        finally:
            conn.close()

    def create_curriculo_ia_analysis(
        self,
        *,
        id_candidato: str,
        id_processo: str,
        provedor: str,
        modelo: str,
        versao_prompt: str,
        duplicate_window_seconds: int,
    ) -> int:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_curriculo_ia_table(cursor)
            window = max(0, int(duplicate_window_seconds or 0))
            if window:
                cursor.execute(
                    """
                    SELECT TOP 1 id_analise
                    FROM analises_curriculo_ia
                    WHERE id_candidato = ?
                      AND ISNULL(id_processo, '') = ?
                      AND status_analise = 'EM_PROCESSAMENTO'
                      AND criado_em >= DATEADD(SECOND, ?, GETDATE())
                    ORDER BY criado_em DESC
                    """,
                    (
                        normalize_text(id_candidato),
                        normalize_text(id_processo),
                        -window,
                    ),
                )
                if cursor.fetchone():
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Já existe uma análise em andamento para este currículo.",
                    )

            cursor.execute(
                """
                INSERT INTO analises_curriculo_ia
                (
                    id_candidato,
                    id_processo,
                    provedor_ia,
                    modelo_ia,
                    versao_prompt,
                    status_analise,
                    revisado_por_humano,
                    criado_em
                )
                OUTPUT INSERTED.id_analise
                VALUES (?, NULLIF(?, ''), ?, ?, ?, 'EM_PROCESSAMENTO', 0, GETDATE())
                """,
                (
                    normalize_text(id_candidato),
                    normalize_text(id_processo),
                    normalize_text(provedor),
                    normalize_text(modelo),
                    normalize_text(versao_prompt),
                ),
            )
            analysis_id = int(cursor.fetchone()[0])
            conn.commit()
            return analysis_id
        finally:
            conn.close()

    def complete_curriculo_ia_analysis(
        self,
        id_analise: int,
        *,
        resultado: dict,
        json_resultado: dict,
        tokens_entrada: int | None,
        tokens_saida: int | None,
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_curriculo_ia_table(cursor)
            cursor.execute(
                """
                UPDATE analises_curriculo_ia
                SET nota_aderencia = ?,
                    parecer = ?,
                    resumo = ?,
                    pontos_fortes = ?,
                    pontos_atencao = ?,
                    riscos = ?,
                    justificativa = ?,
                    perguntas_sugeridas_entrevista = ?,
                    json_resultado = ?,
                    status_analise = 'CONCLUIDA',
                    erro_analise = NULL,
                    tokens_entrada = ?,
                    tokens_saida = ?
                WHERE id_analise = ?
                """,
                (
                    resultado.get("nota_aderencia"),
                    resultado.get("parecer"),
                    resultado.get("resumo"),
                    json.dumps(resultado.get("pontos_fortes", []), ensure_ascii=False),
                    json.dumps(resultado.get("pontos_atencao", []), ensure_ascii=False),
                    json.dumps(resultado.get("riscos", []), ensure_ascii=False),
                    resultado.get("justificativa"),
                    json.dumps(
                        resultado.get("perguntas_sugeridas_entrevista", []),
                        ensure_ascii=False,
                    ),
                    json.dumps(json_resultado or {}, ensure_ascii=False),
                    tokens_entrada,
                    tokens_saida,
                    id_analise,
                ),
            )
            conn.commit()
            return self.get_curriculo_ia_analysis(id_analise)
        finally:
            conn.close()

    def fail_curriculo_ia_analysis(
        self,
        id_analise: int,
        *,
        erro: str,
        json_resultado: dict | None = None,
        tokens_entrada: int | None = None,
        tokens_saida: int | None = None,
    ) -> None:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_curriculo_ia_table(cursor)
            cursor.execute(
                """
                UPDATE analises_curriculo_ia
                SET status_analise = 'ERRO',
                    erro_analise = ?,
                    json_resultado = ?,
                    tokens_entrada = ?,
                    tokens_saida = ?
                WHERE id_analise = ?
                """,
                (
                    normalize_text(erro)[:4000],
                    json.dumps(json_resultado, ensure_ascii=False)
                    if json_resultado
                    else None,
                    tokens_entrada,
                    tokens_saida,
                    id_analise,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_curriculo_ia_analysis(self, id_analise: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_curriculo_ia_table(cursor)
            cursor.execute(
                """
                SELECT TOP 1 *
                FROM analises_curriculo_ia
                WHERE id_analise = ?
                """,
                (id_analise,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Análise de currículo não encontrada.",
                )
            return self._serialize_curriculo_ia(rows[0])
        finally:
            conn.close()

    def list_curriculo_ia_analyses(
        self,
        id_candidato: str,
        *,
        id_processo: str = "",
        limit: int = 50,
    ) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_curriculo_ia_table(cursor)
            safe_limit = self._clamp_limit(limit, default=50, maximum=100)
            cursor.execute(
                f"""
                SELECT TOP {safe_limit}
                    id_analise,
                    id_candidato,
                    id_processo,
                    provedor_ia,
                    modelo_ia,
                    versao_prompt,
                    nota_aderencia,
                    parecer,
                    resumo,
                    pontos_fortes,
                    pontos_atencao,
                    riscos,
                    justificativa,
                    perguntas_sugeridas_entrevista,
                    json_resultado,
                    status_analise,
                    erro_analise,
                    tokens_entrada,
                    tokens_saida,
                    custo_estimado,
                    revisado_por_humano,
                    id_usuario_revisao,
                    criado_em,
                    revisado_em
                FROM analises_curriculo_ia
                WHERE id_candidato = ?
                  AND (? = '' OR id_processo = ?)
                ORDER BY criado_em DESC, id_analise DESC
                """,
                (
                    normalize_text(id_candidato),
                    normalize_text(id_processo),
                    normalize_text(id_processo),
                ),
            )
            return [
                self._serialize_curriculo_ia(row)
                for row in rows_to_dicts(cursor, cursor.fetchall())
            ]
        finally:
            conn.close()

    def get_latest_curriculo_ia_analysis(
        self,
        id_candidato: str,
        *,
        id_processo: str = "",
    ) -> dict | None:
        items = self.list_curriculo_ia_analyses(
            id_candidato,
            id_processo=id_processo,
            limit=1,
        )
        return items[0] if items else None

    def review_curriculo_ia_analysis(
        self,
        id_analise: int,
        *,
        id_usuario: int | None,
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_curriculo_ia_table(cursor)
            cursor.execute(
                """
                UPDATE analises_curriculo_ia
                SET revisado_por_humano = 1,
                    id_usuario_revisao = ?,
                    revisado_em = GETDATE()
                WHERE id_analise = ?
                  AND status_analise = 'CONCLUIDA'
                """,
                (id_usuario, id_analise),
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    "SELECT status_analise FROM analises_curriculo_ia WHERE id_analise = ?",
                    (id_analise,),
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Análise de currículo não encontrada.",
                    )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Somente análises concluídas podem ser revisadas.",
                )
            conn.commit()
            return self.get_curriculo_ia_analysis(id_analise)
        finally:
            conn.close()

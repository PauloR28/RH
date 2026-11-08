from __future__ import annotations

import hashlib
import json
import logging
import re
import socket
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from ..services.exam_analytics import (
    ANALYTICS_ALGORITHM_VERSION,
    EXECUTION_HIGH_THRESHOLD,
    EXECUTION_LOW_THRESHOLD,
    MINIMUM_COMPARABLE_SAMPLE,
    TELEMETRY_VERSION,
    answer_key_version,
    comparison_signature,
    dense_ranks_desc,
    derive_categories,
    execution_indicator,
    percentile_midrank,
    profile_adherence,
    sanitized_excel_details,
    text_metrics,
    weighted_analytical_score,
    z_scores,
)
from ..services.helpers import normalize_text, rows_to_dicts, safe_json_loads
from ..services.process_flow import is_process_closed
from .bootstrap import get_process_row
from .exam_analytics_schema import ensure_exam_analytics_tables

logger = logging.getLogger(__name__)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _safe_float(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _utc_naive(value: Any = None) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if value:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        except (TypeError, ValueError) as exc:
            logger.debug("Valor de data invalido em analytics, usando horario atual: %r (%s)", value, exc)
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _source_job_key(row: dict, reason: str) -> str:
    source = f"{row.get('resultado_atualizado_em') or 'sem-resultado'}|{row.get('prova_atualizado_em') or 'sem-prova'}"
    digest = hashlib.sha256(f"{row.get('id_prova')}|{reason}|{source}".encode("utf-8")).hexdigest()[:32]
    return f"prova:{int(row.get('id_prova') or 0)}:{reason[:80]}:{digest}"[:260]


def persist_exam_telemetry(cursor, row: dict, data: dict, *, stage_status: str | None = None) -> None:
    id_prova = int(row.get("id_prova") or 0)
    id_teste = normalize_text(row.get("id_teste"))
    stage_key = normalize_text(data.get("etapa_chave"))[:120]
    metrics = data.get("telemetria") if isinstance(data.get("telemetria"), list) else []

    if stage_key:
        started_at = _utc_naive(data.get("etapa_iniciada_em")) if data.get("etapa_iniciada_em") else None
        finished_at = _utc_naive(data.get("etapa_finalizada_em")) if data.get("etapa_finalizada_em") else None
        status_value = stage_status or "Iniciada"
        active_seconds = _safe_float(data.get("tempo_ativo_etapa_segundos"))
        cursor.execute(
            """
            UPDATE dbo.analise_sessoes_etapas
            SET iniciada_em = COALESCE(iniciada_em, ?),
                finalizada_em = COALESCE(?, finalizada_em),
                status_etapa = ?,
                tempo_ativo_segundos = COALESCE(?, tempo_ativo_segundos),
                ultima_questao_indice = COALESCE(?, ultima_questao_indice),
                telemetria_versao = ?,
                atualizado_em = SYSUTCDATETIME()
            WHERE id_prova = ? AND etapa_chave = ?
            """,
            (
                started_at,
                finished_at,
                status_value,
                active_seconds,
                data.get("questao_indice"),
                TELEMETRY_VERSION,
                id_prova,
                stage_key,
            ),
        )
        if cursor.rowcount == 0:
            cursor.execute(
                """
                INSERT INTO dbo.analise_sessoes_etapas
                (id_prova, id_teste, etapa_chave, iniciada_em, finalizada_em, status_etapa,
                 tempo_ativo_segundos, ultima_questao_indice, telemetria_versao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    id_prova,
                    id_teste,
                    stage_key,
                    started_at or _utc_naive(),
                    finished_at,
                    status_value,
                    active_seconds,
                    data.get("questao_indice"),
                    TELEMETRY_VERSION,
                ),
            )

    for metric in metrics[:500]:
        if not isinstance(metric, dict):
            continue
        try:
            question_index = int(metric.get("questao_indice"))
        except (TypeError, ValueError):
            continue
        if question_index < 0:
            continue
        values = (
            normalize_text(metric.get("questao_id"))[:180] or None,
            normalize_text(metric.get("etapa_chave"))[:120] or stage_key or None,
            normalize_text(metric.get("categoria_chave"))[:120] or None,
            _utc_naive(metric.get("primeiro_acesso_em")) if metric.get("primeiro_acesso_em") else None,
            _utc_naive(metric.get("ultima_alteracao_em")) if metric.get("ultima_alteracao_em") else None,
            max(0.0, min(float(metric.get("tempo_ativo_segundos") or 0), 86400.0)),
            max(0, min(int(metric.get("quantidade_alteracoes") or 0), 100000)),
            int(metric.get("ordem_resposta")) if metric.get("ordem_resposta") is not None else None,
            max(0, min(int(metric.get("tamanho_resposta_final") or 0), 10000000)),
            1 if metric.get("evento_colagem") else 0,
            max(0, min(int(metric.get("quantidade_colagens") or 0), 100000)),
            max(0, min(int(metric.get("tamanho_colagem_aproximado") or 0), 10000000)),
        )
        cursor.execute(
            """
            UPDATE dbo.analise_metricas_respostas
            SET questao_id = COALESCE(?, questao_id), etapa_chave = COALESCE(?, etapa_chave),
                categoria_chave = COALESCE(?, categoria_chave),
                primeiro_acesso_em = COALESCE(primeiro_acesso_em, ?),
                ultima_alteracao_em = COALESCE(?, ultima_alteracao_em),
                tempo_ativo_segundos = CASE WHEN ? > ISNULL(tempo_ativo_segundos, 0) THEN ? ELSE tempo_ativo_segundos END,
                quantidade_alteracoes = CASE WHEN ? > quantidade_alteracoes THEN ? ELSE quantidade_alteracoes END,
                ordem_resposta = COALESCE(ordem_resposta, ?),
                tamanho_resposta_final = ?, evento_colagem = CASE WHEN ? = 1 THEN 1 ELSE evento_colagem END,
                quantidade_colagens = CASE WHEN ? > quantidade_colagens THEN ? ELSE quantidade_colagens END,
                tamanho_colagem_aproximado = CASE WHEN ? > ISNULL(tamanho_colagem_aproximado, 0) THEN ? ELSE tamanho_colagem_aproximado END,
                telemetria_versao = ?, atualizado_em = SYSUTCDATETIME()
            WHERE id_prova = ? AND questao_indice = ?
            """,
            (
                values[0], values[1], values[2], values[3], values[4],
                values[5], values[5], values[6], values[6], values[7], values[8],
                values[9], values[10], values[10], values[11], values[11],
                TELEMETRY_VERSION, id_prova, question_index,
            ),
        )
        if cursor.rowcount == 0:
            cursor.execute(
                """
                INSERT INTO dbo.analise_metricas_respostas
                (id_prova, id_teste, questao_indice, questao_id, etapa_chave, categoria_chave,
                 primeiro_acesso_em, ultima_alteracao_em, tempo_ativo_segundos,
                 quantidade_alteracoes, ordem_resposta, tamanho_resposta_final,
                 evento_colagem, quantidade_colagens, tamanho_colagem_aproximado, telemetria_versao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (id_prova, id_teste, question_index, *values, TELEMETRY_VERSION),
            )


def enqueue_exam_analytics_job(cursor, row: dict, *, reason: str) -> bool:
    id_prova = int(row.get("id_prova") or 0)
    if not id_prova:
        return False
    process_id = normalize_text(row.get("id_processo")) or f"prova-{id_prova}"
    process_ref = normalize_text(row.get("id_processo_ref")) or process_id
    key = _source_job_key(row, reason)
    cursor.execute("SELECT 1 FROM dbo.analise_jobs_provas WHERE chave_idempotencia = ?", (key,))
    if cursor.fetchone():
        return False
    cursor.execute(
        """
        INSERT INTO dbo.analise_jobs_provas
        (id_prova, id_teste, id_processo, id_processo_ref, tipo_job, motivo,
         chave_idempotencia, status_job, gabarito_versao, disponivel_em)
        VALUES (?, ?, ?, ?, N'Consolidar', ?, ?, N'Pendente', N'legado', SYSUTCDATETIME())
        """,
        (
            id_prova,
            normalize_text(row.get("id_teste")) or f"prova-{id_prova}",
            process_id,
            process_ref,
            normalize_text(reason)[:120],
            key,
        ),
    )
    return True


class ExamAnalyticsRepositoryMixin:
    def _analytics_exam_row(self, cursor, id_prova: int) -> dict:
        cursor.execute(
            """
            SELECT TOP 1
                prova.id_prova, prova.id_teste, prova.id_registro, prova.id_processo,
                prova.id_processo_ref, prova.nome_candidato, prova.vaga, prova.status,
                prova.questoes_json, prova.etapas_json, prova.configuracao_json,
                prova.atualizado_em AS prova_atualizado_em,
                resultado.nota_objetiva, resultado.nota_redacao, resultado.nota_excel,
                resultado.nota_tecnica, resultado.nota_comunicacao, resultado.nota_lgpd,
                resultado.nota_final_prova, resultado.score_por_categoria_json,
                resultado.resumo_etapas_json, resultado.status_correcao,
                resultado.pendente_avaliacao_manual,
                resultado.atualizado_em AS resultado_atualizado_em
            FROM dbo.provas_geradas prova
            LEFT JOIN dbo.resultados_provas resultado ON resultado.id_prova = prova.id_prova
            WHERE prova.id_prova = ?
            ORDER BY resultado.atualizado_em DESC
            """,
            (int(id_prova),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova nao encontrada.")
        return rows[0]

    def capture_exam_telemetry(self, id_prova: int, data: dict, *, stage_status: str | None = None) -> None:
        if not data.get("telemetria") and not data.get("etapa_chave"):
            return
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            row = self._analytics_exam_row(cursor, id_prova)
            persist_exam_telemetry(cursor, row, data, stage_status=stage_status)
            conn.commit()
        finally:
            conn.close()

    def enqueue_exam_analytics(self, id_prova: int, *, reason: str) -> bool:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            row = self._analytics_exam_row(cursor, id_prova)
            created = enqueue_exam_analytics_job(cursor, row, reason=reason)
            conn.commit()
            return created
        finally:
            conn.close()

    def record_manual_correction_history(
        self,
        id_prova: int,
        previous: dict,
        updated: dict,
        *,
        updated_by: str,
    ) -> None:
        fields = (
            "nota_redacao", "nota_excel", "nota_tecnica", "nota_comunicacao", "nota_lgpd",
        )
        before = {field: _safe_float(previous.get(field)) for field in fields}
        after = {
            field: _safe_float(updated.get(field)) if updated.get(field) is not None else before[field]
            for field in fields
        }
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            cursor.execute(
                """
                INSERT INTO dbo.historico_correcoes_manuais_provas
                (id_prova,id_teste,id_processo_ref,valores_anteriores_json,valores_novos_json,
                 justificativa,alterado_por)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    int(id_prova), normalize_text(previous.get("id_teste")) or f"prova-{id_prova}",
                    normalize_text(previous.get("id_processo_ref")) or normalize_text(previous.get("id_processo")) or f"prova-{id_prova}",
                    _json(before), _json(after), normalize_text(updated.get("observacao"))[:1000], normalize_text(updated_by)[:180],
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def backfill_exam_analytics(self, *, process_id: str = "", batch_size: int = 500) -> int:
        conn = self._connect()
        created = 0
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            params: list[Any] = []
            predicate = "(resultado.id_prova IS NOT NULL OR prova.status IN (N'Cancelada', N'Expirada', N'Reaberta'))"
            if normalize_text(process_id):
                predicate += " AND (prova.id_processo = ? OR prova.id_processo_ref = ?)"
                params.extend([normalize_text(process_id), normalize_text(process_id)])
            safe_batch_size = self._clamp_limit(batch_size, default=500, maximum=5000)
            cursor.execute(
                f"""
                SELECT TOP {safe_batch_size}
                    prova.id_prova, prova.id_teste, prova.id_processo, prova.id_processo_ref,
                    prova.atualizado_em AS prova_atualizado_em,
                    resultado.atualizado_em AS resultado_atualizado_em
                FROM dbo.provas_geradas prova
                LEFT JOIN dbo.resultados_provas resultado ON resultado.id_prova = prova.id_prova
                WHERE {predicate}
                  AND NOT EXISTS (
                      SELECT 1 FROM dbo.analise_jobs_provas job
                      WHERE job.id_prova = prova.id_prova AND job.motivo = N'backfill-oficial'
                  )
                ORDER BY prova.id_prova
                """,
                tuple(params),
            )
            for row in rows_to_dicts(cursor, cursor.fetchall()):
                if enqueue_exam_analytics_job(cursor, row, reason="backfill-oficial"):
                    created += 1
            conn.commit()
            return created
        finally:
            conn.close()

    def retry_failed_exam_analytics(self, *, process_id: str = "", batch_size: int = 100) -> int:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            params: list[Any] = []
            predicate = "status_job IN (N'Falhou',N'Cancelado')"
            if normalize_text(process_id):
                predicate += " AND (id_processo=? OR id_processo_ref=?)"
                params.extend([normalize_text(process_id), normalize_text(process_id)])
            limit = self._clamp_limit(batch_size, default=100, maximum=1000)
            cursor.execute(
                f"""
                ;WITH retry AS (
                    SELECT TOP {limit} * FROM dbo.analise_jobs_provas WITH (UPDLOCK, READPAST, ROWLOCK)
                    WHERE {predicate}
                    ORDER BY prioridade, atualizado_em, id_job
                )
                UPDATE retry
                SET status_job=N'Pendente', tentativas=0, disponivel_em=SYSUTCDATETIME(),
                    bloqueado_por=NULL, bloqueado_em=NULL, codigo_erro=NULL, ultimo_erro=NULL,
                    finalizado_em=NULL, atualizado_em=SYSUTCDATETIME()
                OUTPUT inserted.id_job;
                """,
                tuple(params),
            )
            count = len(cursor.fetchall())
            conn.commit()
            if count:
                try:
                    self.record_audit_log(
                        user={"nome": "Operacao analitica", "perfil_nome": "Sistema"},
                        modulo="Provas",
                        acao="reprocessar_jobs_analiticos",
                        entidade="processo",
                        entidade_id=normalize_text(process_id),
                        valor_novo={"jobCount": count, "algorithmVersion": ANALYTICS_ALGORITHM_VERSION},
                        origem="worker-cli",
                        sucesso=True,
                    )
                except Exception as exc:
                    self.logger.debug("Falha ao registrar log de auditoria de reprocessamento analitico: %s", exc)
            return count
        finally:
            conn.close()

    def reserve_exam_analytics_job(self, *, worker_id: str = "") -> dict | None:
        worker = normalize_text(worker_id)[:180] or f"{socket.gethostname()}:{id(self)}"
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            cursor.execute(
                """
                UPDATE dbo.analise_jobs_provas
                SET status_job = N'Pendente', bloqueado_por = NULL, bloqueado_em = NULL,
                    disponivel_em = SYSUTCDATETIME(), atualizado_em = SYSUTCDATETIME()
                WHERE status_job = N'Processando'
                  AND bloqueado_em < DATEADD(MINUTE, -15, SYSUTCDATETIME())
                  AND tentativas < max_tentativas
                """
            )
            cursor.execute(
                """
                UPDATE dbo.analise_jobs_provas
                SET status_job=N'Cancelado', bloqueado_por=NULL, bloqueado_em=NULL,
                    codigo_erro=N'ANALYTICS_WORKER_TIMEOUT',
                    ultimo_erro=N'Processamento excedeu o tempo de recuperacao e atingiu o limite de tentativas.',
                    finalizado_em=SYSUTCDATETIME(), atualizado_em=SYSUTCDATETIME()
                WHERE status_job=N'Processando'
                  AND bloqueado_em < DATEADD(MINUTE, -15, SYSUTCDATETIME())
                  AND tentativas >= max_tentativas
                """
            )
            cursor.execute(
                """
                ;WITH proximo AS (
                    SELECT TOP 1 *
                    FROM dbo.analise_jobs_provas WITH (UPDLOCK, READPAST, ROWLOCK)
                    WHERE status_job IN (N'Pendente', N'Falhou')
                      AND tentativas < max_tentativas
                      AND disponivel_em <= SYSUTCDATETIME()
                    ORDER BY prioridade, disponivel_em, id_job
                )
                UPDATE proximo
                SET status_job = N'Processando', tentativas = tentativas + 1,
                    bloqueado_por = ?, bloqueado_em = SYSUTCDATETIME(),
                    iniciado_em = COALESCE(iniciado_em, SYSUTCDATETIME()),
                    atualizado_em = SYSUTCDATETIME()
                OUTPUT inserted.*;
                """,
                (worker,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            conn.commit()
            return rows[0] if rows else None
        finally:
            conn.close()

    def _ensure_process_config(self, cursor, row: dict, categories: list[dict]) -> dict:
        process_ref = normalize_text(row.get("id_processo_ref")) or normalize_text(row.get("id_processo")) or f"prova-{row['id_prova']}"
        process_id = normalize_text(row.get("id_processo")) or process_ref
        for index, category in enumerate(categories):
            cursor.execute(
                """
                IF NOT EXISTS (SELECT 1 FROM dbo.categorias_analiticas WHERE chave = ?)
                    INSERT INTO dbo.categorias_analiticas (chave, nome, descricao, ordem)
                    VALUES (?, ?, N'Categoria derivada da configuracao oficial da prova.', ?)
                """,
                (category["key"], category["key"], category["name"], index),
            )
        cursor.execute(
            """
            SELECT TOP 1 * FROM dbo.configuracoes_analiticas_processos
            WHERE id_processo_ref = ? AND status_configuracao = N'Ativa'
            ORDER BY versao DESC
            """,
            (process_ref,),
        )
        configs = rows_to_dicts(cursor, cursor.fetchall())
        if configs:
            config = configs[0]
            for category in categories:
                cursor.execute(
                    """
                    IF NOT EXISTS (
                        SELECT 1 FROM dbo.mapeamentos_categorias_analiticas
                        WHERE id_configuracao=? AND origem_tipo=N'Etapa' AND origem_chave=?
                    )
                    INSERT INTO dbo.mapeamentos_categorias_analiticas
                    (id_configuracao, origem_tipo, origem_chave, categoria_chave, criado_por)
                    VALUES (?, N'Etapa', ?, ?, N'Sistema')
                    """,
                    (config["id_configuracao"], category["key"], config["id_configuracao"], category["key"], category["key"]),
                )
            return config
        cursor.execute(
            """
            INSERT INTO dbo.configuracoes_analiticas_processos
            (id_processo, id_processo_ref, versao, algoritmo_versao, amostra_minima,
             limiar_execucao_baixo, limiar_execucao_alto, criado_por, atualizado_por)
            OUTPUT inserted.*
            VALUES (?, ?, 1, ?, ?, ?, ?, N'Sistema', N'Sistema')
            """,
            (process_id, process_ref, ANALYTICS_ALGORITHM_VERSION, MINIMUM_COMPARABLE_SAMPLE, EXECUTION_LOW_THRESHOLD, EXECUTION_HIGH_THRESHOLD),
        )
        config = rows_to_dicts(cursor, cursor.fetchall())[0]
        for category in categories:
            cursor.execute(
                """
                INSERT INTO dbo.mapeamentos_categorias_analiticas
                (id_configuracao, origem_tipo, origem_chave, categoria_chave, criado_por)
                VALUES (?, N'Etapa', ?, ?, N'Sistema')
                """,
                (config["id_configuracao"], category["key"], category["key"]),
            )
        weights = {item["key"]: float(item.get("weight") or 0.0) for item in categories}
        total = sum(weights.values())
        if len(categories) == 1 and total == 0:
            weights[categories[0]["key"]] = 1.0
            total = 1.0
        if weights and abs(total - 1.0) <= 0.0001:
            for key, weight in weights.items():
                cursor.execute(
                    """
                    INSERT INTO dbo.pesos_analiticos_processos
                    (id_configuracao, categoria_chave, peso, obrigatoria)
                    VALUES (?, ?, ?, 1)
                    """,
                    (config["id_configuracao"], key, weight),
                )
        return config

    def _map_analytical_categories(self, cursor, config: dict, categories: list[dict]) -> list[dict]:
        cursor.execute(
            """
            SELECT mapping.origem_chave, mapping.categoria_chave,
                   COALESCE(category.nome, mapping.categoria_chave) AS categoria_nome
            FROM dbo.mapeamentos_categorias_analiticas mapping
            LEFT JOIN dbo.categorias_analiticas category ON category.chave=mapping.categoria_chave
            WHERE mapping.id_configuracao=? AND mapping.origem_tipo=N'Etapa' AND mapping.ativo=1
            """,
            (config["id_configuracao"],),
        )
        mappings = {item["origem_chave"]: item for item in rows_to_dicts(cursor, cursor.fetchall())}
        grouped: dict[str, dict] = {}
        for source in categories:
            mapping = mappings.get(source["key"], {})
            target_key = normalize_text(mapping.get("categoria_chave")) or source["key"]
            target = grouped.setdefault(
                target_key,
                {
                    "key": target_key,
                    "name": normalize_text(mapping.get("categoria_nome")) or source["name"],
                    "raw_score": 0.0,
                    "raw_max": 0.0,
                    "expected_components": 0,
                    "completed_components": 0,
                    "weight": 0.0,
                    "complete": True,
                    "interrupted": False,
                    "scores": [],
                },
            )
            raw_score = _safe_float(source.get("raw_score"))
            raw_max = _safe_float(source.get("raw_max"))
            if raw_score is not None:
                target["raw_score"] += raw_score
            if raw_max is not None:
                target["raw_max"] += raw_max
            target["expected_components"] += int(source.get("expected_components") or 0)
            target["completed_components"] += int(source.get("completed_components") or 0)
            target["weight"] += float(source.get("weight") or 0.0)
            target["complete"] = target["complete"] and bool(source.get("complete"))
            target["interrupted"] = target["interrupted"] or bool(source.get("interrupted"))
            if source.get("score") is not None:
                target["scores"].append((float(source["score"]), max(float(source.get("weight") or 0.0), 0.0)))
        mapped = []
        for target in grouped.values():
            if target["raw_max"] > 0:
                score = 100.0 * target["raw_score"] / target["raw_max"]
            elif target["scores"]:
                weight_sum = sum(weight for _, weight in target["scores"])
                score = (
                    sum(score_value * weight for score_value, weight in target["scores"]) / weight_sum
                    if weight_sum > 0
                    else sum(score_value for score_value, _ in target["scores"]) / len(target["scores"])
                )
            else:
                score = None
            target["score"] = None if score is None else round(max(0.0, min(100.0, score)), 3)
            target["completion_status"] = (
                "Interrompida" if target["interrupted"] else "Concluida" if target["complete"] else "Aguardando correcao"
            )
            target.pop("scores", None)
            mapped.append(target)
        return mapped

    def _replace_complementary_details(self, cursor, row: dict, questions: list[dict]) -> None:
        id_prova = int(row["id_prova"])
        cursor.execute("DELETE FROM dbo.analise_excel_detalhes WHERE id_prova = ?", (id_prova,))
        cursor.execute("DELETE FROM dbo.analise_texto_detalhes WHERE id_prova = ?", (id_prova,))
        cursor.execute(
            """
            SELECT questao_indice, resposta_json
            FROM dbo.respostas_provas WHERE id_prova = ? ORDER BY questao_indice
            """,
            (id_prova,),
        )
        for answer_row in rows_to_dicts(cursor, cursor.fetchall()):
            index = int(answer_row.get("questao_indice") or 0)
            answer = safe_json_loads(answer_row.get("resposta_json"), None)
            question = questions[index] if 0 <= index < len(questions) and isinstance(questions[index], dict) else {}
            question_type = normalize_text(question.get("type"))
            if question_type == "excel_external":
                for detail in sanitized_excel_details(answer):
                    cursor.execute(
                        """
                        INSERT INTO dbo.analise_excel_detalhes
                        (id_prova, questao_indice, item_chave, item_rotulo, status_item,
                         pontuacao, pontuacao_maxima, confianca, celula_esperada, celula_encontrada,
                         valor_esperado, valor_encontrado, formula_encontrada,
                         metodo_identificado, tolerancia_utilizada, justificativa, gabarito_versao, algoritmo_versao,
                         detalhes_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            id_prova, index, detail["key"], detail["label"], detail["status"],
                            _safe_float(detail.get("score")), _safe_float(detail.get("max")),
                            _safe_float(detail.get("confidence")), normalize_text(detail.get("expectedCell"))[:180] or None,
                            normalize_text(detail.get("foundCell"))[:180] or None,
                            normalize_text(detail.get("expectedValue"))[:500] or None,
                            normalize_text(detail.get("foundValue"))[:500] or None,
                            normalize_text(detail.get("foundFormula"))[:1000] or None,
                            normalize_text(detail.get("method"))[:120] or None,
                            _safe_float(detail.get("tolerance")), normalize_text(detail.get("justification"))[:1000] or None,
                            normalize_text(question.get("answerKeyVersion") or question.get("version"))[:80] or "legado",
                            ANALYTICS_ALGORITHM_VERSION, _json(detail["details"]),
                        ),
                    )
            elif question_type not in {"multiple", "compact_choice_group"}:
                metric = text_metrics(answer)
                cursor.execute(
                    """
                    INSERT INTO dbo.analise_texto_detalhes
                    (id_prova, questao_indice, quantidade_caracteres, quantidade_palavras,
                     quantidade_palavras_unicas, quantidade_sentencas, quantidade_paragrafos,
                     media_palavras_sentenca, riqueza_lexical, indice_legibilidade,
                     indicadores_estrutura_json, aderencia_termos_json,
                     ortografia_status, gabarito_versao, metrica_versao)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        id_prova, index, metric["character_count"], metric["word_count"],
                        metric["unique_word_count"], metric["sentence_count"], metric["paragraph_count"],
                        metric["average_words_per_sentence"], metric["lexical_richness"],
                        metric["readability_index"], _json({"status": "Disponivel" if metric["available"] else "Indisponivel", "reason": None if metric["available"] else "Conteudo textual nao disponivel no resultado oficial.", "paragraphs": metric["paragraph_count"], "sentences": metric["sentence_count"]}),
                        _json({"status": "Indisponivel", "reason": "Termos esperados nao configurados."}),
                        metric["spelling_status"], normalize_text(question.get("answerKeyVersion") or question.get("version"))[:80] or "legado",
                        ANALYTICS_ALGORITHM_VERSION,
                    ),
                )

    def _upsert_category_results(self, cursor, row: dict, config: dict, categories: list[dict], signature: str, complete: bool, comparable: bool) -> None:
        category_keys = [item["key"] for item in categories]
        if category_keys:
            placeholders = ",".join("?" for _ in category_keys)
            cursor.execute(
                f"DELETE FROM dbo.resultados_analiticos_categorias WHERE id_prova=? AND categoria_chave NOT IN ({placeholders})",
                (int(row["id_prova"]), *category_keys),
            )
        else:
            cursor.execute(
                "DELETE FROM dbo.resultados_analiticos_categorias WHERE id_prova=?",
                (int(row["id_prova"]),),
            )
        for category in categories:
            category_complete = complete and bool(category.get("complete")) and category.get("score") is not None
            params = (
                normalize_text(row.get("id_teste")),
                normalize_text(row.get("id_processo")) or f"prova-{row['id_prova']}",
                normalize_text(row.get("id_processo_ref")) or normalize_text(row.get("id_processo")) or f"prova-{row['id_prova']}",
                config.get("id_configuracao"), category["name"], category.get("raw_score"), category.get("raw_max"), category.get("score"),
                int(category.get("expected_components") or 0), int(category.get("completed_components") or 0),
                normalize_text(category.get("completion_status")) or "Pendente",
                1 if category_complete else 0, 1 if comparable and category_complete else 0,
                signature, normalize_text(row.get("gabarito_versao")) or "legado", ANALYTICS_ALGORITHM_VERSION, config.get("versao"),
            )
            cursor.execute(
                """
                UPDATE dbo.resultados_analiticos_categorias
                SET id_teste = ?, id_processo = ?, id_processo_ref = ?, id_configuracao = ?,
                    categoria_nome = ?, score_bruto=?, pontuacao_maxima=?, nota_oficial_normalizada = ?,
                    componentes_esperados=?, componentes_concluidos=?, status_completude=?, completo = ?, comparavel = ?,
                    assinatura_comparabilidade = ?, gabarito_versao=?, percentil = NULL, z_score = NULL,
                    posicao_densa = NULL, tamanho_amostra = NULL, amostra_pequena = 1,
                    algoritmo_versao = ?, configuracao_versao=?, calculado_em = SYSUTCDATETIME()
                WHERE id_prova = ? AND categoria_chave = ?
                """,
                (*params, int(row["id_prova"]), category["key"]),
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    """
                    INSERT INTO dbo.resultados_analiticos_categorias
                    (id_prova, id_teste, id_processo, id_processo_ref, id_configuracao,
                     categoria_chave, categoria_nome, score_bruto, pontuacao_maxima, nota_oficial_normalizada,
                     componentes_esperados, componentes_concluidos, status_completude, completo,
                     comparavel, assinatura_comparabilidade, gabarito_versao, amostra_pequena, algoritmo_versao, configuracao_versao)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    """,
                    (int(row["id_prova"]), params[0], params[1], params[2], params[3], category["key"], *params[4:]),
                )

    def _upsert_read_model(self, cursor, row: dict, config: dict, categories: list[dict], signature: str, complete: bool, comparable: bool, *, reason: str = "") -> None:
        process_id = normalize_text(row.get("id_processo")) or f"prova-{row['id_prova']}"
        process_ref = normalize_text(row.get("id_processo_ref")) or process_id
        status_exam = normalize_text(row.get("status"))
        if status_exam == "Cancelada":
            analytics_status, availability_reason = "Cancelado", "Prova cancelada; resultado analitico nao e elegivel."
        elif status_exam in {"Reaberta", "Expirada"}:
            analytics_status, availability_reason = "Invalido", (
                "Prova reaberta; aguardando nova finalizacao oficial."
                if status_exam == "Reaberta"
                else "Prova expirada; resultado preservado sem classificacao analitica."
            )
        elif not row.get("resultado_atualizado_em"):
            analytics_status, availability_reason = "Pendente", "Correcao oficial ainda indisponivel."
        elif not complete:
            analytics_status, availability_reason = "Parcial", "Avaliacao manual ou categoria obrigatoria ainda pendente."
        else:
            analytics_status, availability_reason = "Calculado", None
        alerts = []
        if any(item.get("interrupted") for item in categories):
            alerts.append({"code": "etapa_interrompida", "severity": "info", "message": "Ha etapa interrompida com nota oficial zerada.", "source": "Regra oficial de interrupcao", "observedAt": row.get("resultado_atualizado_em") or row.get("prova_atualizado_em"), "recommendation": "Revisar o contexto da interrupcao sem alterar automaticamente a nota."})
        cursor.execute(
            "SELECT COUNT(*) FROM dbo.analise_metricas_respostas WHERE id_prova = ? AND evento_colagem = 1",
            (int(row["id_prova"]),),
        )
        if int(cursor.fetchone()[0] or 0):
            alerts.append({"code": "evento_colagem", "severity": "info", "message": "Foi registrado evento de colagem; o registro isolado nao indica irregularidade.", "source": "Telemetria minima da resposta", "observedAt": row.get("resultado_atualizado_em") or row.get("prova_atualizado_em"), "recommendation": "Interpretar somente em conjunto com evidencias autorizadas."})
        official_notes = {
            "objetiva": _safe_float(row.get("nota_objetiva")), "redacao": _safe_float(row.get("nota_redacao")),
            "excel": _safe_float(row.get("nota_excel")), "tecnica": _safe_float(row.get("nota_tecnica")),
            "word": _safe_float(row.get("nota_comunicacao")), "comunicacao": _safe_float(row.get("nota_comunicacao")),
            "lgpd": _safe_float(row.get("nota_lgpd")), "consolidada": _safe_float(row.get("nota_final_prova")),
        }
        values = (
            int(row["id_prova"]), normalize_text(row.get("id_teste")) or f"prova-{row['id_prova']}",
            row.get("id_registro"), process_id, process_ref,
            normalize_text(row.get("nome_candidato")) or "Candidato", normalize_text(row.get("vaga")),
            status_exam, normalize_text(row.get("status_correcao")), _safe_float(row.get("nota_final_prova")),
            config.get("id_configuracao"), config.get("versao"), signature,
            1 if complete else 0, 1 if comparable else 0, analytics_status, availability_reason,
            1 if row.get("pendente_avaliacao_manual") else 0, _json(official_notes),
            _json(categories), _json(safe_json_loads(row.get("resumo_etapas_json"), [])),
            _json(alerts), _json([
                "Nota oficial preservada sem alteracao.",
                "Percentis usam somente candidatos do mesmo processo e assinatura comparavel.",
            ]), normalize_text(row.get("gabarito_versao")) or "legado", ANALYTICS_ALGORITHM_VERSION, row.get("resultado_atualizado_em") or row.get("prova_atualizado_em"),
        )
        cursor.execute(
            "SELECT * FROM dbo.resultados_analiticos_processos WHERE id_processo_ref = ? AND id_teste = ?",
            (process_ref, values[1]),
        )
        existing_rows = rows_to_dicts(cursor, cursor.fetchall())
        existing = existing_rows[0] if existing_rows else None
        if existing:
            snapshot_json = _json(existing)
            snapshot_key = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
            cursor.execute(
                """
                IF NOT EXISTS (SELECT 1 FROM dbo.historico_resultados_analiticos WHERE chave_snapshot=?)
                INSERT INTO dbo.historico_resultados_analiticos
                (id_prova,id_teste,id_processo_ref,id_configuracao,configuracao_versao,algoritmo_versao,motivo,chave_snapshot,snapshot_json)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (snapshot_key, existing["id_prova"], existing["id_teste"], existing["id_processo_ref"], existing.get("id_configuracao"), existing.get("configuracao_versao"), existing.get("algoritmo_versao") or ANALYTICS_ALGORITHM_VERSION, normalize_text(reason)[:120], snapshot_key, snapshot_json),
            )
            cursor.execute(
                """
                UPDATE dbo.resultados_analiticos_processos
                SET id_prova=?, id_teste=?, id_registro=?, id_processo=?, id_processo_ref=?, nome_candidato=?, vaga=?,
                    status_prova=?, status_correcao_oficial=?, nota_oficial=?, id_configuracao=?, configuracao_versao=?,
                    assinatura_comparabilidade=?, completo=?, comparavel=?, status_analitico=?, motivo_indisponibilidade=?,
                    score_analitico=NULL, percentil_geral=NULL, posicao_densa=NULL, ranking_status=N'Indisponivel', tamanho_amostra=NULL, amostra_pequena=1,
                    aderencia_perfil=NULL, indicador_execucao=NULL, correcao_manual_pendente=?, notas_oficiais_json=?,
                    categorias_json=?, etapas_json=?, alertas_json=?,
                    explicacoes_json=?, gabarito_versao=?, algoritmo_versao=?, fonte_atualizada_em=?, calculado_em=SYSUTCDATETIME(),
                    atualizado_em=SYSUTCDATETIME()
                WHERE id_resultado_analitico=?
                """,
                (*values, int(existing["id_resultado_analitico"])),
            )
        else:
            cursor.execute(
                """
                INSERT INTO dbo.resultados_analiticos_processos
                (id_prova,id_teste,id_registro,id_processo,id_processo_ref,nome_candidato,vaga,status_prova,
                 status_correcao_oficial,nota_oficial,id_configuracao,configuracao_versao,assinatura_comparabilidade,
                 completo,comparavel,status_analitico,motivo_indisponibilidade,correcao_manual_pendente,notas_oficiais_json,categorias_json,etapas_json,
                 alertas_json,explicacoes_json,gabarito_versao,algoritmo_versao,fonte_atualizada_em)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                values,
            )

    def _recalculate_process_cohort(self, cursor, process_ref: str) -> None:
        cursor.execute(
            """
            SELECT TOP 1 * FROM dbo.configuracoes_analiticas_processos
            WHERE id_processo_ref=? AND status_configuracao=N'Ativa' ORDER BY versao DESC
            """,
            (process_ref,),
        )
        configs = rows_to_dicts(cursor, cursor.fetchall())
        if not configs:
            return
        config = configs[0]
        cursor.execute(
            "SELECT COUNT(DISTINCT id_teste) FROM dbo.provas_geradas WHERE id_processo_ref=? OR id_processo=?",
            (process_ref, process_ref),
        )
        expected_results = int(cursor.fetchone()[0] or 0)
        cursor.execute(
            "SELECT COUNT(*) FROM dbo.resultados_analiticos_processos WHERE id_processo_ref=? AND id_configuracao=?",
            (process_ref, config["id_configuracao"]),
        )
        current_results = int(cursor.fetchone()[0] or 0)
        if expected_results == 0 or current_results < expected_results:
            return
        cursor.execute(
            """
            SELECT categoria.*
            FROM dbo.resultados_analiticos_categorias categoria
            INNER JOIN dbo.resultados_analiticos_processos resultado
                ON resultado.id_prova = categoria.id_prova
               AND resultado.id_processo_ref = categoria.id_processo_ref
            WHERE categoria.id_processo_ref = ?
              AND categoria.completo = 1 AND categoria.comparavel = 1
              AND resultado.completo = 1 AND resultado.comparavel = 1
            ORDER BY categoria.categoria_chave, categoria.assinatura_comparabilidade, categoria.id_prova
            """,
            (process_ref,),
        )
        category_rows = rows_to_dicts(cursor, cursor.fetchall())
        groups: dict[tuple[str, str], list[dict]] = {}
        for item in category_rows:
            groups.setdefault((item["categoria_chave"], item["assinatura_comparabilidade"]), []).append(item)
        for items in groups.values():
            values = [float(item["nota_oficial_normalizada"]) for item in items]
            percentiles = percentile_midrank(values)
            z_values = z_scores(values)
            size = len(items)
            ranks = [None] * size if size <= 1 else dense_ranks_desc(values)
            for item, percentile, z_value, rank in zip(items, percentiles, z_values, ranks):
                cursor.execute(
                    """
                    UPDATE dbo.resultados_analiticos_categorias
                    SET percentil=?, z_score=?, posicao_densa=?, tamanho_amostra=?, amostra_pequena=?
                    WHERE id_resultado_categoria=?
                    """,
                    (percentile, z_value, rank, size, 1 if size < MINIMUM_COMPARABLE_SAMPLE else 0, item["id_resultado_categoria"]),
                )

        cursor.execute("SELECT categoria_chave,peso,obrigatoria FROM dbo.pesos_analiticos_processos WHERE id_configuracao=?", (config["id_configuracao"],))
        weight_rows = rows_to_dicts(cursor, cursor.fetchall())
        weights = {item["categoria_chave"]: float(item["peso"]) for item in weight_rows}
        required = {item["categoria_chave"] for item in weight_rows if item.get("obrigatoria")}
        cursor.execute("SELECT categoria_chave,valor_ideal,peso_distancia FROM dbo.perfis_ideais_analiticos WHERE id_configuracao=?", (config["id_configuracao"],))
        profile_rows = rows_to_dicts(cursor, cursor.fetchall())
        profile = {item["categoria_chave"]: float(item["valor_ideal"]) for item in profile_rows}
        profile_weights = {
            item["categoria_chave"]: (
                float(item["peso_distancia"])
                if item.get("peso_distancia") is not None
                else weights.get(item["categoria_chave"], 0.0)
            )
            for item in profile_rows
        }
        cursor.execute(
            """
            SELECT resultado.*,
                   (SELECT SUM(tempo_ativo_segundos) FROM dbo.analise_metricas_respostas metrica WHERE metrica.id_prova=resultado.id_prova) AS tempo_ativo_total
            FROM dbo.resultados_analiticos_processos resultado
            WHERE resultado.id_processo_ref=?
            ORDER BY resultado.id_resultado_analitico
            """,
            (process_ref,),
        )
        results = rows_to_dicts(cursor, cursor.fetchall())
        cursor.execute(
            "SELECT * FROM dbo.resultados_analiticos_categorias WHERE id_processo_ref=?",
            (process_ref,),
        )
        categories_by_proof: dict[int, list[dict]] = {}
        for category in rows_to_dicts(cursor, cursor.fetchall()):
            categories_by_proof.setdefault(int(category["id_prova"]), []).append(category)
        computed_scores: list[float | None] = []
        time_groups: dict[str, list[tuple[int, float]]] = {}
        computed: list[dict] = []
        for index, result in enumerate(results):
            cats = categories_by_proof.get(int(result["id_prova"]), [])
            percentiles = {item["categoria_chave"]: _safe_float(item.get("percentil")) for item in cats}
            scores = {item["categoria_chave"]: _safe_float(item.get("nota_oficial_normalizada")) for item in cats}
            score, score_reason = weighted_analytical_score(percentiles, weights, required_categories=required)
            adherence, adherence_reason = profile_adherence(scores, profile, profile_weights or weights)
            sample_sizes = [int(item.get("tamanho_amostra") or 0) for item in cats if item.get("tamanho_amostra") is not None]
            sample_size = min(sample_sizes) if sample_sizes else None
            small = sample_size is None or sample_size < int(config.get("amostra_minima") or MINIMUM_COMPARABLE_SAMPLE)
            if result.get("status_analitico") != "Calculado":
                score = None
            computed_scores.append(score)
            total_time = _safe_float(result.get("tempo_ativo_total"))
            if score is not None and total_time is not None:
                signature = normalize_text(result.get("assinatura_comparabilidade"))
                time_groups.setdefault(signature, []).append((index, total_time))
            computed.append({"result": result, "categories": cats, "score": score, "score_reason": score_reason, "adherence": adherence, "adherence_reason": adherence_reason, "sample": sample_size, "small": small})
        rank_groups: dict[str, list[int]] = {}
        for index, item in enumerate(computed):
            if item["score"] is not None:
                signature = normalize_text(item["result"].get("assinatura_comparabilidade"))
                rank_groups.setdefault(signature, []).append(index)
        ranks: dict[int, int | None] = {index: None for index in range(len(computed))}
        overall_percentiles: dict[int, float | None] = {index: None for index in range(len(computed))}
        for indexes in rank_groups.values():
            group_scores = [computed_scores[index] for index in indexes]
            group_ranks = dense_ranks_desc(group_scores)
            group_percentiles = percentile_midrank([float(value) for value in group_scores if value is not None])
            ranks.update({index: rank for index, rank in zip(indexes, group_ranks)})
            overall_percentiles.update({index: percentile for index, percentile in zip(indexes, group_percentiles)})
        time_percentiles: dict[int, float | None] = {}
        for group in time_groups.values():
            indexes = [index for index, _ in group]
            group_percentiles = percentile_midrank([value for _, value in group])
            time_percentiles.update({index: percentile for index, percentile in zip(indexes, group_percentiles)})
        process_closed = is_process_closed(get_process_row(cursor, process_ref) or {})
        for index, item in enumerate(computed):
            result = item["result"]
            score = item["score"]
            indicator = execution_indicator(
                score,
                time_percentiles.get(index),
                complete=bool(result.get("completo")),
                interrupted=any(
                    alert.get("code") == "etapa_interrompida"
                    for alert in safe_json_loads(result.get("alertas_json"), [])
                    if isinstance(alert, dict)
                ),
                low=float(config.get("limiar_execucao_baixo") or EXECUTION_LOW_THRESHOLD),
                high=float(config.get("limiar_execucao_alto") or EXECUTION_HIGH_THRESHOLD),
            )
            explanations = [
                "Score analitico = soma dos pesos de categoria multiplicados pelos respectivos percentis.",
                "Ranking denso: empates compartilham a mesma posicao e nao usam tempo ou dado pessoal como desempate.",
            ]
            if item["score_reason"]:
                explanations.append(item["score_reason"])
            if item["adherence_reason"]:
                explanations.append(item["adherence_reason"])
            category_payload = [
                {
                    "key": cat["categoria_chave"], "name": cat["categoria_nome"],
                    "officialScore": _safe_float(cat.get("nota_oficial_normalizada")),
                    "percentile": _safe_float(cat.get("percentil")), "zScore": _safe_float(cat.get("z_score")),
                    "rank": cat.get("posicao_densa"), "sampleSize": cat.get("tamanho_amostra"),
                    "smallSample": bool(cat.get("amostra_pequena")), "comparable": bool(cat.get("comparavel")),
                    "rawScore": _safe_float(cat.get("score_bruto")), "rawMax": _safe_float(cat.get("pontuacao_maxima")),
                    "expectedComponents": int(cat.get("componentes_esperados") or 0),
                    "completedComponents": int(cat.get("componentes_concluidos") or 0),
                    "completionStatus": cat.get("status_completude"),
                    "answerKeyVersion": cat.get("gabarito_versao") or "legado",
                    "weight": weights.get(cat["categoria_chave"]),
                    "contribution": None if cat.get("percentil") is None or cat["categoria_chave"] not in weights else round(float(cat["percentil"]) * weights[cat["categoria_chave"]], 3),
                }
                for cat in item["categories"]
            ]
            ranking_status = "Indisponivel" if score is None else "Definitivo" if process_closed else "Provisorio"
            cursor.execute(
                """
                UPDATE dbo.resultados_analiticos_processos
                SET id_configuracao=?, configuracao_versao=?, score_analitico=?, percentil_geral=?, posicao_densa=?, ranking_status=?,
                    tamanho_amostra=?, amostra_pequena=?, aderencia_perfil=?, indicador_execucao=?,
                    categorias_json=?, explicacoes_json=?, atualizado_em=SYSUTCDATETIME()
                WHERE id_resultado_analitico=?
                """,
                (
                    config["id_configuracao"], config["versao"], score, overall_percentiles[index], ranks[index], ranking_status, item["sample"],
                    1 if item["small"] else 0, item["adherence"], indicator,
                    _json(category_payload), _json(explanations), result["id_resultado_analitico"],
                ),
            )

    def _process_single_exam_analytics(self, cursor, job: dict) -> str:
        row = self._analytics_exam_row(cursor, int(job["id_prova"]))
        questions = safe_json_loads(row.get("questoes_json"), [])
        stages = safe_json_loads(row.get("etapas_json"), [])
        configuration = safe_json_loads(row.get("configuracao_json"), {})
        row["gabarito_versao"] = answer_key_version(questions, configuration)
        result = {
            "score_por_categoria": safe_json_loads(row.get("score_por_categoria_json"), {}),
            "resumo_etapas": safe_json_loads(row.get("resumo_etapas_json"), []),
        }
        source_categories = derive_categories(result)
        config = self._ensure_process_config(cursor, row, source_categories)
        categories = self._map_analytical_categories(cursor, config, source_categories)
        signature = comparison_signature(questions, stages, configuration)
        complete = bool(row.get("resultado_atualizado_em")) and not bool(row.get("pendente_avaliacao_manual")) and bool(categories) and all(item.get("complete") for item in categories)
        comparable = complete and normalize_text(row.get("status")) not in {"Reaberta", "Cancelada", "Expirada"}
        self._replace_complementary_details(cursor, row, questions)
        self._upsert_category_results(cursor, row, config, categories, signature, complete, comparable)
        self._upsert_read_model(
            cursor,
            row,
            config,
            categories,
            signature,
            complete,
            comparable,
            reason=normalize_text(job.get("motivo")),
        )
        return normalize_text(row.get("id_processo_ref")) or normalize_text(row.get("id_processo")) or f"prova-{row['id_prova']}"

    def process_exam_analytics_job(self, job: dict) -> None:
        conn = self._connect()
        lock_resource = f"exam-analytics:{hashlib.sha256(normalize_text(job.get('id_processo_ref')).encode('utf-8')).hexdigest()[:40]}"
        lock_acquired = False
        jobs = [job]
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            cursor.execute(
                """
                DECLARE @lock_result INT;
                EXEC @lock_result = sys.sp_getapplock
                    @Resource=?, @LockMode=N'Exclusive', @LockOwner=N'Session', @LockTimeout=30000;
                SELECT @lock_result;
                """,
                (lock_resource,),
            )
            lock_result = int(cursor.fetchone()[0])
            if lock_result < 0:
                raise RuntimeError("Outro worker esta consolidando o mesmo processo.")
            lock_acquired = True
            cursor.execute(
                """
                ;WITH lote AS (
                    SELECT TOP 19 *
                    FROM dbo.analise_jobs_provas WITH (UPDLOCK, READPAST, ROWLOCK)
                    WHERE id_processo_ref=? AND id_job<>?
                      AND status_job IN (N'Pendente', N'Falhou')
                      AND tentativas < max_tentativas
                      AND disponivel_em <= SYSUTCDATETIME()
                    ORDER BY prioridade, disponivel_em, id_job
                )
                UPDATE lote
                SET status_job=N'Processando', tentativas=tentativas+1,
                    bloqueado_por=?, bloqueado_em=SYSUTCDATETIME(),
                    iniciado_em=COALESCE(iniciado_em,SYSUTCDATETIME()), atualizado_em=SYSUTCDATETIME()
                OUTPUT inserted.*;
                """,
                (normalize_text(job.get("id_processo_ref")), int(job["id_job"]), normalize_text(job.get("bloqueado_por")) or "worker"),
            )
            coalesced = rows_to_dicts(cursor, cursor.fetchall())
            jobs = [job, *coalesced]
            conn.commit()
            process_refs = {self._process_single_exam_analytics(cursor, item) for item in jobs}
            for process_ref in process_refs:
                self._recalculate_process_cohort(cursor, process_ref)
            job_ids = [int(item["id_job"]) for item in jobs]
            placeholders = ",".join("?" for _ in job_ids)
            cursor.execute(
                f"""
                UPDATE dbo.analise_jobs_provas
                SET status_job=N'Concluido', bloqueado_por=NULL, bloqueado_em=NULL,
                    codigo_erro=NULL, ultimo_erro=NULL, finalizado_em=SYSUTCDATETIME(), atualizado_em=SYSUTCDATETIME()
                WHERE id_job IN ({placeholders})
                """,
                tuple(job_ids),
            )
            conn.commit()
            if lock_acquired:
                conn.cursor().execute("EXEC sys.sp_releaseapplock @Resource=?, @LockOwner=N'Session'", (lock_resource,))
                lock_acquired = False
            try:
                self.record_audit_log(
                    user={"nome": "Worker analitico", "perfil_nome": "Sistema"},
                    modulo="Provas",
                    acao="concluir_consolidacao_analitica",
                    entidade="processo",
                    entidade_id=normalize_text(job.get("id_processo_ref")),
                    valor_novo={"jobCount": len(jobs), "algorithmVersion": ANALYTICS_ALGORITHM_VERSION},
                    origem="worker",
                    sucesso=True,
                )
            except Exception as audit_exc:
                self.logger.debug("Falha ao registrar log de auditoria de consolidacao analitica: %s", audit_exc)
        except Exception as exc:
            conn.rollback()
            if lock_acquired:
                try:
                    conn.cursor().execute("EXEC sys.sp_releaseapplock @Resource=?, @LockOwner=N'Session'", (lock_resource,))
                except Exception as unlock_exc:
                    self.logger.debug("Falha ao liberar applock apos erro de consolidacao: %s", unlock_exc)
                lock_acquired = False
            for failed_job in jobs:
                try:
                    self.fail_exam_analytics_job(failed_job, exc)
                except Exception as mark_failed_exc:
                    self.logger.warning("Falha ao marcar job analitico como falho: %s", mark_failed_exc)
            raise
        finally:
            if lock_acquired:
                try:
                    conn.cursor().execute("EXEC sys.sp_releaseapplock @Resource=?, @LockOwner=N'Session'", (lock_resource,))
                except Exception as unlock_exc:
                    self.logger.debug("Falha ao liberar applock no bloco finally: %s", unlock_exc)
            conn.close()

    def fail_exam_analytics_job(self, job: dict, error: Exception) -> None:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            attempts = int(job.get("tentativas") or 1)
            max_attempts = int(job.get("max_tentativas") or 5)
            delay_minutes = min(60, 2 ** max(0, attempts - 1))
            next_status = "Falhou" if attempts < max_attempts else "Cancelado"
            error_type = re.sub(r"[^A-Za-z0-9_.-]", "", type(error).__name__)[:80] or "Error"
            sanitized_error = f"{error_type}: falha no processamento analitico; consulte o log tecnico pelo id do job."
            cursor.execute(
                """
                UPDATE dbo.analise_jobs_provas
                SET status_job=?, bloqueado_por=NULL, bloqueado_em=NULL, codigo_erro=N'ANALYTICS_PROCESSING_FAILED', ultimo_erro=?,
                    disponivel_em=DATEADD(MINUTE, ?, SYSUTCDATETIME()),
                    finalizado_em=CASE WHEN ?=N'Cancelado' THEN SYSUTCDATETIME() ELSE finalizado_em END,
                    atualizado_em=SYSUTCDATETIME()
                WHERE id_job=?
                """,
                (next_status, sanitized_error, delay_minutes, next_status, int(job["id_job"])),
            )
            conn.commit()
            try:
                self.record_audit_log(
                    user={"nome": "Worker analitico", "perfil_nome": "Sistema"},
                    modulo="Provas",
                    acao="falhar_processamento_analitico",
                    entidade="prova",
                    entidade_id=str(job.get("id_prova") or ""),
                    valor_novo={"status": next_status, "code": "ANALYTICS_PROCESSING_FAILED", "attempt": attempts},
                    justificativa="Falha tecnica sanitizada; consulte a fila analitica.",
                    origem="worker",
                    sucesso=False,
                )
            except Exception as audit_exc:
                self.logger.debug("Falha ao registrar log de auditoria de falha analitica: %s", audit_exc)
        finally:
            conn.close()

    def _resolved_process(self, cursor, process_id: str) -> tuple[str, str, dict]:
        process = get_process_row(cursor, process_id)
        if not process:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo nao encontrado.")
        process_ref = normalize_text(process.get("id_processo_ref")) or normalize_text(process.get("id_processo"))
        return normalize_text(process.get("id_processo")), process_ref, process

    def list_process_analytical_results(self, process_id: str, filters: dict) -> dict:
        page = max(1, int(filters.get("page") or 1))
        page_size = max(5, min(100, int(filters.get("page_size") or 20)))
        search = normalize_text(filters.get("search"))
        analytics_status = normalize_text(filters.get("status"))
        stage = normalize_text(filters.get("stage"))
        category = normalize_text(filters.get("category"))
        flag = normalize_text(filters.get("flag"))
        sort_key = normalize_text(filters.get("sort")) or "ranking"
        direction = "ASC" if normalize_text(filters.get("direction")).lower() == "asc" else "DESC"
        sort_columns = {
            "ranking": "posicao_densa", "candidate": "nome_candidato", "official_score": "nota_oficial",
            "analytical_score": "score_analitico", "adherence": "aderencia_perfil", "updated_at": "atualizado_em",
        }
        sort_column = sort_columns.get(sort_key, "posicao_densa")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            _, process_ref, process = self._resolved_process(cursor, process_id)
            where = ["id_processo_ref = ?"]
            params: list[Any] = [process_ref]
            if search:
                where.append("(nome_candidato LIKE ? OR id_teste LIKE ?)")
                params.extend([f"%{search}%", f"%{search}%"])
            if analytics_status:
                where.append("status_analitico = ?")
                params.append(analytics_status)
            if stage:
                where.append("EXISTS (SELECT 1 FROM OPENJSON(etapas_json) etapa WHERE JSON_VALUE(etapa.value,'$.key')=? OR JSON_VALUE(etapa.value,'$.label')=?)")
                params.extend([stage, stage])
            if category:
                where.append("EXISTS (SELECT 1 FROM OPENJSON(categorias_json) categoria WHERE JSON_VALUE(categoria.value,'$.key')=? OR JSON_VALUE(categoria.value,'$.name')=?)")
                params.extend([category, category])
            if flag:
                where.append("EXISTS (SELECT 1 FROM OPENJSON(alertas_json) alerta WHERE JSON_VALUE(alerta.value,'$.code')=?)")
                params.append(flag)
            if filters.get("score_min") is not None:
                where.append("score_analitico >= ?")
                params.append(float(filters["score_min"]))
            if filters.get("score_max") is not None:
                where.append("score_analitico <= ?")
                params.append(float(filters["score_max"]))
            if filters.get("adherence_min") is not None:
                where.append("aderencia_perfil >= ?")
                params.append(float(filters["adherence_min"]))
            if filters.get("adherence_max") is not None:
                where.append("aderencia_perfil <= ?")
                params.append(float(filters["adherence_max"]))
            if filters.get("pending_analysis") is not None:
                where.append("status_analitico IN (N'Pendente',N'Parcial')" if filters["pending_analysis"] else "status_analitico NOT IN (N'Pendente',N'Parcial')")
            if filters.get("comparable") is not None:
                where.append("comparavel = ?")
                params.append(1 if filters["comparable"] else 0)
            if filters.get("manual_correction") is not None:
                where.append(
                    "EXISTS (SELECT 1 FROM dbo.historico_correcoes_manuais_provas manual WHERE manual.id_prova=resultados_analiticos_processos.id_prova)"
                    if filters["manual_correction"]
                    else "NOT EXISTS (SELECT 1 FROM dbo.historico_correcoes_manuais_provas manual WHERE manual.id_prova=resultados_analiticos_processos.id_prova)"
                )
            predicate = " AND ".join(where)
            cursor.execute(f"SELECT COUNT(*) FROM dbo.resultados_analiticos_processos WHERE {predicate}", tuple(params))
            total = int(cursor.fetchone()[0] or 0)
            offset = (page - 1) * page_size
            cursor.execute(
                f"""
                SELECT id_prova,id_teste,id_registro,nome_candidato,vaga,status_prova,status_correcao_oficial,
                       nota_oficial,status_analitico,motivo_indisponibilidade,score_analitico,percentil_geral,posicao_densa,ranking_status,
                       tamanho_amostra,amostra_pequena,aderencia_perfil,indicador_execucao,alertas_json,
                       comparavel,correcao_manual_pendente,notas_oficiais_json,
                       gabarito_versao,algoritmo_versao,atualizado_em
                FROM dbo.resultados_analiticos_processos
                WHERE {predicate}
                ORDER BY CASE WHEN {sort_column} IS NULL THEN 1 ELSE 0 END, {sort_column} {direction}, id_resultado_analitico ASC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
                """,
                (*params, offset, page_size),
            )
            items = rows_to_dicts(cursor, cursor.fetchall())
            for item in items:
                item["alertas"] = safe_json_loads(item.pop("alertas_json", None), [])
                item["notas_oficiais"] = safe_json_loads(item.pop("notas_oficiais_json", None), {})
            return {"success": True, "process": {"id": process.get("id_processo"), "ref": process_ref, "vacancy": process.get("vaga"), "status": process.get("status")}, "items": items, "pagination": {"page": page, "pageSize": page_size, "total": total, "pages": max(1, (total + page_size - 1) // page_size)}}
        finally:
            conn.close()

    def get_process_analytical_status(self, process_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            process_key, process_ref, process = self._resolved_process(cursor, process_id)
            cursor.execute("SELECT status_analitico,COUNT(*) AS total FROM dbo.resultados_analiticos_processos WHERE id_processo_ref=? GROUP BY status_analitico", (process_ref,))
            status_counts = {item["status_analitico"]: int(item["total"]) for item in rows_to_dicts(cursor, cursor.fetchall())}
            cursor.execute("SELECT status_job,COUNT(*) AS total FROM dbo.analise_jobs_provas WHERE id_processo_ref=? GROUP BY status_job", (process_ref,))
            job_counts = {item["status_job"]: int(item["total"]) for item in rows_to_dicts(cursor, cursor.fetchall())}
            cursor.execute("SELECT MAX(atualizado_em) FROM dbo.resultados_analiticos_processos WHERE id_processo_ref=?", (process_ref,))
            latest = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(DISTINCT id_teste) FROM dbo.provas_geradas WHERE id_processo_ref=? OR (ISNULL(id_processo_ref,'')='' AND id_processo=?)", (process_ref, process_key))
            proof_count = int(cursor.fetchone()[0] or 0)
            cursor.execute("SELECT COUNT(*) FROM dbo.candidatos_processos WHERE id_processo_ref=? OR (ISNULL(id_processo_ref,'')='' AND id_processo=?)", (process_ref, process_key))
            candidate_count = int(cursor.fetchone()[0] or 0)
            cursor.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN comparavel=1 THEN 1 ELSE 0 END) AS comparaveis, SUM(CASE WHEN posicao_densa IS NOT NULL THEN 1 ELSE 0 END) AS ranqueados FROM dbo.resultados_analiticos_processos WHERE id_processo_ref=?", (process_ref,))
            summary_row = rows_to_dicts(cursor, cursor.fetchall())[0]
            pending_jobs = int(job_counts.get("Pendente", 0)) + int(job_counts.get("Processando", 0))
            failed_jobs = int(job_counts.get("Falhou", 0)) + int(job_counts.get("Cancelado", 0))
            processing_status = "Com falhas" if failed_jobs else "Processamento pendente" if pending_jobs else "Atualizado"
            return {"success": True, "processId": process_key, "processRef": process_ref, "processStatus": process.get("status"), "processingStatus": processing_status, "results": status_counts, "jobs": job_counts, "summary": {"candidates": candidate_count, "proofs": proof_count, "completed": int(status_counts.get("Calculado", 0)), "pending": int(status_counts.get("Pendente", 0)) + int(status_counts.get("Parcial", 0)), "errors": failed_jobs, "comparable": int(summary_row.get("comparaveis") or 0), "ranked": int(summary_row.get("ranqueados") or 0)}, "updatedAt": latest, "algorithmVersion": ANALYTICS_ALGORITHM_VERSION, "thresholds": {"minimumSample": MINIMUM_COMPARABLE_SAMPLE, "low": EXECUTION_LOW_THRESHOLD, "high": EXECUTION_HIGH_THRESHOLD}}
        finally:
            conn.close()

    def get_candidate_analytical_detail(self, process_id: str, candidate_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            _, process_ref, _ = self._resolved_process(cursor, process_id)
            cursor.execute("SELECT * FROM dbo.resultados_analiticos_processos WHERE id_processo_ref=? AND (id_teste=? OR CONVERT(NVARCHAR(30),id_registro)=?)", (process_ref, candidate_id, candidate_id))
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resultado analitico do candidato nao encontrado.")
            detail = rows[0]
            id_prova = int(detail["id_prova"])
            cursor.execute("SELECT questao_indice,questao_id,etapa_chave,categoria_chave,primeiro_acesso_em,ultima_alteracao_em,tempo_ativo_segundos,quantidade_alteracoes,ordem_resposta,tamanho_resposta_final,evento_colagem,quantidade_colagens,tamanho_colagem_aproximado FROM dbo.analise_metricas_respostas WHERE id_prova=? ORDER BY questao_indice", (id_prova,))
            telemetry = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT questao_indice,item_chave,item_rotulo,status_item,pontuacao,pontuacao_maxima,confianca,celula_esperada,celula_encontrada,valor_esperado,valor_encontrado,formula_encontrada,metodo_identificado,tolerancia_utilizada,justificativa,gabarito_versao,algoritmo_versao,detalhes_json FROM dbo.analise_excel_detalhes WHERE id_prova=? ORDER BY questao_indice,id_detalhe_excel", (id_prova,))
            excel = rows_to_dicts(cursor, cursor.fetchall())
            for item in excel:
                item["detalhes"] = safe_json_loads(item.pop("detalhes_json", None), {})
            cursor.execute("SELECT questao_indice,quantidade_caracteres,quantidade_palavras,quantidade_palavras_unicas,quantidade_sentencas,quantidade_paragrafos,media_palavras_sentenca,riqueza_lexical,indice_legibilidade,ocorrencias_ortograficas,taxa_ocorrencias_palavra,indicadores_estrutura_json,aderencia_termos_json,ortografia_status,gabarito_versao,metrica_versao FROM dbo.analise_texto_detalhes WHERE id_prova=? ORDER BY questao_indice", (id_prova,))
            texts = rows_to_dicts(cursor, cursor.fetchall())
            for item in texts:
                item["indicadores_estrutura"] = safe_json_loads(item.pop("indicadores_estrutura_json", None), {})
                item["aderencia_termos"] = safe_json_loads(item.pop("aderencia_termos_json", None), {})
            cursor.execute("SELECT etapa_chave,iniciada_em,finalizada_em,status_etapa,tempo_ativo_segundos,ultima_questao_indice FROM dbo.analise_sessoes_etapas WHERE id_prova=? ORDER BY id_sessao", (id_prova,))
            stage_sessions = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute(
                """
                SELECT questao_indice,questao_id,texto_questao_snapshot,alternativas_snapshot,
                       resposta_json,resposta_correta,categoria,peso,correta,nota
                FROM dbo.respostas_provas
                WHERE id_prova=? AND correta IS NOT NULL
                ORDER BY questao_indice
                """,
                (id_prova,),
            )
            objective_details = []
            for objective in rows_to_dicts(cursor, cursor.fetchall()):
                answer = safe_json_loads(objective.pop("resposta_json", None), None)
                if isinstance(answer, dict):
                    safe_answer = {key: answer.get(key) for key in ("selected", "selections") if key in answer}
                elif answer is None or isinstance(answer, (str, int, float, bool)):
                    safe_answer = answer
                else:
                    safe_answer = None
                objective["resposta"] = safe_answer
                objective["gabarito"] = safe_json_loads(objective.pop("resposta_correta", None), None)
                objective["alternativas"] = safe_json_loads(objective.pop("alternativas_snapshot", None), [])
                objective_details.append(objective)
            for field in ("categorias_json", "etapas_json", "alertas_json", "explicacoes_json"):
                detail[field.removesuffix("_json")] = safe_json_loads(detail.pop(field, None), [])
            detail["notas_oficiais"] = safe_json_loads(detail.pop("notas_oficiais_json", None), {})
            return {"success": True, "result": detail, "telemetry": telemetry, "stageSessions": stage_sessions, "executionSummary": {"activeSeconds": round(sum(float(item.get("tempo_ativo_segundos") or 0) for item in telemetry), 3), "changes": sum(int(item.get("quantidade_alteracoes") or 0) for item in telemetry), "answerOrder": [item.get("questao_indice") for item in sorted(telemetry, key=lambda entry: int(entry.get("ordem_resposta") or 1000000)) if item.get("ordem_resposta") is not None], "comparisonUniverse": detail.get("tamanho_amostra")}, "objectiveDetails": objective_details, "excelDetails": excel, "textDetails": texts, "privacy": {"rawTextAnswersReturned": False, "rawFilesReturned": False, "clipboardContentCollected": False}}
        finally:
            conn.close()

    def compare_process_candidates(self, process_id: str, candidate_ids: list[str]) -> dict:
        unique = list(dict.fromkeys(normalize_text(item) for item in candidate_ids if normalize_text(item)))
        if len(unique) < 2 or len(unique) > 3 or any(len(item) > 180 for item in unique):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selecione de 2 a 3 candidatos para comparar.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            _, process_ref, _ = self._resolved_process(cursor, process_id)
            placeholders = ",".join("?" for _ in unique)
            cursor.execute(
                f"SELECT * FROM dbo.resultados_analiticos_processos WHERE id_processo_ref=? AND id_teste IN ({placeholders})",
                (process_ref, *unique),
            )
            by_id = {item["id_teste"]: item for item in rows_to_dicts(cursor, cursor.fetchall())}
            if len(by_id) != len(unique):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Um ou mais resultados nao pertencem ao processo.")
            items = [by_id[item] for item in unique]
            for item in items:
                for field in ("categorias_json", "etapas_json", "alertas_json", "explicacoes_json"):
                    item[field.removesuffix("_json")] = safe_json_loads(item.pop(field, None), [])
                item["notas_oficiais"] = safe_json_loads(item.pop("notas_oficiais_json", None), {})
        finally:
            conn.close()
        signatures = {normalize_text(item.get("assinatura_comparabilidade")) for item in items}
        comparable = len(signatures) == 1 and all(bool(item.get("comparavel")) for item in items)
        warnings = []
        reference_signature = normalize_text(items[0].get("assinatura_comparabilidade"))
        assessment_differences = [
            {
                "candidateId": item.get("id_teste"),
                "candidateName": item.get("nome_candidato"),
                "reason": (
                    "Contrato de avaliacao diferente do primeiro candidato."
                    if normalize_text(item.get("assinatura_comparabilidade")) != reference_signature
                    else "Resultado incompleto ou inelegivel para a coorte."
                ),
                "answerKeyVersion": item.get("gabarito_versao") or "legado",
            }
            for item in items
            if normalize_text(item.get("assinatura_comparabilidade")) != reference_signature or not bool(item.get("comparavel"))
        ]
        if not comparable:
            warnings.append("Avaliacoes nao equivalentes ou incompletas; os dados individuais foram mantidos sem conclusao automatica.")
        return {"success": True, "comparable": comparable, "warnings": warnings, "assessmentDifferences": assessment_differences, "comparisonUniverse": min((int(item.get("tamanho_amostra") or 0) for item in items), default=0), "items": items}

    def get_process_analytics_configuration(self, process_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            process_key, process_ref, _ = self._resolved_process(cursor, process_id)
            cursor.execute(
                """
                SELECT DISTINCT categoria_chave AS [key], categoria_nome AS [name]
                FROM dbo.resultados_analiticos_categorias
                WHERE id_processo_ref=?
                ORDER BY categoria_nome
                """,
                (process_ref,),
            )
            available_categories = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT TOP 1 * FROM dbo.configuracoes_analiticas_processos WHERE id_processo_ref=? AND status_configuracao=N'Ativa' ORDER BY versao DESC", (process_ref,))
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                return {"success": True, "processId": process_key, "processRef": process_ref, "configured": False, "configurationStatus": "Incompleta", "availableCategories": available_categories, "weights": [], "idealProfile": [], "mappings": []}
            config = rows[0]
            cursor.execute("SELECT categoria_chave,peso,obrigatoria FROM dbo.pesos_analiticos_processos WHERE id_configuracao=? ORDER BY categoria_chave", (config["id_configuracao"],))
            weights = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT categoria_chave,valor_ideal,peso_distancia FROM dbo.perfis_ideais_analiticos WHERE id_configuracao=? ORDER BY categoria_chave", (config["id_configuracao"],))
            profile = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT origem_tipo,origem_chave,categoria_chave FROM dbo.mapeamentos_categorias_analiticas WHERE id_configuracao=? AND ativo=1 ORDER BY origem_tipo,origem_chave", (config["id_configuracao"],))
            mappings = rows_to_dicts(cursor, cursor.fetchall())
            weight_total = sum(float(item.get("peso") or 0) for item in weights)
            weight_keys = {item["categoria_chave"] for item in weights}
            mapped_keys = {item["categoria_chave"] for item in mappings}
            configured = bool(weights) and abs(weight_total - 1.0) <= 0.0001 and mapped_keys.issubset(weight_keys)
            return {"success": True, "processId": process_key, "processRef": process_ref, "configured": configured, "configurationStatus": "Ativa" if configured else "Incompleta", "version": config["versao"], "algorithmVersion": config["algoritmo_versao"], "minimumSample": config["amostra_minima"], "thresholds": {"low": config["limiar_execucao_baixo"], "high": config["limiar_execucao_alto"]}, "availableCategories": available_categories, "weights": weights, "idealProfile": profile, "mappings": mappings}
        finally:
            conn.close()

    def _save_new_configuration(self, cursor, process_key: str, process_ref: str, weights: list[dict], profile: list[dict], updated_by: str, mappings: list[dict] | None = None) -> int:
        normalized_weights = []
        for item in weights:
            key = normalize_text(item.get("categoria_chave") or item.get("categoryKey"))[:120]
            value = _safe_float(item.get("peso") if item.get("peso") is not None else item.get("weight"))
            if not key or value is None or value < 0 or value > 1:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Peso de categoria invalido.")
            normalized_weights.append({"key": key, "weight": value, "required": bool(item.get("obrigatoria", item.get("required", True)))})
        if not normalized_weights or abs(sum(item["weight"] for item in normalized_weights) - 1.0) > 0.0001:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Os pesos devem totalizar exatamente 100%.")
        if len({item["key"] for item in normalized_weights}) != len(normalized_weights):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Categorias duplicadas na configuracao.")
        cursor.execute("SELECT ISNULL(MAX(versao),0)+1 FROM dbo.configuracoes_analiticas_processos WHERE id_processo_ref=?", (process_ref,))
        version = int(cursor.fetchone()[0] or 1)
        cursor.execute("SELECT TOP 1 id_configuracao FROM dbo.configuracoes_analiticas_processos WHERE id_processo_ref=? AND status_configuracao=N'Ativa' ORDER BY versao DESC", (process_ref,))
        previous_row = cursor.fetchone()
        previous_config_id = int(previous_row[0]) if previous_row else None
        if mappings is None and previous_config_id is not None:
            cursor.execute("SELECT origem_tipo,origem_chave,categoria_chave FROM dbo.mapeamentos_categorias_analiticas WHERE id_configuracao=? AND ativo=1", (previous_config_id,))
            mappings = rows_to_dicts(cursor, cursor.fetchall())
        mappings = mappings or []
        cursor.execute("UPDATE dbo.configuracoes_analiticas_processos SET status_configuracao=N'Arquivada', atualizado_em=SYSUTCDATETIME(), atualizado_por=? WHERE id_processo_ref=? AND status_configuracao=N'Ativa'", (updated_by, process_ref))
        cursor.execute("INSERT INTO dbo.configuracoes_analiticas_processos (id_processo,id_processo_ref,versao,algoritmo_versao,amostra_minima,limiar_execucao_baixo,limiar_execucao_alto,criado_por,atualizado_por) OUTPUT inserted.id_configuracao VALUES (?,?,?,?,?,?,?,?,?)", (process_key, process_ref, version, ANALYTICS_ALGORITHM_VERSION, MINIMUM_COMPARABLE_SAMPLE, EXECUTION_LOW_THRESHOLD, EXECUTION_HIGH_THRESHOLD, updated_by, updated_by))
        config_id = int(cursor.fetchone()[0])
        for item in normalized_weights:
            cursor.execute("IF NOT EXISTS (SELECT 1 FROM dbo.categorias_analiticas WHERE chave=?) INSERT INTO dbo.categorias_analiticas(chave,nome,sistema) VALUES(?,?,0)", (item["key"], item["key"], item["key"]))
            cursor.execute("INSERT INTO dbo.pesos_analiticos_processos(id_configuracao,categoria_chave,peso,obrigatoria) VALUES(?,?,?,?)", (config_id, item["key"], item["weight"], 1 if item["required"] else 0))
        valid_keys = {item["key"] for item in normalized_weights}
        seen_origins: set[tuple[str, str]] = set()
        for item in mappings:
            origin_type = normalize_text(item.get("origem_tipo") or item.get("originType") or "Etapa").title()
            origin_key = normalize_text(item.get("origem_chave") or item.get("originKey"))[:180]
            category_key_value = normalize_text(item.get("categoria_chave") or item.get("categoryKey"))[:120]
            origin = (origin_type, origin_key)
            if origin_type not in {"Etapa", "Questao"} or not origin_key or not category_key_value or origin in seen_origins:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mapeamento de categoria invalido ou duplicado.")
            seen_origins.add(origin)
            cursor.execute("IF NOT EXISTS (SELECT 1 FROM dbo.categorias_analiticas WHERE chave=?) INSERT INTO dbo.categorias_analiticas(chave,nome,sistema) VALUES(?,?,0)", (category_key_value, category_key_value, category_key_value))
            cursor.execute("INSERT INTO dbo.mapeamentos_categorias_analiticas(id_configuracao,origem_tipo,origem_chave,categoria_chave,criado_por) VALUES(?,?,?,?,?)", (config_id, origin_type, origin_key, category_key_value, updated_by))
        for item in profile:
            key = normalize_text(item.get("categoria_chave") or item.get("categoryKey"))[:120]
            target = _safe_float(item.get("valor_ideal") if item.get("valor_ideal") is not None else item.get("target"))
            distance_weight = _safe_float(item.get("peso_distancia") if item.get("peso_distancia") is not None else item.get("weight"))
            if key not in valid_keys or target is None or target < 0 or target > 100:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Perfil ideal invalido ou sem peso correspondente.")
            cursor.execute("INSERT INTO dbo.perfis_ideais_analiticos(id_configuracao,categoria_chave,valor_ideal,peso_distancia) VALUES(?,?,?,?)", (config_id, key, target, distance_weight))
        cursor.execute("SELECT id_prova,id_teste,id_processo,id_processo_ref,atualizado_em AS prova_atualizado_em FROM dbo.provas_geradas WHERE id_processo_ref=? OR (ISNULL(id_processo_ref,'')='' AND id_processo=?)", (process_ref, process_key))
        for proof in rows_to_dicts(cursor, cursor.fetchall()):
            proof["resultado_atualizado_em"] = f"config-{version}"
            enqueue_exam_analytics_job(cursor, proof, reason=f"configuracao-v{version}")
        return version

    def update_process_analytics_weights(self, process_id: str, payload: dict, *, updated_by: str) -> dict:
        current = self.get_process_analytics_configuration(process_id)
        requested_weights = payload.get("weights") or []
        requested_keys = {normalize_text(item.get("categoria_chave") or item.get("categoryKey")) for item in requested_weights}
        preserved_profile = [item for item in (current.get("idealProfile") or []) if normalize_text(item.get("categoria_chave")) in requested_keys]
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            process_key, process_ref, _ = self._resolved_process(cursor, process_id)
            version = self._save_new_configuration(cursor, process_key, process_ref, requested_weights, preserved_profile, updated_by, current.get("mappings"))
            conn.commit()
            return {"success": True, "version": version, "message": "Pesos salvos; recalculo analitico enfileirado."}
        finally:
            conn.close()

    def update_process_ideal_profile(self, process_id: str, payload: dict, *, updated_by: str) -> dict:
        current = self.get_process_analytics_configuration(process_id)
        if not current.get("configured"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configure os pesos antes do perfil ideal.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            process_key, process_ref, _ = self._resolved_process(cursor, process_id)
            version = self._save_new_configuration(cursor, process_key, process_ref, current["weights"], payload.get("ideal_profile") or payload.get("idealProfile") or [], updated_by, current.get("mappings"))
            conn.commit()
            return {"success": True, "version": version, "message": "Perfil ideal salvo; recalculo analitico enfileirado."}
        finally:
            conn.close()

    def update_process_category_mappings(self, process_id: str, payload: dict, *, updated_by: str) -> dict:
        current = self.get_process_analytics_configuration(process_id)
        if not current.get("weights"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configure os pesos antes do mapeamento de categorias.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_exam_analytics_tables(cursor)
            process_key, process_ref, _ = self._resolved_process(cursor, process_id)
            version = self._save_new_configuration(
                cursor, process_key, process_ref, current["weights"], current.get("idealProfile") or [],
                updated_by, payload.get("mappings") or [],
            )
            conn.commit()
            return {"success": True, "version": version, "message": "Mapeamentos salvos; recalculo analitico enfileirado."}
        finally:
            conn.close()


__all__ = [
    "ExamAnalyticsRepositoryMixin",
    "enqueue_exam_analytics_job",
    "persist_exam_telemetry",
]

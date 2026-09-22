from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status

from ..cache import get_cache_client
from ..services.analytics import build_analysis_from_payload
from ..services.helpers import normalize_compare_text, normalize_text, parse_float_br, rows_to_dicts, safe_json_loads
from ..services.pipeline import PIPELINE_STAGES, normalize_pipeline_stage
from ..services.process_flow import (
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_NOT_QUALIFIED,
    CANDIDATE_STATUS_TALENT_BANK,
    CANDIDATE_STATUS_WITHDREW,
    canonicalize_candidate_status,
    normalize_process_status,
)
from .bootstrap import (
    _select_process_row_from_rows,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    get_process_row,
    get_process_rows,
)
from .security import _mask_email, _mask_phone


logger = logging.getLogger(__name__)

# Cache de queries (roadmap de expansão, respostas.txt): o dashboard de funil
# agrega TODOS os candidatos de `candidatos_processos` em memória a cada
# chamada — caro e lido com frequência (tela de dashboard do RH). Diferente
# das datas comemorativas/templates, o dado subjacente muda o tempo todo
# (qualquer movimentação de candidato), então em vez de invalidação ativa em
# cada escrita (o que tocaria dezenas de pontos de gravação em todo o
# sistema) usamos um TTL curto — 60s é uma janela aceitável de defasagem para
# um dashboard analítico, e evita recalcular o funil inteiro a cada refresh
# de tela.
_FUNNEL_DASHBOARD_CACHE_TTL_SECONDS = 60


def _parse_date_filter(value: str | None, *, end: bool = False):
    safe_value = normalize_text(value)
    if not safe_value:
        return None

    try:
        parsed = date.fromisoformat(safe_value[:10])
    except ValueError:
        return None

    return datetime.combine(parsed, time.max if end else time.min)


def _coerce_datetime(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)

    safe_value = normalize_text(value)
    if not safe_value:
        return None
    if safe_value.endswith("Z"):
        safe_value = f"{safe_value[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(safe_value)
        return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(safe_value[:26], fmt)
            except ValueError:
                continue
    return None


def _in_date_range(value, start_date: str = "", end_date: str = "") -> bool:
    parsed_value = _coerce_datetime(value)
    start = _parse_date_filter(start_date)
    end = _parse_date_filter(end_date, end=True)

    if not parsed_value:
        return not start and not end
    if start and parsed_value < start:
        return False
    if end and parsed_value > end:
        return False
    return True


def _format_report_value(value) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    return normalize_text(value)


def _format_report_date_br(value) -> str:
    parsed = _coerce_datetime(value)
    if not parsed:
        return ""
    return parsed.strftime("%d/%m/%Y")


def _add_days(value, days: int):
    parsed = _coerce_datetime(value)
    if not parsed:
        return None
    return parsed + timedelta(days=days)


def _yes_no(value) -> str:
    return "SIM" if bool(value) else "NÃO"


def _candidate_is_approved(status_value: str) -> bool:
    return canonicalize_candidate_status(status_value) == CANDIDATE_STATUS_APPROVED


def _candidate_is_eliminated(status_value: str) -> bool:
    return canonicalize_candidate_status(status_value) in {
        CANDIDATE_STATUS_ELIMINATED,
        CANDIDATE_STATUS_NOT_QUALIFIED,
        CANDIDATE_STATUS_WITHDREW,
    }


def _candidate_in_talent_bank(status_value: str) -> bool:
    return canonicalize_candidate_status(status_value) == CANDIDATE_STATUS_TALENT_BANK


def _score_by_stage(etapas_json: str) -> dict[str, str]:
    result = {
        "nota_word": "",
        "nota_excel": "",
        "nota_conhecimentos_gerais": "",
        "nota_conhecimentos_tecnicos": "",
        "nota_redacao": "",
    }
    etapas = safe_json_loads(etapas_json, [])
    if not isinstance(etapas, list):
        return result

    for etapa in etapas:
        if not isinstance(etapa, dict):
            continue
        label = normalize_compare_text(etapa.get("label") or etapa.get("key"))
        raw_score = parse_float_br(etapa.get("rawScore"))
        raw_max = parse_float_br(etapa.get("rawMax"))
        nota = round((raw_score / raw_max) * 10, 1) if raw_max else ""
        if nota == "":
            continue
        if "word" in label:
            result["nota_word"] = nota
        elif "excel" in label:
            result["nota_excel"] = nota
        elif "redacao" in label or "reda" in label:
            result["nota_redacao"] = nota
        elif "tecnico" in label or "tecnica" in label:
            result["nota_conhecimentos_tecnicos"] = nota
        elif "gerais" in label or "geral" in label or "conhecimento" in label:
            result["nota_conhecimentos_gerais"] = nota
    return result


def _csv_bytes(rows: list[dict], columns: list[tuple[str, str]]) -> bytes:
    output = io.StringIO(newline="")
    output.write("\ufeff")
    writer = csv.writer(output, delimiter=";", lineterminator="\n")
    writer.writerow([label for label, _ in columns])
    for row in rows:
        writer.writerow([_format_report_value(row.get(key)) for _, key in columns])
    return output.getvalue().encode("utf-8")


def _report_filename(prefix: str, start_date: str = "", end_date: str = "") -> str:
    start = normalize_text(start_date).replace("-", "") or "inicio"
    end = normalize_text(end_date).replace("-", "") or "fim"
    return f"{prefix}_{start}_{end}.csv"


class AnalyticsRepositoryMixin:
    def get_candidate_analytics(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_reference_columns(cursor)
            process_map = self._get_process_map(cursor)
            process_candidate_map = self._get_process_candidate_map(cursor)
            answer_files_map = self._get_answer_files_map(cursor)

            cursor.execute(
                """
                SELECT
                    id_teste,
                    id_processo,
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
                    etapas_json,
                    id_processo_ref
                FROM historico_provas
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            result = []
            for row in rows:
                id_processo = normalize_text(row.get("id_processo"))
                id_processo_ref = normalize_text(row.get("id_processo_ref"))
                id_teste = normalize_text(row.get("id_teste"))
                if not id_processo or id_processo.upper() == "PROCESSO_UNICO":
                    continue

                try:
                    process_row = (
                        process_map.get(id_processo_ref)
                        or process_map.get(id_processo)
                        or get_process_row(cursor, id_processo_ref or id_processo)
                        or {}
                    )
                    analysis = build_analysis_from_payload(
                        row,
                        process_row,
                        process_candidate_map.get(id_teste, {}),
                        answer_files_map.get(id_teste, {}),
                    )
                    status_candidato = normalize_text(analysis.get("status_candidato"))

                    result.append(
                        {
                            "id_teste": analysis.get("id_teste", ""),
                            "id_processo": analysis.get("id_processo", ""),
                            "nome_candidato": analysis.get("nome_candidato", ""),
                            "vaga": analysis.get("vaga", ""),
                            "nota_final": round(parse_float_br(analysis.get("nota_final", 0)), 1),
                            "afinidade_percentual": round(float(analysis.get("afinidade_percentual", 0) or 0), 1),
                            "recomendacao": analysis.get("recomendacao", ""),
                            "parecer_final": analysis.get("parecer_final", ""),
                            "status_candidato": status_candidato,
                        }
                    )
                except Exception as row_error:
                    logger.warning("Falha ao analisar a prova %s: %s", id_teste, row_error)
                    continue

            return result
        finally:
            conn.close()

    def get_candidate_analytics_detail(self, id_teste: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_reference_columns(cursor)
            process_map = self._get_process_map(cursor)
            process_candidate_map = self._get_process_candidate_map(cursor)
            answer_files_map = self._get_answer_files_map(cursor)

            cursor.execute(
                """
                SELECT
                    id_teste,
                    id_processo,
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
                    etapas_json,
                    id_processo_ref
                FROM historico_provas
                WHERE id_teste = ?
                """,
                (id_teste,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prova não encontrada.")

            history_row = rows_to_dicts(cursor, [row])[0]
            process_ref = normalize_text(history_row.get("id_processo_ref"))
            process_id = normalize_text(history_row.get("id_processo"))
            return build_analysis_from_payload(
                history_row,
                process_map.get(process_ref)
                or process_map.get(process_id)
                or get_process_row(cursor, process_ref or process_id)
                or {},
                process_candidate_map.get(id_teste, {}),
                answer_files_map.get(id_teste, {}),
            )
        finally:
            conn.close()

    def _build_candidate_report_fields(
        self,
        item: dict,
        status_candidato: str,
        movement_summary: dict,
        movements: list[dict] | None = None,
    ) -> dict:
        safe_movements = movements or []
        movement_dates = [
            _coerce_datetime(movement.get("criado_em"))
            for movement in safe_movements
            if _coerce_datetime(movement.get("criado_em"))
        ]
        data_entrada = min(movement_dates) if movement_dates else (
            item.get("data_prova_realizada")
            or item.get("data_movimentacao")
            or item.get("data_atualizacao_pipeline")
            or item.get("data_prova")
            or item.get("data_iso")
        )
        data_saida = _add_days(data_entrada, 60)
        stage_scores = _score_by_stage(item.get("etapas_prova_json") or item.get("etapas_json") or "")
        prova_realizada = bool(
            item.get("prova_disponivel")
            or normalize_text(item.get("nota_prova"))
            or normalize_text(item.get("data_prova_realizada"))
        )
        aprovado = _candidate_is_approved(status_candidato)
        eliminado = _candidate_is_eliminated(status_candidato)
        banco_talentos = _candidate_in_talent_bank(status_candidato)
        cv_disponivel = bool(item.get("cv_disponivel"))

        return {
            "id_candidato": item.get("id_registro") or item.get("id_banco") or item.get("id_teste") or "",
            "nome": item.get("nome_candidato") or "",
            "telefone": item.get("whatsapp") or item.get("telefone") or "",
            "e_mail": item.get("email") or "",
            "processo_relatorio": normalize_text(item.get("id_processo")) or normalize_text(item.get("id_processo_ref")) or "",
            "vaga_relatorio": item.get("vaga") or "",
            "data_entrada": _format_report_date_br(data_entrada),
            "movimentacoes_completas": movement_summary.get("movimentacoes") or "",
            "nota_perfil": item.get("nota_perfil") or "",
            "score_cv": item.get("cv_score_final") or "",
            "cv": _yes_no(cv_disponivel),
            "justificativa": item.get("justificativa_indicacao") or item.get("observacao_rh") or "",
            "prova": _yes_no(prova_realizada),
            "data_da_prova": _format_report_date_br(item.get("data_prova_realizada") or item.get("data_prova") or item.get("data_iso")) if prova_realizada else "",
            **stage_scores,
            "aprovacao": _yes_no(aprovado),
            "eliminacao": _yes_no(eliminado),
            "motivo_da_eliminacao": item.get("motivo_eliminacao") if eliminado else "",
            "banco_de_talentos": _yes_no(banco_talentos),
            "data_saida": _format_report_date_br(data_saida),
        }

    def list_process_report(self, start_date: str = "", end_date: str = "") -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            processos = [
                processo
                for processo in get_process_rows(cursor)
                if _in_date_range(processo.get("data_criacao"), start_date, end_date)
            ]

            cursor.execute(
                """
                SELECT
                    id_registro,
                    id_processo,
                    id_processo_ref,
                    status_candidato
                FROM candidatos_processos
                """
            )
            candidatos = rows_to_dicts(cursor, cursor.fetchall())

            linhas = []
            for processo in processos:
                process_ref = normalize_text(processo.get("id_processo_ref"))
                process_id = normalize_text(processo.get("id_processo"))
                candidatos_processo = [
                    candidato
                    for candidato in candidatos
                    if normalize_text(candidato.get("id_processo_ref")) == process_ref
                    or (
                        not normalize_text(candidato.get("id_processo_ref"))
                        and normalize_text(candidato.get("id_processo")) == process_id
                    )
                ]
                aprovados = 0
                eliminados = 0
                for candidato in candidatos_processo:
                    status_candidato = canonicalize_candidate_status(candidato.get("status_candidato"))
                    if status_candidato == CANDIDATE_STATUS_APPROVED:
                        aprovados += 1
                    elif status_candidato in {
                        CANDIDATE_STATUS_ELIMINATED,
                        CANDIDATE_STATUS_NOT_QUALIFIED,
                        CANDIDATE_STATUS_WITHDREW,
                    }:
                        eliminados += 1

                linhas.append(
                    {
                        "nome_relatorio_processo": processo.get("id_processo") or processo.get("vaga") or "",
                        "vaga": processo.get("vaga") or "",
                        "quantidade_vagas": processo.get("quantidade_vagas") or 0,
                        "quantidade_aprovados": aprovados,
                        "quantidade_eliminados_reprovados": eliminados,
                        "data_abertura": processo.get("data_criacao") or "",
                        "data_encerramento": processo.get("data_encerramento") or "",
                        "operacao": processo.get("operacao") or "",
                        "trilha": processo.get("trilha") or "",
                        "status_processo": normalize_process_status(processo.get("status")) or "Aberto",
                    }
                )

            return linhas
        finally:
            conn.close()

    def export_process_report_csv(self, start_date: str = "", end_date: str = "") -> tuple[str, bytes]:
        rows = self.list_process_report(start_date=start_date, end_date=end_date)
        columns = [
            ("Nome do relatório/processo", "nome_relatorio_processo"),
            ("Vaga", "vaga"),
            ("Quantidade de vagas", "quantidade_vagas"),
            ("Quantidade de aprovados", "quantidade_aprovados"),
            ("Quantidade de eliminados/reprovados", "quantidade_eliminados_reprovados"),
            ("Data de abertura", "data_abertura"),
            ("Data de encerramento", "data_encerramento"),
            ("Operação", "operacao"),
            ("Trilha", "trilha"),
            ("Status do processo", "status_processo"),
        ]
        return _report_filename("relatorio_processos", start_date, end_date), _csv_bytes(rows, columns)

    def list_candidate_report(
        self,
        start_date: str = "",
        end_date: str = "",
        status_filter: str = "",
        id_processo: str = "",
    ) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            processos = self._get_process_map(cursor)
            profile_map = self._get_candidate_profile_map(cursor)
            movements_map = self._get_candidate_movements_map(cursor)
            linhas: list[dict] = []
            used_history_ids: set[str] = set()
            safe_process_filter = normalize_compare_text(id_processo)
            safe_status_filter = normalize_compare_text(status_filter)

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
                    etapa_eliminacao
                FROM candidatos_processos
                """
            )
            candidatos_processo = self._attach_process_context(
                cursor,
                self._enrich_candidate_records(cursor, rows_to_dicts(cursor, cursor.fetchall())),
                timestamp_fields=["data_prova", "data_atualizacao_pipeline", "aprovado_em", "eliminado_em"],
            )

            for item in candidatos_processo:
                status_candidato = canonicalize_candidate_status(item.get("status_candidato"))
                process_ref = normalize_text(item.get("id_processo_ref"))
                process_id = normalize_text(item.get("id_processo"))
                if safe_process_filter and safe_process_filter not in normalize_compare_text(process_ref or process_id):
                    continue
                if safe_status_filter and safe_status_filter not in normalize_compare_text(status_candidato):
                    continue

                data_evento = (
                    item.get("aprovado_em")
                    if status_candidato == CANDIDATE_STATUS_APPROVED
                    else item.get("eliminado_em") or item.get("data_atualizacao_pipeline") or item.get("data_prova")
                )
                if not _in_date_range(data_evento, start_date, end_date):
                    continue

                processo = processos.get(process_ref) or processos.get(process_id) or {}
                used_history_ids.add(normalize_text(item.get("id_teste")))
                movement_summary = self._summarize_candidate_movements(
                    item,
                    movements_map.get(normalize_text(item.get("id_teste")), []),
                )
                linhas.append(
                    {
                        **self._build_candidate_report_fields(
                            item,
                            status_candidato,
                            movement_summary,
                            movements_map.get(normalize_text(item.get("id_teste")), []),
                        ),
                        "nome_candidato": item.get("nome_candidato") or "",
                        "processo": process_ref or process_id or "",
                        "vaga": item.get("vaga") or processo.get("vaga") or "",
                        "origem_inicial": movement_summary.get("origem_inicial") or item.get("origem_rotulo") or item.get("origem") or "",
                        "movimentacoes": movement_summary.get("movimentacoes") or "",
                        "data_movimentacao": movement_summary.get("data_movimentacao") or "",
                        "status_anterior": movement_summary.get("status_anterior") or "",
                        "status_novo": movement_summary.get("status_novo") or status_candidato,
                        "usuario_responsavel": movement_summary.get("usuario_responsavel") or "",
                        "observacao_motivo": movement_summary.get("observacao_motivo") or "",
                        "processo_destino": movement_summary.get("processo_destino") or "",
                        "nota_prova": item.get("nota_prova") or item.get("pontuacao_final") or "",
                        "status": status_candidato,
                        "status_atual": status_candidato,
                        "data_aprovacao": item.get("aprovado_em") if status_candidato == CANDIDATE_STATUS_APPROVED else "",
                        "data_eliminacao_reprovacao": data_evento
                        if status_candidato in {
                            CANDIDATE_STATUS_ELIMINATED,
                            CANDIDATE_STATUS_NOT_QUALIFIED,
                            CANDIDATE_STATUS_WITHDREW,
                        }
                        else "",
                        "motivo_eliminacao": item.get("motivo_eliminacao") or (
                            "Motivo não informado" if status_candidato == CANDIDATE_STATUS_ELIMINATED else ""
                        ),
                        "etapa_eliminacao": item.get("etapa_eliminacao") or "",
                        "data_banco_talentos": data_evento if status_candidato == CANDIDATE_STATUS_TALENT_BANK else "",
                        "email": item.get("email") or "",
                        "telefone": item.get("whatsapp") or item.get("telefone") or "",
                        "classificacao_rh": item.get("classificacao_indicacao") or "",
                        "justificativa_observacoes_rh": item.get("justificativa_indicacao") or "",
                        "observacao_rh": item.get("observacao_rh") or "",
                        "cv_disponivel": "Sim" if item.get("cv_disponivel") else "Não",
                        "cv_arquivo": item.get("cv_nome_arquivo") or "",
                        "cv_classificacao": item.get("cv_classificacao") or item.get("classificacao_exibicao") or "",
                    }
                )

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
                    origem
                FROM banco_talentos
                """
            )
            candidatos_banco = self._attach_process_context(
                cursor,
                self._enrich_candidate_records(cursor, rows_to_dicts(cursor, cursor.fetchall())),
                timestamp_fields=["data_movimentacao"],
            )
            for item in candidatos_banco:
                process_ref = normalize_text(item.get("id_processo_ref"))
                process_id = normalize_text(item.get("id_processo"))
                if safe_process_filter and safe_process_filter not in normalize_compare_text(process_ref or process_id):
                    continue
                if safe_status_filter and safe_status_filter not in normalize_compare_text(CANDIDATE_STATUS_TALENT_BANK):
                    continue
                if not _in_date_range(item.get("data_movimentacao"), start_date, end_date):
                    continue

                profile = profile_map.get(normalize_text(item.get("id_teste")), {})
                used_history_ids.add(normalize_text(item.get("id_teste")))
                movement_summary = self._summarize_candidate_movements(
                    {**item, "status_candidato": CANDIDATE_STATUS_TALENT_BANK},
                    movements_map.get(normalize_text(item.get("id_teste")), []),
                )
                linhas.append(
                    {
                        **self._build_candidate_report_fields(
                            item,
                            CANDIDATE_STATUS_TALENT_BANK,
                            movement_summary,
                            movements_map.get(normalize_text(item.get("id_teste")), []),
                        ),
                        "nome_candidato": item.get("nome_candidato") or "",
                        "processo": process_ref or process_id or "",
                        "vaga": item.get("vaga") or "",
                        "origem_inicial": movement_summary.get("origem_inicial") or self._format_candidate_origin(item),
                        "movimentacoes": movement_summary.get("movimentacoes") or "Candidato enviado para Banco de Talentos",
                        "data_movimentacao": movement_summary.get("data_movimentacao") or item.get("data_movimentacao") or "",
                        "status_anterior": movement_summary.get("status_anterior") or "",
                        "status_novo": movement_summary.get("status_novo") or CANDIDATE_STATUS_TALENT_BANK,
                        "usuario_responsavel": movement_summary.get("usuario_responsavel") or "",
                        "observacao_motivo": movement_summary.get("observacao_motivo") or "",
                        "processo_destino": movement_summary.get("processo_destino") or "",
                        "nota_prova": item.get("pontuacao_final") or "",
                        "status": CANDIDATE_STATUS_TALENT_BANK,
                        "status_atual": CANDIDATE_STATUS_TALENT_BANK,
                        "data_aprovacao": "",
                        "data_eliminacao_reprovacao": "",
                        "motivo_eliminacao": "",
                        "etapa_eliminacao": "",
                        "data_banco_talentos": item.get("data_movimentacao") or "",
                        "email": profile.get("email") or "",
                        "telefone": profile.get("whatsapp") or profile.get("telefone") or "",
                        "classificacao_rh": profile.get("classificacao_indicacao") or "",
                        "justificativa_observacoes_rh": profile.get("justificativa_indicacao") or "",
                        "observacao_rh": profile.get("observacao_rh") or "",
                        "cv_disponivel": "Sim" if item.get("cv_disponivel") else "Não",
                        "cv_arquivo": item.get("cv_nome_arquivo") or "",
                        "cv_classificacao": item.get("cv_classificacao") or "",
                    }
                )

            cursor.execute(
                """
                SELECT
                    id_teste,
                    id_processo,
                    id_processo_ref,
                    nome_candidato,
                    vaga,
                    data_iso,
                    pontuacao_final,
                    status
                FROM historico_provas
                """
            )
            for item in self._enrich_candidate_records(cursor, rows_to_dicts(cursor, cursor.fetchall())):
                id_teste = normalize_text(item.get("id_teste"))
                if id_teste in used_history_ids:
                    continue

                status_candidato = canonicalize_candidate_status(item.get("status"))
                process_ref = normalize_text(item.get("id_processo_ref"))
                process_id = normalize_text(item.get("id_processo"))
                processo_label = process_ref or process_id or "Processo único"
                if safe_process_filter and safe_process_filter not in normalize_compare_text(processo_label):
                    continue
                if safe_status_filter and safe_status_filter not in normalize_compare_text(status_candidato):
                    continue
                if not _in_date_range(item.get("data_iso"), start_date, end_date):
                    continue

                used_history_ids.add(id_teste)
                profile = profile_map.get(id_teste, {})
                movement_summary = self._summarize_candidate_movements(
                    {
                        **item,
                        "status_candidato": status_candidato,
                        "origem": "Processo único",
                        "prova_disponivel": True,
                        "nota_prova": item.get("pontuacao_final"),
                    },
                    movements_map.get(id_teste, []),
                )
                linhas.append(
                    {
                        **self._build_candidate_report_fields(
                            item,
                            status_candidato,
                            movement_summary,
                            movements_map.get(id_teste, []),
                        ),
                        "nome_candidato": item.get("nome_candidato") or "",
                        "processo": processo_label,
                        "vaga": item.get("vaga") or "",
                        "origem_inicial": movement_summary.get("origem_inicial") or "Processo único",
                        "movimentacoes": movement_summary.get("movimentacoes") or "Prova realizada",
                        "data_movimentacao": movement_summary.get("data_movimentacao") or item.get("data_iso") or "",
                        "status_anterior": movement_summary.get("status_anterior") or "",
                        "status_novo": movement_summary.get("status_novo") or status_candidato,
                        "usuario_responsavel": movement_summary.get("usuario_responsavel") or "",
                        "observacao_motivo": movement_summary.get("observacao_motivo") or "",
                        "processo_destino": movement_summary.get("processo_destino") or "",
                        "nota_prova": item.get("pontuacao_final") or "",
                        "status": status_candidato,
                        "status_atual": status_candidato,
                        "data_aprovacao": item.get("data_iso") if status_candidato == CANDIDATE_STATUS_APPROVED else "",
                        "data_eliminacao_reprovacao": item.get("data_iso")
                        if status_candidato in {
                            CANDIDATE_STATUS_ELIMINATED,
                            CANDIDATE_STATUS_NOT_QUALIFIED,
                            CANDIDATE_STATUS_WITHDREW,
                        }
                        else "",
                        "motivo_eliminacao": "Motivo não informado" if status_candidato == CANDIDATE_STATUS_ELIMINATED else "",
                        "etapa_eliminacao": "",
                        "data_banco_talentos": "",
                        "email": profile.get("email") or "",
                        "telefone": profile.get("whatsapp") or profile.get("telefone") or "",
                        "classificacao_rh": profile.get("classificacao_indicacao") or "",
                        "justificativa_observacoes_rh": profile.get("justificativa_indicacao") or "",
                        "observacao_rh": profile.get("observacao_rh") or "",
                        "cv_disponivel": "Sim" if item.get("cv_disponivel") else "Não",
                        "cv_arquivo": item.get("cv_nome_arquivo") or "",
                        "cv_classificacao": item.get("cv_classificacao") or item.get("classificacao_exibicao") or "",
                    }
                )

            if not safe_process_filter:
                candidatos_avulsos = self._enrich_candidate_records(
                    cursor,
                    self._get_standalone_generated_exam_candidates(cursor, used_history_ids),
                )
                for item in candidatos_avulsos:
                    id_teste = normalize_text(item.get("id_teste"))
                    if not id_teste or id_teste in used_history_ids:
                        continue

                    status_candidato = canonicalize_candidate_status(item.get("status_candidato"))
                    if safe_status_filter and safe_status_filter not in normalize_compare_text(status_candidato):
                        continue

                    data_evento = (
                        item.get("data_prova_realizada")
                        or item.get("prova_finalizada_em")
                        or item.get("data_prova_gerada")
                        or item.get("data_prova")
                    )
                    if not _in_date_range(data_evento, start_date, end_date):
                        continue

                    used_history_ids.add(id_teste)
                    movimentacoes = movements_map.get(id_teste, [])
                    movement_summary = self._summarize_candidate_movements(
                        {
                            **item,
                            "status_candidato": status_candidato,
                            "origem": "Prova gerada",
                        },
                        movimentacoes,
                    )
                    movimento_padrao = (
                        "Prova avulsa realizada"
                        if item.get("prova_disponivel")
                        else "Prova avulsa gerada"
                    )
                    linhas.append(
                        {
                            **self._build_candidate_report_fields(
                                item,
                                status_candidato,
                                movement_summary,
                                movimentacoes,
                            ),
                            "nome_candidato": item.get("nome_candidato") or "",
                            "processo": "Prova avulsa",
                            "vaga": item.get("vaga") or "",
                            "origem_inicial": "Prova avulsa",
                            "movimentacoes": movement_summary.get("movimentacoes") or movimento_padrao,
                            "data_movimentacao": movement_summary.get("data_movimentacao") or data_evento or "",
                            "status_anterior": movement_summary.get("status_anterior") or "",
                            "status_novo": movement_summary.get("status_novo") or status_candidato,
                            "usuario_responsavel": movement_summary.get("usuario_responsavel") or "",
                            "observacao_motivo": movement_summary.get("observacao_motivo") or "",
                            "processo_destino": movement_summary.get("processo_destino") or "",
                            "nota_prova": item.get("nota_prova") or item.get("pontuacao_final") or "",
                            "status": status_candidato,
                            "status_atual": status_candidato,
                            "data_aprovacao": "",
                            "data_eliminacao_reprovacao": "",
                            "motivo_eliminacao": "",
                            "etapa_eliminacao": "",
                            "data_banco_talentos": "",
                            "email": item.get("email") or "",
                            "telefone": item.get("whatsapp") or item.get("telefone") or "",
                            "classificacao_rh": item.get("classificacao_indicacao") or "",
                            "justificativa_observacoes_rh": item.get("justificativa_indicacao") or "",
                            "observacao_rh": item.get("observacao_rh") or "",
                            "cv_disponivel": "Sim" if item.get("cv_disponivel") else "Não",
                            "cv_arquivo": item.get("cv_nome_arquivo") or "",
                            "cv_classificacao": item.get("cv_classificacao") or item.get("classificacao_exibicao") or "",
                        }
                    )

            return sorted(
                linhas,
                key=lambda item: (
                    _format_report_value(item.get("data_aprovacao"))
                    or _format_report_value(item.get("data_eliminacao_reprovacao"))
                    or _format_report_value(item.get("data_banco_talentos")),
                    normalize_text(item.get("nome_candidato")),
                ),
                reverse=True,
            )
        finally:
            conn.close()

    def export_candidate_report_csv(
        self,
        start_date: str = "",
        end_date: str = "",
        status_filter: str = "",
        id_processo: str = "",
        mask_pii: bool = True,
    ) -> tuple[str, bytes]:
        rows = self.list_candidate_report(
            start_date=start_date,
            end_date=end_date,
            status_filter=status_filter,
            id_processo=id_processo,
        )
        if mask_pii:
            rows = [
                {
                    **row,
                    "telefone": _mask_phone(row["telefone"]) if row.get("telefone") else row.get("telefone", ""),
                    "e_mail": _mask_email(row["e_mail"]) if row.get("e_mail") else row.get("e_mail", ""),
                }
                for row in rows
            ]
        columns = [
            ("ID do Candidato", "id_candidato"),
            ("Nome", "nome"),
            ("Telefone", "telefone"),
            ("E-mail", "e_mail"),
            ("Processo", "processo_relatorio"),
            ("Vaga", "vaga_relatorio"),
            ("Data de Entrada", "data_entrada"),
            ("Movimentações", "movimentacoes_completas"),
            ("Nota de Perfil", "nota_perfil"),
            ("Score do CV", "score_cv"),
            ("CV", "cv"),
            ("Justificativa", "justificativa"),
            ("Prova", "prova"),
            ("Data da Prova", "data_da_prova"),
            ("Nota no Word", "nota_word"),
            ("Nota no Excel", "nota_excel"),
            ("Nota nos Conhecimentos Gerais", "nota_conhecimentos_gerais"),
            ("Nota nos Conhecimentos Técnicos", "nota_conhecimentos_tecnicos"),
            ("Nota da Redação", "nota_redacao"),
            ("Aprovação", "aprovacao"),
            ("Eliminação", "eliminacao"),
            ("Motivo da Eliminação", "motivo_da_eliminacao"),
            ("Banco de Talentos", "banco_de_talentos"),
            ("Data de Saída", "data_saida"),
        ]
        return _report_filename("relatorio_candidatos", start_date, end_date), _csv_bytes(rows, columns)

    def get_funnel_dashboard(
        self,
        start_date: str = "",
        end_date: str = "",
        id_processo: str = "",
    ) -> dict:
        """Dashboard de funil e metricas (time-to-hire).

        Roadmap de expansao (respostas.txt): "dashboard de funil e metricas".
        Todas as consultas sao agregacoes SQL puras sobre `candidatos_processos`
        (sem tabela nova). Decisoes de calculo tomadas nesta v1, sem spec
        exata:

        - time-to-hire (dias): media de (aprovado_em - data_prova) para os
          candidatos com status final "Aprovado" no recorte filtrado.
          `data_prova` e a data de entrada do candidato no processo e
          `aprovado_em` e a data do status final de aprovacao (ambas ja
          existem em `candidatos_processos`).
        - time-to-fill / North Star (dias) (achado BUS-001, S-40): diferente
          do time-to-hire acima, que mede o tempo *dentro* do processo (da
          entrada do candidato ate a aprovacao), este mede da ABERTURA da
          vaga (`processos_seletivos.data_criacao`) ate o PREENCHIMENTO
          efetivo — a data de aprovacao do candidato que completou a cota de
          vagas (`vagas_preenchidas >= quantidade_vagas`, o mesmo criterio
          que `process_auto_close_if_full` ja usa para encerrar o processo
          automaticamente). So entram no calculo processos genuinamente
          preenchidos (nao processos pausados/cancelados/encerrados
          manualmente sem preencher a cota). Reaproveita dado ja existente,
          sem coluna ou tabela nova.
        - funil por etapa: usa a mesma `etapa_pipeline` do Kanban de vagas
          (Triagem/Prova/Entrevista/Aprovado/Reprovado). Como o sistema nao
          mantem um historico de "por quais etapas o candidato passou" (so a
          etapa atual), o percentual de conversao de cada etapa e calculado
          como proporcao sobre o total de candidatos do recorte (uma foto do
          funil atual, nao uma cascata de conversao etapa-a-etapa). Isso e
          simples, explicavel e correto com os dados disponiveis.
        - origem dos candidatos: agrupamento direto pelo campo `origem` de
          `candidatos_processos` (inclui "Indicação" e demais origens ja
          cadastradas).
        """
        cache = get_cache_client()
        cache_key = f"conecta:cache:funnel_dashboard:{start_date}|{end_date}|{id_processo}"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return cached_result

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)

            cursor.execute(
                """
                SELECT
                    id_registro,
                    id_processo,
                    id_processo_ref,
                    status_candidato,
                    etapa_pipeline,
                    origem,
                    data_prova,
                    aprovado_em
                FROM candidatos_processos
                """
            )
            candidatos = rows_to_dicts(cursor, cursor.fetchall())

            safe_process_filter = normalize_compare_text(id_processo)
            candidatos_filtrados = []
            for item in candidatos:
                if not _in_date_range(item.get("data_prova"), start_date, end_date):
                    continue
                if safe_process_filter:
                    process_ref = normalize_compare_text(item.get("id_processo_ref"))
                    process_id = normalize_compare_text(item.get("id_processo"))
                    if safe_process_filter not in process_ref and safe_process_filter not in process_id:
                        continue
                candidatos_filtrados.append(item)

            total_candidatos = len(candidatos_filtrados)

            etapas_contagem = {etapa: 0 for etapa in PIPELINE_STAGES}
            origem_contagem: dict[str, int] = {}
            prazos_contratacao: list[float] = []

            for item in candidatos_filtrados:
                etapa = normalize_pipeline_stage(item.get("etapa_pipeline"))
                etapas_contagem[etapa] = etapas_contagem.get(etapa, 0) + 1

                origem = normalize_text(item.get("origem")) or "Não informado"
                origem_contagem[origem] = origem_contagem.get(origem, 0) + 1

                if canonicalize_candidate_status(item.get("status_candidato")) == CANDIDATE_STATUS_APPROVED:
                    entrada = _coerce_datetime(item.get("data_prova"))
                    aprovacao = _coerce_datetime(item.get("aprovado_em"))
                    if entrada and aprovacao and aprovacao >= entrada:
                        prazos_contratacao.append((aprovacao - entrada).total_seconds() / 86400)

            funil_etapas = [
                {
                    "etapa": etapa,
                    "total": etapas_contagem.get(etapa, 0),
                    "percentual_conversao": (
                        round((etapas_contagem.get(etapa, 0) / total_candidatos) * 100, 1)
                        if total_candidatos
                        else 0.0
                    ),
                }
                for etapa in PIPELINE_STAGES
            ]

            origem_candidatos = [
                {"origem": origem, "total": total}
                for origem, total in sorted(origem_contagem.items(), key=lambda item: item[1], reverse=True)
            ]

            time_to_hire_medio_dias = (
                round(sum(prazos_contratacao) / len(prazos_contratacao), 1) if prazos_contratacao else None
            )

            # Achado BUS-001 (S-40): North Star = tempo de preenchimento de vaga.
            # Filtra por data de PREENCHIMENTO (aprovado_em), nao por data de
            # entrada do candidato (data_prova) — o recorte representa "vagas
            # preenchidas neste periodo", nao "candidatos que entraram neste
            # periodo".
            data_preenchimento_por_processo: dict[str, datetime] = {}
            for item in candidatos:
                if canonicalize_candidate_status(item.get("status_candidato")) != CANDIDATE_STATUS_APPROVED:
                    continue
                if not _in_date_range(item.get("aprovado_em"), start_date, end_date):
                    continue
                if safe_process_filter:
                    process_ref = normalize_compare_text(item.get("id_processo_ref"))
                    process_id = normalize_compare_text(item.get("id_processo"))
                    if safe_process_filter not in process_ref and safe_process_filter not in process_id:
                        continue
                aprovacao = _coerce_datetime(item.get("aprovado_em"))
                if not aprovacao:
                    continue
                chave_processo = normalize_text(item.get("id_processo"))
                if not chave_processo:
                    continue
                atual = data_preenchimento_por_processo.get(chave_processo)
                if atual is None or aprovacao > atual:
                    data_preenchimento_por_processo[chave_processo] = aprovacao

            prazos_preenchimento: list[float] = []
            if data_preenchimento_por_processo:
                # Um único SELECT para todos os processos envolvidos (não um por
                # processo — mesma correção de N+1 já aplicada em S-19).
                processos_por_id: dict[str, list[dict]] = {}
                for processo_row in get_process_rows(cursor):
                    processos_por_id.setdefault(normalize_text(processo_row.get("id_processo")), []).append(
                        processo_row
                    )
            else:
                processos_por_id = {}
            for chave_processo, data_preenchimento in data_preenchimento_por_processo.items():
                processo_row = _select_process_row_from_rows(processos_por_id.get(chave_processo, []))
                if not processo_row:
                    continue
                quantidade_vagas = int(processo_row.get("quantidade_vagas") or 0)
                vagas_preenchidas = int(processo_row.get("vagas_preenchidas") or 0)
                if quantidade_vagas <= 0 or vagas_preenchidas < quantidade_vagas:
                    continue
                abertura = _coerce_datetime(processo_row.get("data_criacao"))
                if not abertura or data_preenchimento < abertura:
                    continue
                prazos_preenchimento.append((data_preenchimento - abertura).total_seconds() / 86400)

            time_to_fill_medio_dias = (
                round(sum(prazos_preenchimento) / len(prazos_preenchimento), 1) if prazos_preenchimento else None
            )

            resultado = {
                "periodo": {"start_date": start_date or "", "end_date": end_date or "", "id_processo": id_processo or ""},
                "total_candidatos": total_candidatos,
                "total_aprovados_considerados": len(prazos_contratacao),
                "time_to_hire_medio_dias": time_to_hire_medio_dias,
                "time_to_fill_medio_dias": time_to_fill_medio_dias,
                "total_vagas_preenchidas_consideradas": len(prazos_preenchimento),
                "funil_etapas": funil_etapas,
                "origem_candidatos": origem_candidatos,
            }
        finally:
            conn.close()

        cache.set(cache_key, resultado, ttl_seconds=_FUNNEL_DASHBOARD_CACHE_TTL_SECONDS)
        return resultado


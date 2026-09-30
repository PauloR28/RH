from __future__ import annotations

import json
import logging
import math
import re
from datetime import datetime

from fastapi import HTTPException, status

from ..auth import AuthenticatedUser
from ..services.helpers import (
    normalize_compare_text,
    normalize_indication_type,
    normalize_text,
    rows_to_dicts,
    safe_json_loads,
)
from ..services.pipeline import infer_pipeline_stage, map_pipeline_stage_to_status, normalize_pipeline_stage
from ..services.process_flow import (
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_NOT_QUALIFIED,
    CANDIDATE_STATUS_QUALIFIED,
    CANDIDATE_STATUS_TALENT_BANK,
    CANDIDATE_STATUS_WITHDREW,
    INTERVIEW_OPERATIONAL_STATUSES,
    PROCESS_STATUS_CANCELED,
    build_approved_candidate_locked_message,
    build_process_closed_message,
    build_terminal_candidate_locked_message,
    canonicalize_candidate_status,
    get_candidate_visible_status,
    is_active_candidate_status,
    is_process_closed,
    is_terminal_candidate_status,
    normalize_process_status,
)
from .bootstrap import (
    build_process_where_clause,
    ensure_process_inactivity_alerts_table,
    ensure_process_dossier_notes_table,
    ensure_pipeline_columns,
    ensure_process_columns,
    ensure_process_reference_columns,
    generate_unique_process_id,
    get_process_row,
    get_process_rows,
    insert_candidate_process_record,
    process_auto_close_if_full,
    resolve_process_row_for_related_record,
)


logger = logging.getLogger(__name__)

# Regra do RH para o "Botao Expresso" (vaga urgente): o recurso deve ficar
# reservado para emergencias reais, entao no maximo esse percentual das vagas
# ABERTAS simultaneamente (contadas na base toda, ver nota abaixo) podem estar
# marcadas como urgentes ao mesmo tempo. Ajuste aqui se o RH pedir outro valor.
LIMITE_PERCENTUAL_VAGAS_URGENTES = 0.2

# Nota de produto: o modelo de dados de processos_seletivos nao tem hoje uma
# coluna de "RH responsavel" ou "empresa" por vaga (nao ha id_usuario_criador
# nem equivalente). Por isso o limite abaixo e calculado sobre TODAS as vagas
# abertas do sistema, nao por RH individual. Se o RH quiser o limite por
# usuario/empresa, sera necessario antes adicionar essa coluna de propriedade
# da vaga - documentado tambem no relatorio final desta tarefa.

# Padrao de mencao em anotacoes de dossie: @usuario, sem validar contra a
# tabela de usuarios (evita expor a lista de usuarios do sistema para quem
# nao tem a permissao usuarios.visualizar so para poder mencionar alguem).
MENTION_PATTERN = re.compile(r"(?<!\w)@([a-zA-Z0-9_.\-]{2,60})")


def extract_note_mentions(texto: str) -> list[str]:
    texto_seguro = normalize_text(texto)
    if not texto_seguro:
        return []
    mencoes: list[str] = []
    for match in MENTION_PATTERN.finditer(texto_seguro):
        usuario = match.group(1)
        if usuario not in mencoes:
            mencoes.append(usuario)
    return mencoes


def attach_note_mentions(rows: list[dict]) -> list[dict]:
    for row in rows:
        row["mencoes"] = safe_json_loads(row.get("mencoes_json"), [])
        if not isinstance(row["mencoes"], list):
            row["mencoes"] = []
        row.pop("mencoes_json", None)
    return rows


class ProcessRepositoryMixin:
    @staticmethod
    def _paginate_list(items: list[dict], page: int | None, page_size: int | None) -> dict | list[dict]:
        if page is None and page_size is None:
            return items

        safe_page = max(1, int(page or 1))
        safe_page_size = self._clamp_limit(page_size, default=20, maximum=100)
        total = len(items)
        total_pages = max(1, math.ceil(total / safe_page_size))
        safe_page = min(safe_page, total_pages)
        start = (safe_page - 1) * safe_page_size
        page_items = items[start : start + safe_page_size]
        return {
            "items": page_items,
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
            "total_pages": total_pages,
            "has_next": safe_page < total_pages,
            "has_previous": safe_page > 1,
        }

    @staticmethod
    def _candidate_matches_process_reference(candidate: dict, process: dict) -> bool:
        candidate_reference = normalize_text(candidate.get("id_processo_ref"))
        process_reference = normalize_text(process.get("id_processo_ref"))
        return not candidate_reference or candidate_reference == process_reference

    @staticmethod
    def _preserve_existing_process_status(current_status: str, requested_status: str) -> str:
        current = canonicalize_candidate_status(current_status)
        requested = canonicalize_candidate_status(requested_status)

        if requested in {
            CANDIDATE_STATUS_APPROVED,
            CANDIDATE_STATUS_ELIMINATED,
            CANDIDATE_STATUS_TALENT_BANK,
            CANDIDATE_STATUS_WITHDREW,
        }:
            return requested

        if current in {
            *INTERVIEW_OPERATIONAL_STATUSES,
            CANDIDATE_STATUS_APPROVED,
            CANDIDATE_STATUS_ELIMINATED,
            CANDIDATE_STATUS_TALENT_BANK,
            CANDIDATE_STATUS_WITHDREW,
        } and requested in {
            CANDIDATE_STATUS_ANALYSIS,
            CANDIDATE_STATUS_QUALIFIED,
        }:
            return current

        return requested

    def list_processes(self, page: int | None = None, page_size: int | None = None) -> list[dict] | dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_columns(cursor)
            ensure_process_reference_columns(cursor)
            rows = get_process_rows(cursor)
            if not rows:
                return rows

            cursor.execute(
                """
                SELECT
                    id_processo,
                    id_processo_ref,
                    status_candidato,
                    etapa_pipeline
                FROM candidatos_processos
                """
            )
            candidatos = rows_to_dicts(cursor, cursor.fetchall())
            terminal_statuses = {
                CANDIDATE_STATUS_APPROVED,
                CANDIDATE_STATUS_ELIMINATED,
                CANDIDATE_STATUS_NOT_QUALIFIED,
                CANDIDATE_STATUS_TALENT_BANK,
                CANDIDATE_STATUS_WITHDREW,
            }
            contagem_por_ref = {}
            for candidato in candidatos:
                status_visivel = canonicalize_candidate_status(candidato.get("status_candidato"))
                if status_visivel in terminal_statuses:
                    continue
                ref = normalize_text(candidato.get("id_processo_ref")) or normalize_text(candidato.get("id_processo"))
                if not ref:
                    continue
                contagem_por_ref[ref] = contagem_por_ref.get(ref, 0) + 1

            for row in rows:
                ref = normalize_text(row.get("id_processo_ref")) or normalize_text(row.get("id_processo"))
                row["candidatos_concorrendo"] = int(contagem_por_ref.get(ref, 0))
                row["quantidade_candidatos"] = row["candidatos_concorrendo"]
            return self._paginate_list(rows, page, page_size)
        finally:
            conn.close()

    def monitor_process_inactivity(self, *, dias: int = 30, dias_realerta: int = 7) -> dict:
        """Detecta processos sem movimentação relevante há `dias` dias e
        registra um alerta interno (tabela `processos_alertas_inatividade`).

        `dias_realerta`: não cria um novo alerta para o mesmo processo se já
        existe um alerta do mesmo tipo criado há menos de `dias_realerta`
        dias — evita spammar o RH a cada execução do job agendado enquanto o
        processo continuar parado (roadmap: lembretes e alertas automáticos).
        """
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_columns(cursor)
            ensure_process_reference_columns(cursor)
            ensure_process_inactivity_alerts_table(cursor)
            cursor.execute(
                """
                SELECT
                    id_processo,
                    id_processo_ref,
                    vaga,
                    data_criacao,
                    status,
                    ultima_movimentacao_relevante_em,
                    ultimo_alerta_inatividade_em
                FROM processos_seletivos
                """
            )
            processos = rows_to_dicts(cursor, cursor.fetchall())
            alertas = []
            for processo in processos:
                status_atual = normalize_process_status(processo.get("status"))
                if status_atual in {"Encerrado", "Cancelado", "Pausado"}:
                    continue
                abertura = processo.get("data_criacao")
                ultima = processo.get("ultima_movimentacao_relevante_em") or abertura
                if not ultima:
                    continue
                cursor.execute("SELECT DATEDIFF(day, ?, GETDATE())", (ultima,))
                dias_sem_movimentacao = int((cursor.fetchone() or [0])[0] or 0)
                if dias_sem_movimentacao < int(dias or 30):
                    continue
                cursor.execute(
                    """
                    SELECT TOP 1 id_alerta
                    FROM processos_alertas_inatividade
                    WHERE id_processo = ?
                      AND ISNULL(id_processo_ref, '') = ISNULL(?, '')
                      AND tipo = 'processo_sem_movimentacao'
                      AND (
                        ISNULL(data_ultima_movimentacao, CONVERT(DATETIME, '19000101', 112))
                            = ISNULL(?, CONVERT(DATETIME, '19000101', 112))
                        OR criado_em >= DATEADD(day, -?, GETDATE())
                      )
                    ORDER BY criado_em DESC
                    """,
                    (
                        normalize_text(processo.get("id_processo")),
                        normalize_text(processo.get("id_processo_ref")),
                        ultima,
                        int(dias_realerta or 7),
                    ),
                )
                if cursor.fetchone():
                    continue

                nome = normalize_text(processo.get("id_processo_ref")) or normalize_text(processo.get("id_processo"))
                mensagem = (
                    f"O processo seletivo '{nome}' permanece há {dias_sem_movimentacao} dias sem movimentações. "
                    "Verifique se é necessário atualizar, pausar ou cancelar o processo."
                )
                cursor.execute(
                    """
                    INSERT INTO processos_alertas_inatividade
                    (
                        id_processo,
                        id_processo_ref,
                        tipo,
                        titulo,
                        mensagem,
                        destinatarios,
                        status_envio,
                        dias_sem_movimentacao,
                        data_abertura,
                        data_ultima_movimentacao,
                        criado_em
                    )
                    OUTPUT INSERTED.id_alerta
                    VALUES (?, ?, 'processo_sem_movimentacao', ?, ?, ?, ?, ?, ?, ?, GETDATE())
                    """,
                    (
                        normalize_text(processo.get("id_processo")),
                        normalize_text(processo.get("id_processo_ref")),
                        "Processo sem movimentação",
                        mensagem,
                        "responsavel_do_processo;usuarios_autorizados",
                        "notificacao_interna_registrada_email_pendente_configuracao",
                        dias_sem_movimentacao,
                        abertura,
                        ultima,
                    ),
                )
                id_alerta = int((cursor.fetchone() or [0])[0] or 0)
                cursor.execute(
                    """
                    UPDATE processos_seletivos
                    SET ultimo_alerta_inatividade_em = GETDATE()
                    WHERE id_processo = ?
                      AND ISNULL(id_processo_ref, '') = ISNULL(?, '')
                    """,
                    (
                        normalize_text(processo.get("id_processo")),
                        normalize_text(processo.get("id_processo_ref")),
                    ),
                )
                alertas.append(
                    {
                        "id_alerta": id_alerta,
                        "id_processo": processo.get("id_processo"),
                        "id_processo_ref": processo.get("id_processo_ref"),
                        "dias_sem_movimentacao": dias_sem_movimentacao,
                        "status_envio": "notificacao_interna_registrada_email_pendente_configuracao",
                    }
                )
            conn.commit()
            return {"success": True, "alertas_criados": alertas, "total": len(alertas)}
        finally:
            conn.close()

    def _mark_inactivity_alert_email_status(self, id_alerta, status_envio: str) -> None:
        if not id_alerta:
            return
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE processos_alertas_inatividade SET status_envio = ? WHERE id_alerta = ?",
                (status_envio, int(id_alerta)),
            )
            conn.commit()
        except Exception:
            self.logger.warning(
                "Falha ao atualizar status de envio do alerta de inatividade %s.",
                id_alerta,
                exc_info=True,
            )
        finally:
            conn.close()

    def run_scheduled_inactivity_reminders(
        self,
        *,
        dias: int | None = None,
        dias_realerta: int | None = None,
    ) -> dict:
        """Ponto único de disparo automático (job agendado) dos lembretes de
        processo sem movimentação (roadmap: "Lembretes e alertas
        automáticos"). Reaproveita `monitor_process_inactivity` para
        detectar/registrar os alertas e, quando a automação de lembretes
        estiver ativa (`lembretes_automaticos_ativos`), envia e-mail de fato
        para o(s) destinatário(s) configurados via
        `send_internal_alert_email`.

        Sempre respeita o interruptor: se desligado, não roda nada (nem
        grava alerta) — mesma postura de `disparar_notificacao_por_etapa`
        para e-mails automáticos por etapa. Default desligado.

        Nunca deve propagar exceção: é chamado a partir de um job agendado
        em background (APScheduler) e uma falha aqui não pode derrubar o
        processo do backend nem impedir a próxima execução do job.
        """
        try:
            automacao = self.get_notification_automation_settings()
        except Exception:
            self.logger.warning(
                "Não foi possível checar a configuração de automação de lembretes; "
                "job de inatividade não executado.",
                exc_info=True,
            )
            return {"success": False, "skipped": "falha_ao_checar_configuracao"}

        if not automacao.get("lembretes_automaticos_ativos"):
            return {
                "success": True,
                "skipped": "automacao_desativada",
                "alertas_criados": [],
                "total": 0,
            }

        dias_efetivo = int(
            dias
            if dias is not None
            else getattr(self.settings, "scheduler_inactivity_dias_sem_movimentacao", 30)
        )
        dias_realerta_efetivo = int(
            dias_realerta
            if dias_realerta is not None
            else getattr(self.settings, "scheduler_inactivity_dias_realerta", 7)
        )

        try:
            resultado = self.monitor_process_inactivity(
                dias=dias_efetivo,
                dias_realerta=dias_realerta_efetivo,
            )
        except Exception:
            self.logger.exception("Falha ao monitorar inatividade de processos no job agendado.")
            return {"success": False, "skipped": "falha_ao_monitorar"}

        destinatarios = [
            item for item in getattr(self.settings, "email_inactivity_alert_recipients", ()) if item
        ]
        if not destinatarios:
            fallback = normalize_text(getattr(self.settings, "email_smtp_from", ""))
            if fallback:
                destinatarios = [fallback]

        alertas_enviados = []
        for alerta in resultado.get("alertas_criados", []):
            if not destinatarios:
                self.logger.warning(
                    "Alerta de inatividade %s registrado, mas nenhum destinatário de e-mail "
                    "configurado (RH_EMAIL_INACTIVITY_ALERT_RECIPIENTS).",
                    alerta.get("id_alerta"),
                )
                continue

            nome_processo = normalize_text(alerta.get("id_processo_ref")) or normalize_text(
                alerta.get("id_processo")
            )
            assunto = f"[Conecta] Processo sem movimentação - {nome_processo}".strip()
            mensagem = (
                f"O processo seletivo '{nome_processo}' permanece há "
                f"{alerta.get('dias_sem_movimentacao')} dias sem movimentações. Verifique se é "
                "necessário atualizar, pausar ou cancelar o processo.\n\n"
                "Este é um lembrete automático do Conecta."
            )
            try:
                self.send_internal_alert_email(
                    destinatarios=destinatarios,
                    assunto=assunto,
                    mensagem=mensagem,
                )
                self._mark_inactivity_alert_email_status(alerta.get("id_alerta"), "email_enviado")
                self.logger.info(
                    "E-mail automático de lembrete de inatividade enviado (id_alerta=%s, id_processo=%s).",
                    alerta.get("id_alerta"),
                    alerta.get("id_processo"),
                )
                try:
                    self.record_audit_log(
                        user={"nome": "Automação Conecta", "email": "", "perfil_nome": "Automação"},
                        modulo="Notificações",
                        acao="enviar_lembrete_inatividade_automatico",
                        entidade="processo",
                        entidade_id=str(alerta.get("id_processo") or ""),
                        valor_novo={
                            "id_alerta": alerta.get("id_alerta"),
                            "dias_sem_movimentacao": alerta.get("dias_sem_movimentacao"),
                            "destinatarios": destinatarios,
                            "automatico": True,
                        },
                    )
                except Exception:
                    self.logger.warning(
                        "Falha ao registrar auditoria do lembrete automático de inatividade.",
                        exc_info=True,
                    )
                alertas_enviados.append(alerta.get("id_alerta"))
            except Exception:
                self.logger.warning(
                    "Falha ao enviar e-mail automático de lembrete de inatividade (id_alerta=%s).",
                    alerta.get("id_alerta"),
                    exc_info=True,
                )
                self._mark_inactivity_alert_email_status(alerta.get("id_alerta"), "falha_envio_email")

        resultado["emails_enviados"] = alertas_enviados
        resultado["automatico"] = True
        return resultado

    @staticmethod
    def _count_open_and_urgent_processes(cursor, *, exclude_process_id: str | None = None) -> tuple[int, int]:
        """Conta vagas ABERTAS e, dentre elas, quantas estao marcadas urgentes.

        Escopo: toda a base (ver nota de produto acima sobre a ausencia de
        coluna de RH/empresa responsavel pela vaga).
        """
        cursor.execute("SELECT id_processo, status, urgente FROM processos_seletivos")
        rows = rows_to_dicts(cursor, cursor.fetchall())
        safe_exclude = normalize_text(exclude_process_id)
        total_abertas = 0
        total_urgentes = 0
        for row in rows:
            if safe_exclude and normalize_text(row.get("id_processo")) == safe_exclude:
                continue
            if normalize_process_status(row.get("status")) != "Aberto":
                continue
            total_abertas += 1
            if bool(row.get("urgente")):
                total_urgentes += 1
        return total_abertas, total_urgentes

    @staticmethod
    def _assert_urgent_quota_available(cursor, *, exclude_process_id: str | None = None) -> None:
        """Bloqueia marcar mais uma vaga como urgente se isso ultrapassar o
        percentual maximo permitido de vagas abertas simultaneamente urgentes.
        """
        total_abertas, total_urgentes = ProcessRepositoryMixin._count_open_and_urgent_processes(
            cursor, exclude_process_id=exclude_process_id
        )
        projecao_abertas = total_abertas + 1
        projecao_urgentes = total_urgentes + 1
        if (projecao_urgentes / projecao_abertas) > LIMITE_PERCENTUAL_VAGAS_URGENTES:
            limite_percentual = int(round(LIMITE_PERCENTUAL_VAGAS_URGENTES * 100))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Limite de vagas urgentes atingido: no máximo "
                    f"{limite_percentual}% das vagas abertas simultaneamente podem usar o "
                    "Botão Expresso. Esse recurso é reservado para emergências reais — "
                    "encerre ou desmarque outra vaga urgente antes de marcar esta, ou "
                    "utilize o fluxo tradicional de contratação."
                ),
            )

    def create_process(self, data: dict, *, marcado_por: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_columns(cursor)
            ensure_process_reference_columns(cursor)
            resolved_process_id = generate_unique_process_id(
                cursor,
                data.get("id_processo", ""),
            )
            created_at = normalize_text(data.get("data_criacao")) or datetime.now().isoformat()
            status_novo = normalize_process_status(data.get("status", "Aberto"))
            urgente_novo = bool(data.get("urgente"))
            if urgente_novo and status_novo == "Aberto":
                self._assert_urgent_quota_available(cursor)
            cursor.execute(
                """
                INSERT INTO processos_seletivos
                (
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
                    link_agendamento,
                    configuracao_prova_json,
                    prova_configurada_em,
                    urgente,
                    urgente_marcado_em,
                    urgente_marcado_por,
                    ia_analise_desabilitada,
                    detalhes_vaga_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    resolved_process_id,
                    data.get("vaga", ""),
                    int(data.get("quantidade_vagas", 0) or 0),
                    int(data.get("vagas_preenchidas", 0) or 0),
                    data.get("data_encerramento", ""),
                    data.get("operacao", ""),
                    data.get("trilha", ""),
                    int(data.get("usa_nota_corte", 0) or 0),
                    data.get("nota_corte", None),
                    status_novo,
                    created_at,
                    data.get("link_agendamento", ""),
                    data.get("configuracao_prova_json"),
                    data.get("prova_configurada_em") or None,
                    1 if urgente_novo else 0,
                    datetime.now() if urgente_novo else None,
                    normalize_text(marcado_por) if urgente_novo else None,
                    1 if data.get("ia_analise_desabilitada") else 0,
                    data.get("detalhes_vaga_json"),
                ),
            )
            conn.commit()
            logger.info("Processo '%s' criado.", resolved_process_id)
        finally:
            conn.close()

        detalhes_vaga = safe_json_loads(data.get("detalhes_vaga_json"), {})
        trilha_ids = detalhes_vaga.get("treinamentos_selecionados") if isinstance(detalhes_vaga, dict) else None
        if trilha_ids:
            try:
                self.sync_process_trainings(
                    resolved_process_id,
                    vagas_totais=int(data.get("quantidade_vagas", 0) or 0),
                    trilha_ids=trilha_ids,
                )
            except Exception:
                # O processo já foi criado com sucesso — a vinculação com a
                # Central de Treinamentos pode ser refeita depois; não bloqueia
                # a publicação da vaga por isso.
                logger.exception("Falha ao vincular treinamentos ao processo '%s'.", resolved_process_id)

        return {
            "success": True,
            "id_processo": resolved_process_id,
            "urgente": urgente_novo,
        }

    def update_process(
        self,
        id_processo: str,
        data: dict,
        *,
        marcado_por: str = "",
        user: AuthenticatedUser | None = None,
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_columns(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            # Achado SEC-002: escopo de operação — usuários sem operação
            # atribuída (o caso de hoje) não são afetados por esta checagem.
            if user is not None and not user.allows_operacao(processo.get("operacao")):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Este processo pertence a uma operação fora do seu escopo de acesso.",
                )
            where_clause, params = build_process_where_clause(processo)

            status_novo = normalize_process_status(data.get("status", "Aberto"))
            urgente_atual = bool(processo.get("urgente"))
            urgente_novo = data.get("urgente") if data.get("urgente") is not None else urgente_atual
            urgente_novo = bool(urgente_novo)
            marcando_urgente_agora = urgente_novo and not urgente_atual
            if marcando_urgente_agora and status_novo == "Aberto":
                self._assert_urgent_quota_available(cursor, exclude_process_id=processo.get("id_processo"))

            cursor.execute(
                f"""
                UPDATE processos_seletivos
                SET
                    vaga = ?,
                    quantidade_vagas = ?,
                    data_encerramento = ?,
                    operacao = ?,
                    trilha = ?,
                    usa_nota_corte = ?,
                    nota_corte = ?,
                    status = ?,
                    link_agendamento = ?,
                    observacoes_publicas_vaga = ?,
                    requisitos_publicos = ?,
                    responsabilidades_publicas = ?,
                    configuracao_prova_json = ?,
                    prova_configurada_em = ?,
                    urgente = ?,
                    urgente_marcado_em = ?,
                    urgente_marcado_por = ?,
                    ia_analise_desabilitada = ?,
                    detalhes_vaga_json = ?
                WHERE {where_clause}
                """,
                (
                    normalize_text(data.get("vaga"))
                    if data.get("vaga") is not None
                    else processo.get("vaga", ""),
                    int(data.get("quantidade_vagas", 0) or 0),
                    data.get("data_encerramento", ""),
                    data.get("operacao", ""),
                    data.get("trilha", ""),
                    int(data.get("usa_nota_corte", 0) or 0),
                    data.get("nota_corte", None),
                    status_novo,
                    data.get("link_agendamento", ""),
                    data.get("observacoes_publicas_vaga")
                    if data.get("observacoes_publicas_vaga") is not None
                    else processo.get("observacoes_publicas_vaga", ""),
                    data.get("requisitos_publicos")
                    if data.get("requisitos_publicos") is not None
                    else processo.get("requisitos_publicos", ""),
                    data.get("responsabilidades_publicas")
                    if data.get("responsabilidades_publicas") is not None
                    else processo.get("responsabilidades_publicas", ""),
                    data.get("configuracao_prova_json")
                    if data.get("configuracao_prova_json") is not None
                    else processo.get("configuracao_prova_json"),
                    data.get("prova_configurada_em")
                    if data.get("prova_configurada_em") is not None
                    else processo.get("prova_configurada_em"),
                    1 if urgente_novo else 0,
                    datetime.now() if marcando_urgente_agora else (processo.get("urgente_marcado_em") if urgente_novo else None),
                    normalize_text(marcado_por) if marcando_urgente_agora else (processo.get("urgente_marcado_por") if urgente_novo else None),
                    (
                        1
                        if (
                            data.get("ia_analise_desabilitada")
                            if data.get("ia_analise_desabilitada") is not None
                            else processo.get("ia_analise_desabilitada")
                        )
                        else 0
                    ),
                    data.get("detalhes_vaga_json")
                    if data.get("detalhes_vaga_json") is not None
                    else processo.get("detalhes_vaga_json"),
                    *params,
                ),
            )
            if normalize_process_status(data.get("status", "Aberto")) == "Encerrado":
                cursor.execute(
                    f"""
                    UPDATE processos_seletivos
                    SET
                        link_publico_ativo = 0,
                        link_publico_desativado_em = GETDATE()
                    WHERE {where_clause}
                    """,
                    *params,
                )
            process_auto_close_if_full(cursor, processo)
            conn.commit()
            logger.info("Processo '%s' atualizado.", processo.get("id_processo_ref") or processo.get("id_processo"))
            return {
                "success": True,
                "urgente": urgente_novo,
                "urgente_alterado": urgente_novo != urgente_atual,
            }
        finally:
            conn.close()

    def close_process(
        self,
        id_processo: str,
        *,
        justificativa: str = "",
        usuario_responsavel: str = "",
    ) -> dict:
        if normalize_text(justificativa):
            return self.change_process_status(
                id_processo,
                novo_status="Encerrado",
                justificativa=justificativa,
                usuario_responsavel=usuario_responsavel,
            )
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            where_clause, params = build_process_where_clause(processo)
            cursor.execute(
                f"""
                UPDATE processos_seletivos
                SET
                    status = ?,
                    link_publico_ativo = 0,
                    link_publico_desativado_em = GETDATE()
                WHERE {where_clause}
                """,
                ("Encerrado", *params),
            )
            conn.commit()
            logger.info(
                "Processo '%s' encerrado manualmente.",
                processo.get("id_processo_ref") or processo.get("id_processo"),
            )
            return {"success": True}
        finally:
            conn.close()

    def change_process_status(
        self,
        id_processo: str,
        *,
        novo_status: str,
        justificativa: str,
        usuario_responsavel: str = "",
        tempo_pausa: str = "",
        pausa_previsao_termino: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_columns(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")

            status_anterior = normalize_process_status(processo.get("status"))
            status_novo = normalize_process_status(novo_status)
            if status_anterior == status_novo:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"O processo já está com status {status_novo}.",
                )

            status_operacional_anterior = normalize_text(
                processo.get("status_operacional_anterior")
            )
            status_retomada = (
                status_operacional_anterior
                if status_anterior == "Pausado" and status_operacional_anterior
                else "Aberto"
            )
            status_final = status_retomada if status_novo == "Aberto" else status_novo
            where_clause, params = build_process_where_clause(processo)
            desativar_link = status_final in {"Encerrado", PROCESS_STATUS_CANCELED}
            pausa_ativa = status_final == "Pausado"
            retomando_pausa = status_anterior == "Pausado" and status_final != "Pausado"
            cursor.execute(
                f"""
                UPDATE processos_seletivos
                SET
                    status = ?,
                    status_anterior = ?,
                    status_operacional_anterior = ?,
                    justificativa_status = ?,
                    status_alterado_por = ?,
                    status_alterado_em = GETDATE(),
                    ultima_movimentacao_relevante_em = GETDATE(),
                    tempo_pausa = CASE WHEN ? = 1 THEN ? WHEN ? = 1 THEN NULL ELSE tempo_pausa END,
                    pausa_inicio_em = CASE WHEN ? = 1 THEN GETDATE() ELSE pausa_inicio_em END,
                    pausa_previsao_termino = CASE WHEN ? = 1 THEN ? WHEN ? = 1 THEN NULL ELSE pausa_previsao_termino END,
                    pausa_retomada_em = CASE WHEN ? = 1 THEN GETDATE() ELSE pausa_retomada_em END,
                    link_publico_ativo = CASE WHEN ? = 1 THEN 0 ELSE link_publico_ativo END,
                    link_publico_desativado_em = CASE WHEN ? = 1 THEN GETDATE() ELSE link_publico_desativado_em END
                WHERE {where_clause}
                """,
                (
                    status_final,
                    status_anterior,
                    status_anterior if status_final == "Pausado" else status_operacional_anterior,
                    normalize_text(justificativa),
                    normalize_text(usuario_responsavel),
                    1 if pausa_ativa else 0,
                    normalize_text(tempo_pausa),
                    1 if retomando_pausa else 0,
                    1 if pausa_ativa else 0,
                    1 if pausa_ativa else 0,
                    normalize_text(pausa_previsao_termino) or None,
                    1 if retomando_pausa else 0,
                    1 if retomando_pausa else 0,
                    1 if desativar_link else 0,
                    1 if desativar_link else 0,
                    *params,
                ),
            )
            conn.commit()
            return {
                "success": True,
                "id_processo": processo.get("id_processo_ref") or processo.get("id_processo"),
                "status_anterior": status_anterior,
                "status_novo": status_final,
            }
        finally:
            conn.close()

    def list_process_candidates(
        self,
        id_processo: str | None = None,
        page: int | None = None,
        page_size: int | None = None,
    ) -> list[dict] | dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            query = """
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
                    sub_causa_eliminacao,
                    etapa_eliminacao,
                    eh_indicacao,
                    tipo_indicacao,
                    indicado_por
                FROM candidatos_processos
            """
            params = []
            if normalize_text(id_processo):
                query += " WHERE id_processo = ?"
                params.append(normalize_text(id_processo).split("@@", 1)[0])
            query += " ORDER BY id_registro DESC"

            cursor.execute(query, tuple(params))
            rows = rows_to_dicts(cursor, cursor.fetchall())
            rows = self._hydrate_pipeline_fields(cursor, rows)
            if not normalize_text(id_processo):
                existing_candidate_ids = {
                    normalize_text(item.get("id_teste"))
                    for item in rows
                    if normalize_text(item.get("id_teste"))
                }
                standalone_exam_rows = self._get_standalone_generated_exam_candidates(
                    cursor,
                    existing_candidate_ids,
                )
                rows.extend(standalone_exam_rows)
                existing_candidate_ids |= {
                    normalize_text(item.get("id_teste"))
                    for item in standalone_exam_rows
                    if normalize_text(item.get("id_teste"))
                }
                # Todo candidato entra no Conecta e precisa aparecer aqui, com ou
                # sem prova/processo (CV adicionado manualmente na Caixa de CV).
                rows.extend(
                    self._get_standalone_manual_cv_candidates(
                        cursor,
                        existing_candidate_ids,
                    )
                )
            rows = self._enrich_candidate_records(cursor, rows)
            rows = self._attach_process_context(
                cursor,
                rows,
                timestamp_fields=["data_prova", "data_atualizacao_pipeline", "aprovado_em", "eliminado_em"],
            )
            for item in rows:
                item["data_eliminacao"] = item.get("eliminado_em")
            rows = [
                item
                for item in rows
                if canonicalize_candidate_status(item.get("status_candidato"))
                != CANDIDATE_STATUS_TALENT_BANK
            ]

            if normalize_text(id_processo):
                filtro_ref = normalize_text(id_processo)
                rows = [
                    item
                    for item in rows
                    if normalize_text(item.get("id_processo_ref")) == filtro_ref
                ]

            return self._paginate_list(rows, page, page_size)
        finally:
            conn.close()

    def create_process_candidate(self, data: dict) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)

            processo = get_process_row(
                cursor,
                data.get("id_processo_ref") or data.get("id_processo", ""),
            )
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("adicionar candidato ao processo", processo.get("id_processo")),
                )

            requested_stage = data.get("etapa_pipeline")
            stage = (
                normalize_pipeline_stage(requested_stage)
                if requested_stage
                else infer_pipeline_stage(data.get("status_candidato"), data.get("origem"))
            )
            requested_status = (
                canonicalize_candidate_status(data.get("status_candidato"))
                if normalize_text(data.get("status_candidato"))
                else map_pipeline_stage_to_status(stage)
            )
            id_teste = normalize_text(data.get("id_teste"))
            if not id_teste:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Dados insuficientes para adicionar o candidato ao processo.",
                )
            effective_data_prova = normalize_text(data.get("data_prova")) or datetime.now().isoformat()
            effective_origin = normalize_text(data.get("origem")) or "Prova"
            effective_vaga = normalize_text(data.get("vaga")) or normalize_text(processo.get("vaga"))
            indication_type = normalize_indication_type(data.get("tipo_indicacao"))
            is_indication = bool(data.get("eh_indicacao")) or bool(indication_type)
            if bool(data.get("eh_indicacao")) and not indication_type:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione o tipo de indicação.")

            current = None
            provided_id_registro = int(data.get("id_registro") or 0)
            if provided_id_registro > 0:
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
                        sub_causa_eliminacao,
                        etapa_eliminacao,
                        eh_indicacao,
                        tipo_indicacao,
                        indicado_por
                    FROM candidatos_processos
                    WHERE id_registro = ?
                    """,
                    (provided_id_registro,),
                )
                current_rows = rows_to_dicts(cursor, cursor.fetchall())
                current = current_rows[0] if current_rows else None

            if not current and id_teste:
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
                        sub_causa_eliminacao,
                        etapa_eliminacao,
                        eh_indicacao,
                        tipo_indicacao,
                        indicado_por
                    FROM candidatos_processos
                    WHERE id_teste = ?
                    ORDER BY id_registro DESC
                    """,
                    (id_teste,),
                )
                existing_links = rows_to_dicts(cursor, cursor.fetchall())
                if existing_links:
                    same_target_process = any(
                        normalize_text(item.get("id_processo_ref")) == normalize_text(processo.get("id_processo_ref"))
                        or (
                            normalize_text(item.get("id_processo")) == normalize_text(processo.get("id_processo"))
                            and not normalize_text(item.get("id_processo_ref"))
                        )
                        for item in existing_links
                    )
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "Este candidato já está vinculado a este processo seletivo."
                            if same_target_process
                            else "Este candidato já está vinculado a um processo seletivo."
                        ),
                    )
            elif current and id_teste:
                cursor.execute(
                    """
                    SELECT id_registro
                    FROM candidatos_processos
                    WHERE id_teste = ? AND id_registro <> ?
                    """,
                    (id_teste, int(current.get("id_registro") or 0)),
                )
                if cursor.fetchone():
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Este candidato já está vinculado a um processo seletivo.",
                    )

            if current:
                current_status = canonicalize_candidate_status(current.get("status_candidato"))
                if is_terminal_candidate_status(current_status):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=build_terminal_candidate_locked_message(current_status),
                    )
                effective_status = self._preserve_existing_process_status(
                    current.get("status_candidato"),
                    requested_status,
                )
                effective_stage = (
                    normalize_pipeline_stage(requested_stage)
                    if requested_stage and effective_status == requested_status
                    else infer_pipeline_stage(
                        effective_status,
                        effective_origin or current.get("origem"),
                        current_stage=current.get("etapa_pipeline"),
                    )
                )

                cursor.execute(
                    """
                    UPDATE candidatos_processos
                    SET
                        id_processo = ?,
                        id_processo_ref = ?,
                        id_teste = ?,
                        nome_candidato = ?,
                        vaga = ?,
                        pontuacao_final = ?,
                        data_prova = ?,
                        origem = ?,
                        indicado_por = ?
                    WHERE id_registro = ?
                    """,
                    (
                        processo.get("id_processo", ""),
                        processo.get("id_processo_ref", ""),
                        id_teste or normalize_text(current.get("id_teste")),
                        data.get("nome_candidato", "") or normalize_text(current.get("nome_candidato")),
                        effective_vaga or normalize_text(current.get("vaga")),
                        data.get("pontuacao_final", current.get("pontuacao_final")),
                        effective_data_prova,
                        effective_origin or normalize_text(current.get("origem")),
                        normalize_text(data.get("indicado_por")) or normalize_text(current.get("indicado_por")),
                        int(current.get("id_registro")),
                    ),
                )

                if (
                    canonicalize_candidate_status(current.get("status_candidato")) != effective_status
                    or normalize_text(current.get("etapa_pipeline")) != effective_stage
                    or normalize_text(current.get("id_processo_ref")) != normalize_text(processo.get("id_processo_ref"))
                ):
                    self._apply_candidate_status_update(
                        cursor,
                        current_row={
                            **current,
                            "id_processo": processo.get("id_processo", ""),
                            "id_processo_ref": processo.get("id_processo_ref", ""),
                            "id_teste": id_teste or normalize_text(current.get("id_teste")),
                            "nome_candidato": data.get("nome_candidato", "") or normalize_text(current.get("nome_candidato")),
                            "vaga": effective_vaga or normalize_text(current.get("vaga")),
                            "pontuacao_final": data.get("pontuacao_final", current.get("pontuacao_final")),
                            "data_prova": effective_data_prova,
                            "origem": effective_origin or normalize_text(current.get("origem")),
                        },
                        new_status=effective_status,
                        new_stage=effective_stage,
                        data_movimentacao=effective_data_prova,
                    )

                self._upsert_candidate_profile(
                    cursor,
                    id_teste=id_teste or current.get("id_teste", ""),
                    nome_candidato=data.get("nome_candidato", ""),
                )
                conn.commit()
                logger.info(
                    "Candidato '%s' atualizado no processo '%s'.",
                    data.get("nome_candidato", ""),
                    processo.get("id_processo_ref") or processo.get("id_processo", ""),
                )
                return {"success": True, "id_registro": int(current.get("id_registro") or 0)}

            id_registro = insert_candidate_process_record(
                cursor,
                processo,
                {
                    "id_teste": id_teste,
                    "nome_candidato": data.get("nome_candidato", ""),
                    "vaga": effective_vaga,
                    "status_candidato": requested_status,
                    "pontuacao_final": data.get("pontuacao_final", ""),
                    "data_prova": effective_data_prova,
                    "origem": effective_origin,
                    "etapa_pipeline": stage,
                    "data_atualizacao_pipeline": datetime.now(),
                    "eh_indicacao": is_indication,
                    "tipo_indicacao": indication_type,
                    "indicado_por": normalize_text(data.get("indicado_por")),
                },
            )
            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=data.get("nome_candidato", ""),
            )
            self._record_candidate_movement(
                cursor,
                id_teste=id_teste,
                id_registro=id_registro,
                id_processo=processo.get("id_processo", ""),
                id_processo_ref=processo.get("id_processo_ref", ""),
                nome_candidato=data.get("nome_candidato", ""),
                vaga=effective_vaga,
                origem_inicial=effective_origin,
                tipo_movimentacao="Candidato vinculado a processo seletivo",
                status_anterior="Sem processo vinculado",
                status_novo=requested_status,
                observacao=(
                    f"Origem: {effective_origin}"
                    + (f" | Indicação: {indication_type}" if is_indication else "")
                ),
            )

            if requested_status != CANDIDATE_STATUS_ANALYSIS or stage != "Triagem":
                self._apply_candidate_status_update(
                    cursor,
                    current_row={
                        "id_registro": id_registro,
                        "id_processo": processo.get("id_processo", ""),
                        "id_processo_ref": processo.get("id_processo_ref", ""),
                        "id_teste": id_teste,
                        "nome_candidato": data.get("nome_candidato", ""),
                        "vaga": effective_vaga,
                        "status_candidato": CANDIDATE_STATUS_ANALYSIS,
                        "pontuacao_final": data.get("pontuacao_final", ""),
                        "data_prova": effective_data_prova,
                        "origem": effective_origin,
                        "etapa_pipeline": "Triagem",
                        "data_atualizacao_pipeline": effective_data_prova,
                    },
                    new_status=requested_status,
                    new_stage=stage,
                    data_movimentacao=effective_data_prova,
                )

            conn.commit()
            logger.info(
                "Candidato '%s' vinculado ao processo '%s'.",
                data.get("nome_candidato", ""),
                processo.get("id_processo_ref") or processo.get("id_processo", ""),
            )
            return {"success": True, "id_registro": id_registro}
        finally:
            conn.close()

    def update_process_candidate_status(self, id_registro: int, data: dict) -> dict:
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
                    tipo_indicacao,
                    indicado_por
                FROM candidatos_processos
                WHERE id_registro = ?
                """,
                (id_registro,),
            )
            current_rows = rows_to_dicts(cursor, cursor.fetchall())
            if not current_rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato do processo não encontrado.")
            current = current_rows[0]
            current_status = canonicalize_candidate_status(current.get("status_candidato"))
            if is_terminal_candidate_status(current_status):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_terminal_candidate_locked_message(current_status),
                )

            processo = get_process_row(
                cursor,
                current.get("id_processo_ref") or current.get("id_processo", ""),
            )
            if processo and is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("atualizar o status do candidato", processo.get("id_processo")),
                )

            requested_status = normalize_text(data.get("status_candidato"))
            current_stage = current.get("etapa_pipeline")
            new_stage = (
                normalize_pipeline_stage(data.get("etapa_pipeline"))
                if data.get("etapa_pipeline")
                else infer_pipeline_stage(requested_status, current.get("origem"), current_stage=current_stage)
            )
            new_status = (
                canonicalize_candidate_status(requested_status)
                if requested_status
                else map_pipeline_stage_to_status(new_stage, current.get("status_candidato"))
            )

            self._apply_candidate_status_update(
                cursor,
                current_row=current,
                new_status=new_status,
                new_stage=new_stage,
                data_movimentacao=data.get("data_movimentacao"),
                approval_payload=data,
            )

            conn.commit()
            logger.info("Status do candidato %s atualizado para '%s'.", id_registro, new_status)
            return {"success": True}
        finally:
            conn.close()

    def reconsider_candidate_elimination(
        self,
        id_registro: int,
        justificativa: str,
        *,
        actor: str = "",
    ) -> dict:
        """Reverte um candidato eliminado/nao qualificado/desistente de volta
        para Triagem. Rota deliberadamente separada de update_process_candidate_
        status: aquele metodo trava qualquer mudanca em status terminal (regra
        de integridade valida no dia a dia); reconsiderar uma eliminacao e uma
        excecao pontual, gated pela permissao candidatos.reverter_eliminacao,
        que precisa contornar essa trava com justificativa obrigatoria e
        registro proprio em candidatos_movimentacoes (respostas.txt: "permitir
        reverter uma eliminacao, mas registrando quem reverteu, quando e por
        que")."""
        justificativa_normalizada = normalize_text(justificativa)
        if len(justificativa_normalizada) < 10:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Informe uma justificativa com pelo menos 10 caracteres para reconsiderar a eliminação.",
            )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)

            cursor.execute(
                """
                SELECT
                    id_registro, id_processo, id_processo_ref, id_teste,
                    nome_candidato, vaga, status_candidato, origem
                FROM candidatos_processos
                WHERE id_registro = ?
                """,
                (id_registro,),
            )
            current_rows = rows_to_dicts(cursor, cursor.fetchall())
            if not current_rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato do processo não encontrado.")
            current = current_rows[0]

            status_atual = canonicalize_candidate_status(current.get("status_candidato"))
            reconsideravel = {CANDIDATE_STATUS_ELIMINATED, CANDIDATE_STATUS_NOT_QUALIFIED, CANDIDATE_STATUS_WITHDREW}
            if status_atual not in reconsideravel:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este candidato não está eliminado neste processo — não há o que reconsiderar.",
                )

            processo = get_process_row(
                cursor,
                current.get("id_processo_ref") or current.get("id_processo", ""),
            )
            if processo and is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("reconsiderar a eliminação do candidato", processo.get("id_processo")),
                )

            novo_status = CANDIDATE_STATUS_ANALYSIS
            cursor.execute(
                """
                UPDATE candidatos_processos
                SET status_candidato = ?, etapa_pipeline = ?, data_atualizacao_pipeline = GETDATE()
                WHERE id_registro = ?
                """,
                (novo_status, "Triagem", id_registro),
            )

            self._record_candidate_movement(
                cursor,
                id_teste=normalize_text(current.get("id_teste")),
                id_registro=id_registro,
                id_processo=normalize_text(current.get("id_processo")),
                id_processo_ref=normalize_text(current.get("id_processo_ref")),
                nome_candidato=normalize_text(current.get("nome_candidato")),
                vaga=normalize_text(current.get("vaga")),
                origem_inicial=normalize_text(current.get("origem")),
                tipo_movimentacao="Eliminação reconsiderada",
                status_anterior=status_atual,
                status_novo=novo_status,
                observacao=justificativa_normalizada,
                usuario_responsavel=normalize_text(actor),
            )

            conn.commit()
            logger.info(
                "Eliminação do candidato %s reconsiderada por '%s'.",
                id_registro,
                actor,
            )
            return {"success": True}
        finally:
            conn.close()

    def list_process_dossier_notes(self, id_processo: str) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_dossier_notes_table(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")

            process_ref = normalize_text(processo.get("id_processo_ref"))
            cursor.execute(
                """
                SELECT
                    id_anotacao,
                    id_processo,
                    id_processo_ref,
                    id_teste,
                    nome_candidato,
                    texto,
                    usuario_responsavel,
                    criado_em,
                    atualizado_em,
                    mencoes_json
                FROM processos_dossie_anotacoes
                WHERE id_processo = ?
                  AND ISNULL(id_processo_ref, '') = ?
                ORDER BY atualizado_em DESC, id_anotacao DESC
                """,
                (processo.get("id_processo"), process_ref),
            )
            return attach_note_mentions(rows_to_dicts(cursor, cursor.fetchall()))
        finally:
            conn.close()

    def create_process_dossier_note(
        self,
        id_processo: str,
        data: dict,
        *,
        usuario_responsavel: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_dossier_notes_table(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")

            id_teste = normalize_text(data.get("id_teste"))
            nome_candidato = normalize_text(data.get("nome_candidato"))
            if id_teste and not nome_candidato:
                cursor.execute(
                    """
                    SELECT TOP 1 nome_candidato
                    FROM candidatos_processos
                    WHERE id_teste = ?
                    ORDER BY id_registro DESC
                    """,
                    (id_teste,),
                )
                row = cursor.fetchone()
                nome_candidato = normalize_text(row[0] if row else "")

            texto_nota = normalize_text(data.get("texto"))
            cursor.execute(
                """
                INSERT INTO processos_dossie_anotacoes
                (
                    id_processo,
                    id_processo_ref,
                    id_teste,
                    nome_candidato,
                    texto,
                    usuario_responsavel,
                    criado_em,
                    atualizado_em,
                    mencoes_json
                )
                OUTPUT INSERTED.id_anotacao
                VALUES (?, ?, ?, ?, ?, ?, GETDATE(), GETDATE(), ?)
                """,
                (
                    processo.get("id_processo"),
                    normalize_text(processo.get("id_processo_ref")),
                    id_teste,
                    nome_candidato,
                    texto_nota,
                    normalize_text(usuario_responsavel),
                    json.dumps(extract_note_mentions(texto_nota)),
                ),
            )
            inserted = cursor.fetchone()
            note_id = int(inserted[0] or 0)
            conn.commit()
        finally:
            conn.close()

        return self.get_process_dossier_note(note_id)

    def get_process_dossier_note(self, id_anotacao: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_dossier_notes_table(cursor)
            cursor.execute(
                """
                SELECT
                    id_anotacao,
                    id_processo,
                    id_processo_ref,
                    id_teste,
                    nome_candidato,
                    texto,
                    usuario_responsavel,
                    criado_em,
                    atualizado_em,
                    mencoes_json
                FROM processos_dossie_anotacoes
                WHERE id_anotacao = ?
                """,
                (int(id_anotacao or 0),),
            )
            rows = attach_note_mentions(rows_to_dicts(cursor, cursor.fetchall()))
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anotação do dossiê não encontrada.")
            return rows[0]
        finally:
            conn.close()

    def update_process_dossier_note(
        self,
        id_anotacao: int,
        data: dict,
        *,
        usuario_responsavel: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_dossier_notes_table(cursor)
            cursor.execute(
                """
                SELECT id_anotacao
                FROM processos_dossie_anotacoes
                WHERE id_anotacao = ?
                """,
                (int(id_anotacao or 0),),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anotação do dossiê não encontrada.")

            texto_nota = normalize_text(data.get("texto"))
            cursor.execute(
                """
                UPDATE processos_dossie_anotacoes
                SET
                    texto = ?,
                    usuario_responsavel = COALESCE(NULLIF(?, ''), usuario_responsavel),
                    atualizado_em = GETDATE(),
                    mencoes_json = ?
                WHERE id_anotacao = ?
                """,
                (
                    texto_nota,
                    normalize_text(usuario_responsavel),
                    json.dumps(extract_note_mentions(texto_nota)),
                    int(id_anotacao or 0),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_process_dossier_note(id_anotacao)

    def get_process_details(self, id_processo: str) -> dict:
        def operation() -> dict:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_pipeline_columns(cursor)
                ensure_process_reference_columns(cursor)

                processo = get_process_row(cursor, id_processo)
                if not processo:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")

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
                        sub_causa_eliminacao,
                        etapa_eliminacao,
                        eh_indicacao,
                        tipo_indicacao,
                        indicado_por
                    FROM candidatos_processos
                    WHERE id_processo = ?
                    ORDER BY id_registro DESC
                    """,
                    (processo.get("id_processo"),),
                )
                candidatos = rows_to_dicts(cursor, cursor.fetchall())
                candidatos = self._hydrate_pipeline_fields(cursor, candidatos)
                candidatos = self._enrich_candidate_records(cursor, candidatos)
                candidatos = self._attach_process_context(
                    cursor,
                    candidatos,
                    timestamp_fields=["data_prova", "data_atualizacao_pipeline", "aprovado_em", "eliminado_em"],
                )
                for candidato in candidatos:
                    candidato["data_eliminacao"] = candidato.get("eliminado_em")
                candidatos = [
                    item
                    for item in candidatos
                    if self._candidate_matches_process_reference(item, processo)
                ]
                cursor.execute(
                    """
                    SELECT
                        id_pre_analise,
                        email,
                        score_final,
                        classificacao,
                        classificacao_slug,
                        problemas
                    FROM cv_pre_analises
                    WHERE id_processo = ? AND id_processo_ref = ?
                    """,
                    (processo.get("id_processo"), processo.get("id_processo_ref", "")),
                )
                analises_cv = rows_to_dicts(cursor, cursor.fetchall())
                analises_por_email = {
                    normalize_compare_text(item.get("email")): item
                    for item in analises_cv
                    if normalize_compare_text(item.get("email"))
                }
                analises_por_id = {
                    f"CV-{item.get('id_pre_analise')}": item
                    for item in analises_cv
                    if item.get("id_pre_analise") is not None
                }
                for candidato in candidatos:
                    analise = (
                        analises_por_id.get(normalize_text(candidato.get("id_teste")))
                        or analises_por_email.get(normalize_compare_text(candidato.get("email")))
                    )
                    if not analise:
                        continue
                    candidato["cv_id_pre_analise"] = analise.get("id_pre_analise")
                    candidato["cv_score_final"] = analise.get("score_final")
                    candidato["cv_classificacao"] = analise.get("classificacao")
                    candidato["cv_classificacao_slug"] = analise.get("classificacao_slug")
                    candidato["cv_problemas"] = analise.get("problemas")

                status_fluxo = [
                    get_candidate_visible_status(
                        item.get("status_candidato"),
                        item.get("status_entrevista"),
                    )
                    for item in candidatos
                ]
                candidatos_visiveis = [
                    item
                    for item, status_item in zip(candidatos, status_fluxo)
                    if status_item != CANDIDATE_STATUS_TALENT_BANK
                ]
                candidatos_ativos = [
                    item
                    for item, status_item in zip(candidatos, status_fluxo)
                    if status_item != CANDIDATE_STATUS_TALENT_BANK
                    and is_active_candidate_status(status_item)
                ]
                candidatos_aprovados = [
                    item
                    for item, status_item in zip(candidatos, status_fluxo)
                    if status_item == CANDIDATE_STATUS_APPROVED
                ]
                candidatos_finalizados = [
                    item
                    for item, status_item in zip(candidatos, status_fluxo)
                    if status_item != CANDIDATE_STATUS_TALENT_BANK
                    and status_item != CANDIDATE_STATUS_APPROVED
                    and not is_active_candidate_status(status_item)
                ]
                status_fluxo_visivel = [
                    status_item
                    for status_item in status_fluxo
                    if status_item != CANDIDATE_STATUS_TALENT_BANK
                ]

                resumo = {
                    "total": len(candidatos_visiveis),
                    "analise": sum(1 for status_item in status_fluxo_visivel if status_item == CANDIDATE_STATUS_ANALYSIS),
                    "qualificados": sum(1 for status_item in status_fluxo_visivel if status_item == CANDIDATE_STATUS_QUALIFIED),
                    "entrevistas": sum(
                        1
                        for status_item in status_fluxo_visivel
                        if status_item in INTERVIEW_OPERATIONAL_STATUSES
                    ),
                    "aprovados": sum(1 for status_item in status_fluxo_visivel if status_item == CANDIDATE_STATUS_APPROVED),
                    "eliminados": sum(1 for status_item in status_fluxo_visivel if status_item in {CANDIDATE_STATUS_ELIMINATED, CANDIDATE_STATUS_WITHDREW}),
                    "banco": sum(1 for status_item in status_fluxo if status_item == CANDIDATE_STATUS_TALENT_BANK),
                }
                processo["public_candidate_base_url"] = normalize_text(
                    getattr(self.settings, "public_candidate_base_url", ""),
                )
                processo["public_candidate_base_url_configured"] = bool(
                    processo["public_candidate_base_url"],
                )

                return {
                    "processo": processo,
                    "resumo": resumo,
                    "candidatos": candidatos_visiveis,
                    "candidatos_ativos": candidatos_ativos,
                    "candidatos_aprovados": candidatos_aprovados,
                    "candidatos_finalizados": candidatos_finalizados,
                }
            finally:
                conn.close()

        return self._run_with_deadlock_retry(
            f"carregar detalhes do processo {id_processo}",
            operation,
            retries=1,
            final_message="Não foi possível carregar os detalhes do processo agora por conta de concorrência no banco. Tente novamente em instantes.",
        )

"""Monitoria — fluxo pós-realização: feedback, confirmação, contestação,
réplica, reanálise, anexos e job de SLA (promt.txt §5.8–5.11).

Regra central: NADA aqui altera a monitoria original. Cada ação insere linhas
append-only (feedbacks, contestações, réplicas, reanálises, eventos) e atualiza
apenas `monitoria_estado` (estado corrente + SLA)."""

from __future__ import annotations

import html
import logging
from pathlib import Path

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR
from ..services import monitoria_workflow as wf
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_scope import pode_ver_operacao
from ..services.training_uploads import (
    CATEGORIA_DOCUMENTO,
    CATEGORIA_IMAGEM,
    save_training_upload,
    validate_training_upload,
)
from .monitoria import _http, _json, _load

logger = logging.getLogger(__name__)

MAX_ANEXOS_POR_CONTESTACAO = 5
MAX_ANEXO_MB = 10
SUBPASTA_EVIDENCIAS = "monitoria-evidencias"


class MonitoriaFluxoRepositoryMixin:
    # ------------------------------------------------------------------
    # Infra de carregamento e permissões de ação
    # ------------------------------------------------------------------
    def _mon_carregar_para_acao(self, cursor, ref: str) -> tuple[dict, dict]:
        ref = normalize_text(ref)
        por_codigo = len(ref) == 8 and ref.isdigit()
        cursor.execute(
            "SELECT id_monitoria, codigo, operacao, id_operador, operador_nome, operador_email, avaliador_nome, config_json, supervisores_json "
            "FROM dbo.monitorias WHERE " + ("codigo = ?" if por_codigo else "id_monitoria = ?"),
            (ref if por_codigo else int(ref or 0),),
        )
        row = cursor.fetchone()
        if not row:
            raise _http(status.HTTP_404_NOT_FOUND, "Monitoria não encontrada.")
        m = rows_to_dicts(cursor, [row])[0]
        cursor.execute(
            "SELECT status, resultado, sla_tipo, sla_inicio, sla_limite FROM dbo.monitoria_estado WITH (UPDLOCK, ROWLOCK) WHERE id_monitoria = ?",
            (m["id_monitoria"],),
        )
        estado = rows_to_dicts(cursor, [cursor.fetchone()])[0]
        m["operacao"] = normalize_text(m["operacao"])
        estado["status"] = normalize_text(estado["status"])
        return m, estado

    def _mon_eh_supervisor_responsavel(self, cursor, user, id_operador: int) -> bool:
        cursor.execute(
            "SELECT TOP 1 1 FROM dbo.usuarios_supervisores WHERE id_operador = ? AND id_supervisor = ?",
            (id_operador, user.id_usuario),
        )
        return cursor.fetchone() is not None

    def _mon_exigir_gestor_da_monitoria(self, cursor, user, m: dict, *, permitir_qualidade: bool) -> None:
        """Supervisor responsável (vínculo atual), Qualidade da operação (quando
        permitido) ou Administrador. Fora disso: 404 (não revela a existência)."""
        if user.perfil == ROLE_ADMIN:
            return
        if not pode_ver_operacao(user.perfil, user.operacoes, m["operacao"]):
            raise _http(status.HTTP_404_NOT_FOUND, "Monitoria não encontrada.")
        if user.perfil == ROLE_SUPERVISOR and self._mon_eh_supervisor_responsavel(cursor, user, int(m["id_operador"])):
            return
        if permitir_qualidade and user.perfil == ROLE_QUALIDADE:
            return
        raise _http(status.HTTP_403_FORBIDDEN, "Você não é o responsável por esta monitoria.")

    @staticmethod
    def _mon_exigir_operador_dono(user, m: dict) -> None:
        if user.perfil != ROLE_OPERATOR or user.id_usuario != int(m["id_operador"]):
            raise _http(status.HTTP_404_NOT_FOUND, "Monitoria não encontrada.")

    @staticmethod
    def _mon_validar(acao: str, estado: dict) -> None:
        try:
            wf.validar_transicao(acao, estado["status"])
        except wf.TransicaoInvalida as exc:
            raise _http(status.HTTP_409_CONFLICT, str(exc)) from exc

    @staticmethod
    def _mon_dentro_do_sla(cursor, id_monitoria: int) -> bool | None:
        cursor.execute(
            "SELECT CASE WHEN sla_limite IS NULL THEN NULL WHEN GETDATE() <= sla_limite THEN 1 ELSE 0 END FROM dbo.monitoria_estado WHERE id_monitoria = ?",
            (id_monitoria,),
        )
        row = cursor.fetchone()
        return None if row is None or row[0] is None else bool(row[0])

    # ------------------------------------------------------------------
    # Notificações (in-app na mesma transação; e-mail best-effort depois)
    # ------------------------------------------------------------------
    def _mon_notificar(self, cursor, emails: list[str], *, titulo: str, mensagem: str, categoria: str, id_monitoria: int) -> list[str]:
        destinos = sorted({normalize_text(e) for e in emails if normalize_text(e)})
        for email in destinos:
            self._criar_notificacao(
                cursor, destinatario_usuario=email, titulo=titulo, mensagem=mensagem, categoria=categoria,
                entidade="monitoria", entidade_id=str(id_monitoria),
            )
        return destinos

    def _mon_enviar_emails(self, destinos: list[str], assunto: str, mensagem: str) -> None:
        """Best-effort: falha de e-mail nunca desfaz nem bloqueia o fluxo."""
        if not destinos:
            return
        try:
            from ..services.email_send_service import EmailSendService

            servico = EmailSendService(self.settings)
            if not servico.configured:
                return
            corpo = f"<p>{html.escape(mensagem)}</p><p>Acesse o Conecta &gt; Monitoria para acompanhar.</p>"
            servico.send_mail(destinatarios=destinos, assunto=assunto, corpo_html=corpo)
        except Exception:  # noqa: BLE001
            logger.warning("Falha ao enviar e-mail de notificação da Monitoria.", exc_info=True)

    def _mon_emails_supervisores(self, cursor, id_operador: int) -> list[str]:
        cursor.execute(
            "SELECT u.email FROM dbo.usuarios_supervisores s JOIN dbo.usuarios u ON u.id_usuario = s.id_supervisor "
            "WHERE s.id_operador = ? AND u.status = 'Ativo'",
            (id_operador,),
        )
        return [normalize_text(r[0]) for r in cursor.fetchall()]

    # ------------------------------------------------------------------
    # Feedback
    # ------------------------------------------------------------------
    def mon_aplicar_feedback(self, user, ref: str, dados: dict, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            m, estado = self._mon_carregar_para_acao(cursor, ref)
            self._mon_exigir_gestor_da_monitoria(cursor, user, m, permitir_qualidade=True)
            self._mon_validar("aplicar_feedback", estado)
            observacao = normalize_text(dados.get("observacao"))
            if not observacao:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Registre a observação do feedback aplicado.")
            dentro = self._mon_dentro_do_sla(cursor, m["id_monitoria"])
            cursor.execute("SELECT sugestao_feedback FROM dbo.monitorias WHERE id_monitoria = ?", (m["id_monitoria"],))
            sugestao = normalize_text(cursor.fetchone()[0])
            cursor.execute(
                "INSERT INTO dbo.monitoria_feedbacks (id_monitoria, aplicado_por, aplicado_por_nome, observacao, sugestao_original, complemento, prazo_sla, dentro_sla) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (m["id_monitoria"], user.id_usuario, normalize_text(user.nome), observacao, sugestao or None,
                 normalize_text(dados.get("complemento")) or None, estado["sla_limite"], None if dentro is None else int(dentro)),
            )
            self._mon_registrar_passos(cursor, m["id_monitoria"], wf.passos_feedback_aplicado(), user, observacao=observacao)
            self.mon_log(cursor, user, acao="aplicar_feedback", operacao=m["operacao"], entidade="monitoria", entidade_id=m["id_monitoria"],
                         detalhes={"dentro_sla": dentro}, ip=ip)
            destinos = self._mon_notificar(
                cursor, [normalize_text(m["operador_email"])], titulo="Feedback aplicado",
                mensagem=f"O feedback da monitoria #{m['codigo']} foi aplicado. Você tem 48 horas para confirmar ou contestar.",
                categoria="monitoria_feedback_aplicado", id_monitoria=m["id_monitoria"],
            )
            conn.commit()
        finally:
            conn.close()
        self._mon_enviar_emails(destinos, "Monitoria: feedback aplicado",
                                f"O feedback da monitoria #{m['codigo']} foi aplicado. Confirme ou conteste em até 48 horas.")
        return {"success": True, "status": wf.AGUARDANDO_CONFIRMACAO}

    # ------------------------------------------------------------------
    # Confirmação / contestação / réplica (Operador)
    # ------------------------------------------------------------------
    def mon_confirmar(self, user, ref: str, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            m, estado = self._mon_carregar_para_acao(cursor, ref)
            self._mon_exigir_operador_dono(user, m)
            self._mon_validar("confirmar", estado)
            self._mon_registrar_passos(cursor, m["id_monitoria"], wf.passos_confirmacao(), user, observacao="Confirmada pelo operador.")
            self.mon_log(cursor, user, acao="confirmar_monitoria", operacao=m["operacao"], entidade="monitoria", entidade_id=m["id_monitoria"], ip=ip)
            conn.commit()
            return {"success": True, "status": wf.FINALIZADA}
        finally:
            conn.close()

    def mon_contestar(self, user, ref: str, dados: dict, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            m, estado = self._mon_carregar_para_acao(cursor, ref)
            self._mon_exigir_operador_dono(user, m)
            self._mon_validar("contestar", estado)
            config = _load(m["config_json"], {})
            existentes = {c["id"]: c["texto"] for b in config.get("blocos", []) for c in b.get("criterios", [])}
            criterios = [str(c) for c in (dados.get("criterios") or [])]
            if not criterios or any(c not in existentes for c in criterios):
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Selecione ao menos um critério contestado (da própria monitoria).")
            motivo = normalize_text(dados.get("motivo"))
            justificativa = normalize_text(dados.get("justificativa"))
            if not motivo or not justificativa:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o motivo e a justificativa da contestação.")
            dentro = self._mon_dentro_do_sla(cursor, m["id_monitoria"])
            cursor.execute(
                "INSERT INTO dbo.monitoria_contestacoes (id_monitoria, id_operador, criterios_json, motivo, justificativa, prazo_sla, dentro_sla) "
                "OUTPUT INSERTED.id_contestacao VALUES (?, ?, ?, ?, ?, ?, ?)",
                (m["id_monitoria"], user.id_usuario, _json([{"id": c, "texto": existentes[c]} for c in criterios]), motivo, justificativa,
                 estado["sla_limite"], None if dentro is None else int(dentro)),
            )
            id_contestacao = int(cursor.fetchone()[0])
            self._mon_registrar_passos(cursor, m["id_monitoria"], wf.passos_contestacao(), user, observacao=motivo)
            self.mon_log(cursor, user, acao="contestar_monitoria", operacao=m["operacao"], entidade="monitoria", entidade_id=m["id_monitoria"],
                         detalhes={"criterios": criterios, "id_contestacao": id_contestacao}, ip=ip)
            destinos = self._mon_notificar(
                cursor, self._mon_emails_supervisores(cursor, int(m["id_operador"])), titulo="Contestação recebida",
                mensagem=f"A monitoria #{m['codigo']} foi contestada por {normalize_text(m['operador_nome'])}. Prazo de reanálise: 72 horas.",
                categoria="monitoria_contestacao", id_monitoria=m["id_monitoria"],
            )
            conn.commit()
        finally:
            conn.close()
        self._mon_enviar_emails(destinos, "Monitoria: contestação recebida",
                                f"A monitoria #{m['codigo']} foi contestada e aguarda sua reanálise (72 horas).")
        return {"success": True, "id_contestacao": id_contestacao, "status": wf.REANALISE}

    def mon_replicar(self, user, ref: str, texto: str, *, ip: str = "") -> dict:
        texto = normalize_text(texto)
        if not texto:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escreva a réplica.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            m, estado = self._mon_carregar_para_acao(cursor, ref)
            self._mon_exigir_operador_dono(user, m)
            self._mon_validar("replicar", estado)
            cursor.execute("SELECT TOP 1 id_contestacao FROM dbo.monitoria_contestacoes WHERE id_monitoria = ? ORDER BY id_contestacao DESC", (m["id_monitoria"],))
            row = cursor.fetchone()
            cursor.execute(
                "INSERT INTO dbo.monitoria_replicas (id_contestacao, id_monitoria, id_autor, autor_nome, texto) VALUES (?, ?, ?, ?, ?)",
                (row[0], m["id_monitoria"], user.id_usuario, normalize_text(user.nome), texto),
            )
            self.mon_log(cursor, user, acao="replicar_contestacao", operacao=m["operacao"], entidade="monitoria", entidade_id=m["id_monitoria"], ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def mon_anexar_evidencia(self, user, ref: str, *, nome: str, conteudo: bytes, ip: str = "") -> dict:
        """Evidência da contestação: PDF/DOC(X)/PNG/JPG, até 10 MB, máx. 5 por
        contestação, gravada em disco com nome aleatório (nunca por rota pública)."""
        validado = None
        erro: HTTPException | None = None
        for categoria in (CATEGORIA_DOCUMENTO, CATEGORIA_IMAGEM):
            try:
                validado = validate_training_upload(
                    original_filename=nome, content=conteudo, categoria=categoria, max_bytes=MAX_ANEXO_MB * 1024 * 1024
                )
                break
            except HTTPException as exc:
                erro = exc
        if validado is None:
            raise erro  # type: ignore[misc]
        conn = self._connect()
        try:
            cursor = conn.cursor()
            m, estado = self._mon_carregar_para_acao(cursor, ref)
            self._mon_exigir_operador_dono(user, m)
            if estado["status"] != wf.REANALISE:
                raise _http(status.HTTP_409_CONFLICT, "Só é possível anexar evidências a uma contestação em reanálise.")
            cursor.execute("SELECT TOP 1 id_contestacao FROM dbo.monitoria_contestacoes WHERE id_monitoria = ? ORDER BY id_contestacao DESC", (m["id_monitoria"],))
            id_contestacao = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM dbo.monitoria_anexos WHERE id_contestacao = ?", (id_contestacao,))
            if int(cursor.fetchone()[0]) >= MAX_ANEXOS_POR_CONTESTACAO:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Limite de {MAX_ANEXOS_POR_CONTESTACAO} anexos por contestação.")
            caminho = save_training_upload(validado, upload_dir=self.settings.training_upload_dir, subpasta=SUBPASTA_EVIDENCIAS)
            cursor.execute(
                "INSERT INTO dbo.monitoria_anexos (id_contestacao, id_monitoria, nome_original, arquivo, mime, tamanho) "
                "OUTPUT INSERTED.id_anexo VALUES (?, ?, ?, ?, ?, ?)",
                (id_contestacao, m["id_monitoria"], validado.original_filename[:255], caminho.name, validado.mime_type, validado.size_bytes),
            )
            id_anexo = int(cursor.fetchone()[0])
            self.mon_log(cursor, user, acao="anexar_evidencia", operacao=m["operacao"], entidade="monitoria", entidade_id=m["id_monitoria"],
                         detalhes={"id_anexo": id_anexo, "nome": validado.original_filename}, ip=ip)
            conn.commit()
            return {"success": True, "id_anexo": id_anexo}
        finally:
            conn.close()

    def mon_obter_anexo(self, user, id_anexo: int) -> tuple[Path, str, str]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_monitoria, nome_original, arquivo, mime FROM dbo.monitoria_anexos WHERE id_anexo = ?", (int(id_anexo),))
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
        finally:
            conn.close()
        self.mon_detalhe(user, str(row[0]))  # mesma checagem de escopo do detalhe (404 fora do escopo)
        caminho = Path(self.settings.training_upload_dir) / SUBPASTA_EVIDENCIAS / normalize_text(row[2])
        if not caminho.exists():
            raise _http(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")
        return caminho, normalize_text(row[1]), normalize_text(row[3]) or "application/octet-stream"

    # ------------------------------------------------------------------
    # Reanálise (Supervisor responsável)
    # ------------------------------------------------------------------
    def mon_reanalisar(self, user, ref: str, dados: dict, *, ip: str = "") -> dict:
        resultado = normalize_text(dados.get("resultado")).upper()
        if resultado in ("MANTER", "MANTIDA", "MANTER_AVALIACAO"):
            resultado = wf.RESULTADO_CONFIRMADA
        elif resultado in ("ANULAR", "ANULADA"):
            resultado = wf.RESULTADO_ANULADA
        if resultado not in (wf.RESULTADO_CONFIRMADA, wf.RESULTADO_ANULADA):
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha 'Manter avaliação' ou 'Anular monitoria'.")
        observacao = normalize_text(dados.get("observacao"))
        if not observacao:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A observação da reanálise é obrigatória.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            m, estado = self._mon_carregar_para_acao(cursor, ref)
            self._mon_exigir_gestor_da_monitoria(cursor, user, m, permitir_qualidade=True)
            self._mon_validar("reanalisar", estado)
            dentro = self._mon_dentro_do_sla(cursor, m["id_monitoria"])
            cursor.execute("SELECT TOP 1 id_contestacao FROM dbo.monitoria_contestacoes WHERE id_monitoria = ? ORDER BY id_contestacao DESC", (m["id_monitoria"],))
            id_contestacao = int(cursor.fetchone()[0])
            cursor.execute(
                "INSERT INTO dbo.monitoria_reanalises (id_contestacao, id_monitoria, id_supervisor, supervisor_nome, resultado, observacao, automatico, dentro_sla) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                (id_contestacao, m["id_monitoria"], user.id_usuario, normalize_text(user.nome), resultado, observacao,
                 None if dentro is None else int(dentro)),
            )
            self._mon_registrar_passos(cursor, m["id_monitoria"], wf.passos_reanalise(resultado), user, observacao=observacao)
            self.mon_log(cursor, user, acao="reanalisar_contestacao", operacao=m["operacao"], entidade="monitoria", entidade_id=m["id_monitoria"],
                         detalhes={"resultado": resultado, "dentro_sla": dentro}, ip=ip)
            texto = "avaliação mantida" if resultado == wf.RESULTADO_CONFIRMADA else "monitoria anulada"
            destinos = self._mon_notificar(
                cursor, [normalize_text(m["operador_email"])], titulo="Contestação encerrada",
                mensagem=f"A contestação da monitoria #{m['codigo']} foi encerrada: {texto}. A monitoria foi para o histórico.",
                categoria="monitoria_reanalise", id_monitoria=m["id_monitoria"],
            )
            conn.commit()
        finally:
            conn.close()
        self._mon_enviar_emails(destinos, "Monitoria: contestação encerrada", f"A contestação da monitoria #{m['codigo']} foi encerrada: {texto}.")
        return {"success": True, "resultado": resultado, "status": wf.FINALIZADA}

    # ------------------------------------------------------------------
    # Job de SLA (idempotente) — confirma/anula automaticamente e sinaliza
    # ------------------------------------------------------------------
    def mon_processar_slas(self, *, lote: int = 200) -> dict:
        """Chamável pelo APScheduler, por CLI ou por endpoint interno protegido.
        Idempotente: cada item é reprocessado com lock de linha e o status é
        revalidado dentro da transação (rodar duas vezes não duplica nada)."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT TOP (?) id_monitoria FROM dbo.monitoria_estado WHERE status IN (?, ?) AND sla_limite IS NOT NULL "
                "AND sla_limite < GETDATE() ORDER BY sla_limite",
                (int(lote), wf.AGUARDANDO_CONFIRMACAO, wf.REANALISE),
            )
            ids = [int(r[0]) for r in cursor.fetchall()]
            cursor.execute(
                "SELECT COUNT(*) FROM dbo.monitoria_estado WHERE status = ? AND sla_limite IS NOT NULL AND sla_limite < GETDATE()",
                (wf.FEEDBACK_PENDENTE,),
            )
            feedbacks_vencidos = int(cursor.fetchone()[0])
        finally:
            conn.close()
        confirmadas = anuladas = 0
        for id_monitoria in ids:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                m, estado = self._mon_carregar_para_acao(cursor, str(id_monitoria))
                agora = self._mon_agora(cursor)
                acao = wf.acao_automatica_por_vencimento(estado["status"], estado["sla_limite"], agora)
                if acao is None:  # já tratado por outro processo/execução
                    conn.rollback()
                    continue
                if acao == "confirmar_automatico":
                    obs = "Confirmada automaticamente: 48 horas sem manifestação do operador."
                    self._mon_registrar_passos(cursor, id_monitoria, wf.passos_confirmacao(), None, automatico=True, observacao=obs)
                    self.mon_log(cursor, None, acao="confirmar_automatico", operacao=m["operacao"], entidade="monitoria",
                                 entidade_id=id_monitoria, detalhes={"sla": "CONFIRMACAO"})
                    confirmadas += 1
                else:
                    obs = "Anulada automaticamente: 72 horas sem reanálise do supervisor."
                    cursor.execute(
                        "SELECT TOP 1 id_contestacao FROM dbo.monitoria_contestacoes WHERE id_monitoria = ? ORDER BY id_contestacao DESC",
                        (id_monitoria,),
                    )
                    id_contestacao = int(cursor.fetchone()[0])
                    cursor.execute(
                        "INSERT INTO dbo.monitoria_reanalises (id_contestacao, id_monitoria, resultado, observacao, automatico, dentro_sla) "
                        "VALUES (?, ?, ?, ?, 1, 0)",
                        (id_contestacao, id_monitoria, wf.RESULTADO_ANULADA, obs),
                    )
                    self._mon_registrar_passos(cursor, id_monitoria, wf.passos_reanalise(wf.RESULTADO_ANULADA), None, automatico=True, observacao=obs)
                    self.mon_log(cursor, None, acao="anular_automatico", operacao=m["operacao"], entidade="monitoria",
                                 entidade_id=id_monitoria, detalhes={"sla": "REANALISE"})
                    anuladas += 1
                conn.commit()
            except Exception:  # noqa: BLE001 - um item com problema não derruba o lote
                conn.rollback()
                logger.exception("Falha ao processar SLA da monitoria %s", id_monitoria)
            finally:
                conn.close()
        return {"confirmadas_automaticamente": confirmadas, "anuladas_automaticamente": anuladas, "feedbacks_vencidos": feedbacks_vencidos}

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from ..services.cv import (
    CvTextExtractionError,
    extract_candidate_name_details,
    extract_competencies,
    extract_education_strength,
    extract_email,
    extract_experience_strength,
    extract_keywords,
    extract_phone,
    extract_professional_experiences,
    extract_text_from_uploaded_file,
    extract_whatsapp,
    is_valid_email,
    is_valid_phone,
    normalize_cv_text,
    score_cv_for_role,
    serialize_cv_problems,
)
from ..services.email_inbox_service import (
    EMAIL_INBOX_CONNECTION_ERROR_MESSAGE,
    EMAIL_INBOX_NOT_CONFIGURED_MESSAGE,
    EMAIL_INBOX_ORIGIN,
    MANUAL_UPLOAD_ORIGIN,
    EmailInboxService,
    EmailInboxUnavailable,
)
from ..services.helpers import normalize_compare_text, normalize_text, rows_to_dicts, safe_json_loads
from ..services.process_flow import CANDIDATE_STATUS_ANALYSIS, is_process_closed
from .bootstrap import (
    ensure_candidate_attachments_table,
    ensure_candidate_metadata_columns,
    ensure_candidate_metadata_table,
    ensure_cv_pre_analises_table,
    ensure_email_inbox_items_table,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    get_process_row,
    insert_candidate_process_record,
)


EMAIL_INBOX_QUEUE_PROCESS_ID = "EMAIL_INBOX"
EMAIL_INBOX_RETENTION_DAYS = 60


def _parse_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    safe_value = normalize_text(value)
    if not safe_value:
        return None
    try:
        return datetime.fromisoformat(safe_value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _extract_cv_contact(filename: str, content: bytes, content_type: str = "") -> dict:
    """Nome/e-mail/telefone extraídos do texto do CV (sem IA). Falha de leitura
    nunca bloqueia o cadastro: devolve o que conseguiu (ou vazio)."""
    try:
        texto = extract_text_from_uploaded_file(filename, content, content_type)
    except Exception:
        return {"nome": "", "email": "", "telefone": ""}
    email = extract_email(texto)
    telefone = extract_phone(texto)
    return {
        "nome": normalize_text(extract_candidate_name_details(texto, "", filename).get("nome")),
        "email": email if is_valid_email(email) else "",
        "telefone": telefone if is_valid_phone(telefone) else "",
    }


def _format_datetime(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return normalize_text(value)


def _is_older_than_email_inbox_retention(value) -> bool:
    parsed = _parse_datetime(value)
    if not parsed:
        return False
    return parsed < datetime.now() - timedelta(days=EMAIL_INBOX_RETENTION_DAYS)


def _friendly_detected(value: str) -> str:
    return normalize_text(value) or "Nao identificado"


def _only_digits(value: str) -> str:
    digits = "".join(char for char in normalize_text(value) if char.isdigit())
    if digits.startswith("55") and len(digits) in (12, 13):
        return digits[2:]
    return digits


def _application_fields_from_row(row: dict) -> dict:
    fields = safe_json_loads(row.get("campos_formulario_json"), {})
    return fields if isinstance(fields, dict) else {}


def _candidate_profile_kwargs_from_application(fields: dict) -> dict:
    return {
        "endereco": normalize_text(fields.get("endereco")) or None,
        "escolaridade": normalize_text(fields.get("escolaridade")) or None,
        "possui_experiencia": normalize_text(fields.get("experiencia")) or None,
        "musica": normalize_text(fields.get("musica")) or None,
        "prato": normalize_text(fields.get("prato")) or None,
        "futebol": normalize_text(fields.get("futebol")) or None,
        "time": normalize_text(fields.get("time")) or None,
        "rede_social": normalize_text(fields.get("rede_social")) or None,
    }


class EmailInboxRepositoryMixin:
    def _email_inbox_service(self) -> EmailInboxService:
        return EmailInboxService(self.settings)

    def get_configured_email_inbox_status(self) -> dict:
        return self._email_inbox_service().status()

    def _email_inbox_unavailable_payload(self, message: str = "") -> dict:
        status_payload = self.get_configured_email_inbox_status()
        status_payload["message"] = message or status_payload.get("message") or EMAIL_INBOX_NOT_CONFIGURED_MESSAGE
        status_payload["items"] = []
        return status_payload

    def _serialize_email_inbox_item(self, row: dict, *, include_body: bool = False) -> dict:
        attachments = safe_json_loads(row.get("attachments_json"), [])
        public_attachments = []
        for attachment in attachments if isinstance(attachments, list) else []:
            if not isinstance(attachment, dict):
                continue
            filename = normalize_text(attachment.get("filename") or attachment.get("nome"))
            content_type = normalize_text(attachment.get("content_type") or attachment.get("mime_type"))
            public_attachments.append(
                {
                    "id": normalize_text(attachment.get("id")),
                    "filename": filename,
                    "content_type": content_type,
                    "size": int(attachment.get("size") or attachment.get("tamanho_bytes") or 0),
                    "is_cv_candidate": bool(attachment.get("is_cv_candidate") or attachment.get("cv_compativel")),
                    "nome": filename,
                    "mime_type": content_type,
                    "tamanho_bytes": int(attachment.get("size") or attachment.get("tamanho_bytes") or 0),
                    "cv_compativel": bool(attachment.get("is_cv_candidate") or attachment.get("cv_compativel")),
                }
            )

        item = {
            "id": normalize_text(row.get("id")),
            "uid": normalize_text(row.get("message_uid")),
            "message_uid": normalize_text(row.get("message_uid")),
            "message_id": normalize_text(row.get("message_id")),
            "remetente": normalize_text(row.get("remetente")),
            "remetente_nome": normalize_text(row.get("remetente_nome")),
            "assunto": normalize_text(row.get("assunto")),
            "data_recebimento": _format_datetime(row.get("data_recebimento")),
            "data_hora": _format_datetime(row.get("data_recebimento")),
            "resumo": normalize_text(row.get("resumo")),
            "resumo_corpo": normalize_text(row.get("resumo")),
            "possui_anexo": bool(public_attachments or normalize_text(row.get("caminho_anexo"))),
            "anexos": public_attachments,
            "nome_anexo": normalize_text(row.get("nome_anexo")),
            "nome_detectado": _friendly_detected(row.get("nome_detectado")),
            "nome_candidato_possivel": _friendly_detected(row.get("nome_detectado")),
            "telefone_detectado": _friendly_detected(row.get("telefone_detectado")),
            "telefone_encontrado": _friendly_detected(row.get("telefone_detectado")),
            "email_detectado": _friendly_detected(row.get("email_detectado")),
            "email_encontrado": _friendly_detected(row.get("email_detectado")),
            "vaga_detectada": _friendly_detected(row.get("vaga_detectada")),
            "vaga_pretendida_possivel": _friendly_detected(row.get("vaga_detectada")),
            "experiencia_detectada": normalize_text(row.get("experiencia_detectada")) or "Nao identificado",
            "trabalhe_conosco": bool(row.get("trabalhe_conosco")),
            "campos_formulario": _application_fields_from_row(row),
            "curriculo_anexado_informado": normalize_text(row.get("curriculo_anexado_informado")),
            "inconsistencias": safe_json_loads(row.get("inconsistencias_json"), []),
            "status": normalize_text(row.get("status")) or "Recebido",
            "status_analise": normalize_text(row.get("status")) or "Recebido",
            "origem": normalize_text(row.get("origem")) or EMAIL_INBOX_ORIGIN,
            "oculto": bool(row.get("ignorado")),
            "ignorado": bool(row.get("ignorado")),
            "lido": bool(row.get("lido")),
            "processo_vinculado": normalize_text(row.get("processo_id")),
            "candidato_id": normalize_text(row.get("candidato_id")),
            "id_pre_analise": row.get("id_pre_analise"),
            "id_registro": row.get("id_registro"),
            "id_banco": row.get("id_banco"),
        }
        if include_body:
            item["corpo"] = normalize_text(row.get("corpo_texto")) or normalize_text(row.get("resumo"))
        return item

    def _select_email_inbox_item(self, cursor, item_id: str) -> dict:
        ensure_email_inbox_items_table(cursor)
        cursor.execute(
            """
            SELECT
                id,
                message_uid,
                message_id,
                remetente,
                remetente_nome,
                assunto,
                data_recebimento,
                resumo,
                corpo_texto,
                nome_detectado,
                telefone_detectado,
                email_detectado,
                vaga_detectada,
                experiencia_detectada,
                trabalhe_conosco,
                campos_formulario_json,
                curriculo_anexado_informado,
                inconsistencias_json,
                status,
                origem,
                caminho_anexo,
                nome_anexo,
                content_type,
                tamanho_anexo,
                attachments_json,
                metadata_path,
                processo_id,
                candidato_id,
                id_pre_analise,
                id_registro,
                id_banco,
                criado_em,
                atualizado_em,
                ignorado,
                lido
            FROM email_inbox_items
            WHERE id = ?
            """,
            (normalize_text(item_id),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="E-mail recebido não encontrado.")
        return rows[0]

    def _delete_email_inbox_saved_files(self, row: dict) -> None:
        service = self._email_inbox_service()
        try:
            root = service.attachments_root.resolve()
        except OSError:
            return

        paths = [
            normalize_text(row.get("caminho_anexo")),
            normalize_text(row.get("metadata_path")),
        ]
        attachments = safe_json_loads(row.get("attachments_json"), [])
        if isinstance(attachments, list):
            paths.extend(
                normalize_text(attachment.get("path"))
                for attachment in attachments
                if isinstance(attachment, dict)
            )

        touched_dirs: set[Path] = set()
        for raw_path in paths:
            if not raw_path:
                continue
            path = Path(raw_path)
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if root not in [resolved, *resolved.parents] or not resolved.is_file():
                continue
            try:
                touched_dirs.add(resolved.parent)
                resolved.unlink()
            except OSError as exc:
                self.logger.warning("Nao foi possivel excluir arquivo salvo do e-mail vencido: %s erro=%s", resolved, exc)

        for directory in sorted(touched_dirs, key=lambda item: len(item.parts), reverse=True):
            current = directory
            while current != root and root in current.parents:
                try:
                    current.rmdir()
                except OSError:
                    break
                current = current.parent

    def _purge_expired_email_inbox_items(self, cursor) -> int:
        ensure_email_inbox_items_table(cursor)
        cursor.execute(
            """
            SELECT
                id,
                message_uid,
                caminho_anexo,
                attachments_json,
                metadata_path
            FROM email_inbox_items
            WHERE COALESCE(atualizado_em, criado_em, data_recebimento, GETDATE()) < DATEADD(day, ?, GETDATE())
            """,
            (-EMAIL_INBOX_RETENTION_DAYS,),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        deleted = 0
        for row in rows:
            item_id = normalize_text(row.get("id"))
            if not item_id:
                continue
            uid = normalize_text(row.get("message_uid"))
            if uid:
                try:
                    self._email_inbox_service().delete_message(uid)
                except EmailInboxUnavailable as exc:
                    self.logger.warning(
                        "Nao foi possivel excluir e-mail vencido no IMAP. O registro local sera removido. item_id=%s erro=%s",
                        item_id,
                        exc.message,
                    )
                except Exception as exc:
                    self.logger.warning(
                        "Falha inesperada ao excluir e-mail vencido no IMAP. O registro local sera removido. item_id=%s erro=%s",
                        item_id,
                        exc,
                    )
            self._delete_email_inbox_saved_files(row)
            cursor.execute("DELETE FROM email_inbox_items WHERE id = ?", (item_id,))
            deleted += 1
        return deleted

    def _upsert_email_inbox_summary(self, cursor, item: dict) -> None:
        ensure_email_inbox_items_table(cursor)
        item_id = normalize_text(item.get("id"))
        if not item_id:
            return

        cursor.execute(
            """
            SELECT status, ignorado, caminho_anexo, attachments_json
            FROM email_inbox_items
            WHERE id = ?
            """,
            (item_id,),
        )
        existing = cursor.fetchone()
        existing_status = normalize_text(existing[0]) if existing else ""
        existing_ignored = bool(existing[1]) if existing else False
        existing_attachment_path = normalize_text(existing[2]) if existing else ""
        existing_attachments = normalize_text(existing[3]) if existing else ""
        incoming_attachments_json = json.dumps(item.get("anexos") or [], ensure_ascii=False)
        attachments_json = existing_attachments if existing_attachment_path and existing_attachments else incoming_attachments_json
        first_attachment = (item.get("anexos") or [{}])[0] if item.get("anexos") else {}
        incoming_status = normalize_text(item.get("status")) or "Recebido"
        if existing_ignored:
            effective_status = "Ignorado"
        elif existing_status in {"", "Recebido"}:
            effective_status = incoming_status
        else:
            effective_status = existing_status
        data_recebimento = _parse_datetime(item.get("data_recebimento"))
        params = (
            normalize_text(item.get("message_uid") or item.get("uid")),
            normalize_text(item.get("message_id")),
            normalize_text(item.get("remetente")),
            normalize_text(item.get("remetente_nome")),
            normalize_text(item.get("assunto")),
            data_recebimento,
            normalize_text(item.get("resumo")),
            normalize_text(item.get("corpo")) or normalize_text(item.get("resumo")),
            normalize_text(item.get("nome_detectado") or item.get("nome_candidato_possivel")),
            normalize_text(item.get("telefone_detectado") or item.get("telefone_encontrado")),
            normalize_text(item.get("email_detectado") or item.get("email_encontrado")),
            normalize_text(item.get("vaga_detectada") or item.get("vaga_pretendida_possivel")),
            normalize_text(item.get("experiencia_detectada")),
            1 if item.get("trabalhe_conosco") else 0,
            json.dumps(item.get("campos_formulario") or {}, ensure_ascii=False),
            normalize_text(item.get("curriculo_anexado_informado")),
            json.dumps(item.get("inconsistencias") or [], ensure_ascii=False),
            effective_status,
            normalize_text(item.get("origem")) or EMAIL_INBOX_ORIGIN,
            normalize_text(item.get("nome_anexo")),
            normalize_text(first_attachment.get("content_type") or first_attachment.get("mime_type")),
            int(first_attachment.get("size") or first_attachment.get("tamanho_bytes") or 0),
            attachments_json,
        )

        if existing:
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    message_uid = ?,
                    message_id = ?,
                    remetente = ?,
                    remetente_nome = ?,
                    assunto = ?,
                    data_recebimento = ?,
                    resumo = ?,
                    corpo_texto = ?,
                    nome_detectado = ?,
                    telefone_detectado = ?,
                    email_detectado = ?,
                    vaga_detectada = ?,
                    experiencia_detectada = ?,
                    trabalhe_conosco = ?,
                    campos_formulario_json = ?,
                    curriculo_anexado_informado = ?,
                    inconsistencias_json = ?,
                    status = ?,
                    origem = ?,
                    nome_anexo = COALESCE(NULLIF(nome_anexo, ''), ?),
                    content_type = COALESCE(NULLIF(content_type, ''), ?),
                    tamanho_anexo = CASE WHEN ISNULL(tamanho_anexo, 0) = 0 THEN ? ELSE tamanho_anexo END,
                    attachments_json = ?
                WHERE id = ?
                """,
                (*params, item_id),
            )
            return

        cursor.execute(
            """
            INSERT INTO email_inbox_items
            (
                id,
                message_uid,
                message_id,
                remetente,
                remetente_nome,
                assunto,
                data_recebimento,
                resumo,
                corpo_texto,
                nome_detectado,
                telefone_detectado,
                email_detectado,
                vaga_detectada,
                experiencia_detectada,
                trabalhe_conosco,
                campos_formulario_json,
                curriculo_anexado_informado,
                inconsistencias_json,
                status,
                origem,
                nome_anexo,
                content_type,
                tamanho_anexo,
                attachments_json,
                criado_em,
                atualizado_em,
                ignorado
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE(), 0)
            """,
            (item_id, *params),
        )

    def _list_email_inbox_rows(
        self,
        cursor,
        *,
        limit: int,
        include_ignored: bool,
        with_attachments_only: bool,
        query: str,
    ) -> list[dict]:
        ensure_email_inbox_items_table(cursor)
        safe_limit = self._clamp_limit(limit, default=50, maximum=200)
        cursor.execute(
            f"""
            SELECT TOP ({safe_limit})
                id,
                message_uid,
                message_id,
                remetente,
                remetente_nome,
                assunto,
                data_recebimento,
                resumo,
                corpo_texto,
                nome_detectado,
                telefone_detectado,
                email_detectado,
                vaga_detectada,
                experiencia_detectada,
                trabalhe_conosco,
                campos_formulario_json,
                curriculo_anexado_informado,
                inconsistencias_json,
                status,
                origem,
                caminho_anexo,
                nome_anexo,
                content_type,
                tamanho_anexo,
                attachments_json,
                metadata_path,
                processo_id,
                candidato_id,
                id_pre_analise,
                id_registro,
                id_banco,
                criado_em,
                atualizado_em,
                ignorado,
                lido
            FROM email_inbox_items
            WHERE (? = 1 OR ISNULL(ignorado, 0) = 0)
              AND ISNULL(origem, '') <> ?
            ORDER BY data_recebimento DESC, criado_em DESC
            """,
            (1 if include_ignored else 0, MANUAL_UPLOAD_ORIGIN),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        query_term = normalize_compare_text(query)
        result = []
        for row in rows:
            item = self._serialize_email_inbox_item(row)
            if with_attachments_only and not item.get("possui_anexo") and not item.get("trabalhe_conosco"):
                continue
            if query_term:
                haystack = " ".join(
                    normalize_text(item.get(key))
                    for key in ("remetente", "assunto", "resumo", "nome_detectado", "vaga_detectada", "email_detectado", "experiencia_detectada")
                )
                if query_term not in normalize_compare_text(haystack):
                    continue
            result.append(item)
        return result[:safe_limit]

    def list_configured_email_inbox_messages(
        self,
        *,
        limit: int = 50,
        unread_only: bool = False,
        with_attachments_only: bool = True,
        refresh: bool = True,
        query: str = "",
        include_ignored: bool = False,
    ) -> dict:
        status_payload = self.get_configured_email_inbox_status()
        if not status_payload.get("enabled") or not status_payload.get("configured"):
            status_payload["items"] = []
            return status_payload

        message = ""
        items = []
        if refresh:
            try:
                items = self._email_inbox_service().fetch_messages(
                    limit=limit,
                    unread_only=unread_only,
                    with_attachments_only=with_attachments_only,
                    query=query,
                )
                status_payload["status"] = "ok"
            except EmailInboxUnavailable as exc:
                message = exc.message or EMAIL_INBOX_CONNECTION_ERROR_MESSAGE
                status_payload["status"] = "error"
            except Exception as exc:
                self.logger.exception("Falha isolada ao consultar caixa de e-mail: %s", exc)
                message = EMAIL_INBOX_CONNECTION_ERROR_MESSAGE
                status_payload["status"] = "error"

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            deleted_expired = self._purge_expired_email_inbox_items(cursor)
            for item in items:
                item_id = normalize_text(item.get("id"))
                if item_id and _is_older_than_email_inbox_retention(item.get("data_recebimento")):
                    cursor.execute("SELECT 1 FROM email_inbox_items WHERE id = ?", (item_id,))
                    if not cursor.fetchone():
                        uid = normalize_text(item.get("message_uid") or item.get("uid"))
                        if uid:
                            try:
                                self._email_inbox_service().delete_message(uid)
                            except EmailInboxUnavailable as exc:
                                self.logger.warning(
                                    "Nao foi possivel excluir e-mail antigo no IMAP antes do cadastro local. uid=%s erro=%s",
                                    uid,
                                    exc.message,
                                )
                        deleted_expired += 1
                        continue
                self._upsert_email_inbox_summary(cursor, item)
            conn.commit()
            listed = self._list_email_inbox_rows(
                cursor,
                limit=limit,
                include_ignored=include_ignored,
                with_attachments_only=with_attachments_only,
                query=query,
            )
        finally:
            conn.close()

        return {
            **status_payload,
            "message": message,
            "retention_days": EMAIL_INBOX_RETENTION_DAYS,
            "deleted_expired": deleted_expired,
            "items": listed,
        }

    def get_configured_email_inbox_item(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            if not row.get("lido"):
                cursor.execute(
                    "UPDATE email_inbox_items SET lido = 1 WHERE id = ?",
                    (normalize_text(item_id),),
                )
                conn.commit()
                row["lido"] = True
            return {"success": True, "item": self._serialize_email_inbox_item(row, include_body=True)}
        finally:
            conn.close()

    def mark_email_inbox_item_read(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            cursor.execute(
                "UPDATE email_inbox_items SET lido = 1 WHERE id = ?",
                (normalize_text(item_id),),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="E-mail recebido não encontrado.")
            conn.commit()
            row = self._select_email_inbox_item(cursor, item_id)
            return {"success": True, "item": self._serialize_email_inbox_item(row)}
        finally:
            conn.close()

    def create_manual_email_inbox_item(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str = "",
        actor: str = "",
    ) -> dict:
        item_id = f"manual-{uuid4().hex[:20]}"
        saved = self._email_inbox_service().save_manual_attachment(
            item_id=item_id,
            filename=filename,
            content=content,
            content_type=content_type,
        )
        attachment = saved["attachment"]
        contato = _extract_cv_contact(filename, content, content_type)
        item = {
            "id": item_id,
            "remetente_nome": f"Upload manual — {normalize_text(actor) or 'RH'}",
            "assunto": "Currículo adicionado manualmente",
            "data_recebimento": saved["received_at"],
            "status": "Recebido",
            "nome_anexo": attachment.get("filename"),
            "anexos": [attachment],
            "origem": MANUAL_UPLOAD_ORIGIN,
            "nome_detectado": contato["nome"],
            "email_detectado": contato["email"],
            "telefone_detectado": contato["telefone"],
        }

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            self._upsert_email_inbox_summary(cursor, item)
            self._register_manual_cv_candidate(
                cursor,
                item_id=item_id,
                nome=contato["nome"] or Path(normalize_text(filename)).stem,
                email=contato["email"],
                telefone=contato["telefone"],
                attachment=attachment,
            )
            conn.commit()
            row = self._select_email_inbox_item(cursor, item_id)
            return {"success": True, "item": self._serialize_email_inbox_item(row, include_body=True)}
        finally:
            conn.close()

    def extract_candidate_cv_contact(self, id_teste: str) -> dict:
        """"Preencher com o CV": lê o currículo salvo do candidato e devolve
        nome/e-mail/telefone para o RH revisar (nada é gravado aqui)."""
        asset = self.get_candidate_cv_asset(id_teste)
        if asset.get("bytes") is not None:
            content = asset["bytes"]
        else:
            content = Path(asset["path"]).read_bytes()
        contato = _extract_cv_contact(asset.get("filename") or "curriculo.pdf", content, asset.get("media_type") or "")
        if not any(contato.values()):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Não foi possível identificar nome, e-mail ou telefone neste currículo.",
            )
        return {"success": True, **contato}

    def _register_manual_cv_candidate(
        self,
        cursor,
        *,
        item_id: str,
        nome: str,
        email: str = "",
        telefone: str = "",
        attachment: dict | None = None,
    ) -> None:
        """CV manual = candidato desde o início (aparece na Central de
        Candidatos sem processo). Cria a ficha e vincula o arquivo pelo
        id_teste para "Ver CV" e "Preencher com o CV" funcionarem."""
        id_teste = f"EMAIL-{normalize_text(item_id)[:110]}"
        try:
            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=normalize_text(nome),
                email=email or None,
                telefone=telefone or None,
                whatsapp=telefone or None,
            )
            if attachment:
                self._save_email_inbox_attachment_link(
                    cursor,
                    id_teste=id_teste,
                    processo=None,
                    attachment=attachment,
                )
            cursor.execute(
                "UPDATE email_inbox_items SET candidato_id = ? WHERE id = ?",
                (id_teste, normalize_text(item_id)),
            )
        except Exception:
            self.logger.exception("Falha ao registrar candidato do CV manual %s.", item_id)

    def create_manual_structured_email_inbox_item(self, *, dados: dict, actor: str = "") -> dict:
        """Correcoes.txt (rodada de 02/set/2026): "Criar curriculo" na Cx de
        Curriculos -- alternativa ao upload de arquivo (create_manual_email_inbox_item
        acima) para o RH cadastrar um candidato preenchendo um formulario
        estruturado (contato + experiencia + formacao), sem depender de um
        anexo. Reaproveita as mesmas colunas que o parser do "trabalhe
        conosco" ja usa (nome_detectado/email_detectado/telefone_detectado/
        campos_formulario_json), entao a listagem e o detalhe da Cx de
        Curriculos ja existentes exibem o resultado sem trabalho extra.
        """
        item_id = f"manual-{uuid4().hex[:20]}"
        nome = normalize_text(dados.get("nome"))
        email = normalize_text(dados.get("email"))
        telefone = normalize_text(dados.get("telefone"))
        cidade = normalize_text(dados.get("cidade"))
        bairro = normalize_text(dados.get("bairro"))
        endereco = normalize_text(dados.get("endereco"))
        data_nascimento = normalize_text(dados.get("data_nascimento"))
        vaga = normalize_text(dados.get("vaga_pretendida"))
        experiencias = list(dados.get("experiencias") or []) if dados.get("experiencia_ativa") else []
        formacao = list(dados.get("formacao") or []) if dados.get("formacao_ativa") else []

        linhas = [f"Currículo criado manualmente por {actor or 'RH'}.", "", f"Nome: {nome}"]
        if email:
            linhas.append(f"E-mail: {email}")
        if telefone:
            linhas.append(f"Telefone: {telefone}")
        if bairro or cidade:
            linhas.append(f"Localização: {', '.join(parte for parte in (bairro, cidade) if parte)}")
        if endereco:
            linhas.append(f"Endereço: {endereco}")
        if data_nascimento:
            linhas.append(f"Data de nascimento: {data_nascimento}")
        if vaga:
            linhas.append(f"Vaga pretendida: {vaga}")

        if experiencias:
            linhas.append("")
            linhas.append("Experiência profissional:")
            for experiencia in experiencias:
                titulo = " — ".join(
                    parte for parte in (normalize_text(experiencia.get("cargo")), normalize_text(experiencia.get("empresa"))) if parte
                )
                linha = f"- {titulo}" if titulo else "- (sem cargo/empresa informado)"
                periodo = normalize_text(experiencia.get("periodo"))
                if periodo:
                    linha += f" ({periodo})"
                linhas.append(linha)
                descricao = normalize_text(experiencia.get("descricao"))
                if descricao:
                    linhas.append(f"  {descricao}")

        if formacao:
            linhas.append("")
            linhas.append("Formação acadêmica:")
            for item_formacao in formacao:
                titulo = " — ".join(
                    parte for parte in (normalize_text(item_formacao.get("curso")), normalize_text(item_formacao.get("instituicao"))) if parte
                )
                linha = f"- {titulo}" if titulo else "- (sem curso/instituição informado)"
                extras = [
                    parte
                    for parte in (
                        normalize_text(item_formacao.get("nivel")),
                        normalize_text(item_formacao.get("periodo")),
                        normalize_text(item_formacao.get("status")),
                    )
                    if parte
                ]
                if extras:
                    linha += f" ({', '.join(extras)})"
                linhas.append(linha)

        corpo = "\n".join(linhas)
        item = {
            "id": item_id,
            "remetente_nome": f"Criado manualmente — {actor or 'RH'}",
            "assunto": "Currículo criado manualmente",
            "data_recebimento": datetime.now().isoformat(),
            "resumo": corpo[:500],
            "corpo": corpo,
            "nome_detectado": nome,
            "telefone_detectado": telefone,
            "email_detectado": email,
            "vaga_detectada": vaga,
            "experiencia_detectada": "sim" if experiencias else "nao",
            "trabalhe_conosco": True,
            "campos_formulario": {
                "cidade": cidade,
                "bairro": bairro,
                "endereco": endereco,
                "data_nascimento": data_nascimento,
                "experiencias": experiencias,
                "formacao": formacao,
            },
            "status": "Recebido",
            "origem": MANUAL_UPLOAD_ORIGIN,
        }

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            self._upsert_email_inbox_summary(cursor, item)
            self._register_manual_cv_candidate(
                cursor,
                item_id=item_id,
                nome=nome,
                email=email if is_valid_email(email) else "",
                telefone=telefone if is_valid_phone(telefone) else "",
                attachment=None,
            )
            conn.commit()
            row = self._select_email_inbox_item(cursor, item_id)
            return {"success": True, "item": self._serialize_email_inbox_item(row, include_body=True)}
        finally:
            conn.close()

    def download_configured_email_inbox_attachments(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            existing_attachments = safe_json_loads(row.get("attachments_json"), [])
            try:
                self._email_inbox_service().resolve_saved_attachment(existing_attachments, "")
                return {
                    "success": True,
                    "downloaded": 0,
                    "item": self._serialize_email_inbox_item(row),
                }
            except EmailInboxUnavailable as exc:
                self.logger.debug("Caixa de e-mail indisponivel para reuso de anexo salvo: %s", exc)

            uid = normalize_text(row.get("message_uid"))
            if not uid:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="UID do e-mail não encontrado.")
            try:
                result = self._email_inbox_service().download_cv_attachments(uid=uid, item_id=normalize_text(row.get("id")))
            except EmailInboxUnavailable as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE if not exc.configured else status.HTTP_400_BAD_REQUEST,
                    detail=exc.message,
                ) from exc

            attachments = result.get("attachments") or []
            first_attachment = attachments[0] if attachments else {}
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    caminho_anexo = ?,
                    nome_anexo = ?,
                    content_type = ?,
                    tamanho_anexo = ?,
                    attachments_json = ?,
                    metadata_path = ?,
                    status = CASE WHEN status = 'Recebido' THEN 'Anexo baixado' ELSE status END,
                    atualizado_em = GETDATE()
                WHERE id = ?
                """,
                (
                    normalize_text(first_attachment.get("path")),
                    normalize_text(first_attachment.get("filename") or first_attachment.get("nome")),
                    normalize_text(first_attachment.get("content_type") or first_attachment.get("mime_type")),
                    int(first_attachment.get("size") or first_attachment.get("tamanho_bytes") or 0),
                    json.dumps(attachments, ensure_ascii=False),
                    normalize_text(result.get("metadata_path")),
                    normalize_text(row.get("id")),
                ),
            )
            conn.commit()
            updated = self._select_email_inbox_item(cursor, item_id)
            return {
                "success": True,
                "downloaded": len(attachments),
                "item": self._serialize_email_inbox_item(updated),
            }
        finally:
            conn.close()

    def _ensure_email_inbox_downloaded(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            attachments = safe_json_loads(row.get("attachments_json"), [])
            has_saved = any(isinstance(item, dict) and normalize_text(item.get("path")) for item in attachments)
        finally:
            conn.close()
        if not has_saved:
            self.download_configured_email_inbox_attachments(item_id)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            return self._select_email_inbox_item(cursor, item_id)
        finally:
            conn.close()

    def _get_email_inbox_saved_attachment_if_any(self, item_id: str) -> dict | None:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            attachments = safe_json_loads(row.get("attachments_json"), [])
            has_saved = any(isinstance(item, dict) and normalize_text(item.get("path")) for item in attachments)
        finally:
            conn.close()

        if not has_saved:
            try:
                self.download_configured_email_inbox_attachments(item_id)
            except HTTPException as exc:
                if exc.status_code != status.HTTP_400_BAD_REQUEST:
                    raise
                return None

        try:
            return self.get_configured_email_inbox_attachment(item_id, "")
        except HTTPException:
            return None

    def _resolve_email_inbox_candidate_identity(self, cursor, row: dict, pre_analysis: dict | None = None) -> dict:
        fields = _application_fields_from_row(row)
        candidate_name = (
            normalize_text((pre_analysis or {}).get("nome_candidato"))
            or normalize_text(fields.get("nome"))
            or normalize_text(row.get("nome_detectado"))
            or "Candidato recebido por e-mail"
        )
        email = (
            normalize_text((pre_analysis or {}).get("email"))
            or normalize_text(fields.get("email"))
            or normalize_text(row.get("email_detectado"))
        )
        phone = (
            normalize_text((pre_analysis or {}).get("telefone"))
            or normalize_text(fields.get("telefone"))
            or normalize_text(row.get("telefone_detectado"))
        )
        whatsapp = normalize_text((pre_analysis or {}).get("whatsapp")) or phone

        if email and not is_valid_email(email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-mail invalido no cadastro recebido.")
        if phone and not is_valid_phone(phone):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Telefone nao identificado ou invalido no cadastro recebido.")

        id_teste = f"CV-{pre_analysis.get('id_pre_analise')}" if pre_analysis else ""
        if not id_teste:
            id_teste = self._find_candidate_profile_id_by_identity(
                cursor,
                nome_candidato=candidate_name,
                email=email,
                telefone=phone,
                whatsapp=whatsapp,
            ) or f"EMAIL-{normalize_text(row.get('id'))[:110]}"

        return {
            "id_teste": id_teste,
            "nome_candidato": candidate_name,
            "email": email,
            "telefone": phone,
            "whatsapp": whatsapp,
            "form_fields": fields,
        }

    def _find_candidate_profile_id_by_identity(
        self,
        cursor,
        *,
        nome_candidato: str = "",
        email: str = "",
        telefone: str = "",
        whatsapp: str = "",
    ) -> str:
        safe_email = normalize_compare_text(email)
        safe_name = normalize_compare_text(nome_candidato)
        safe_phones = {_only_digits(telefone), _only_digits(whatsapp)}
        safe_phones.discard("")
        ensure_candidate_metadata_table(cursor)
        ensure_candidate_metadata_columns(cursor)
        cursor.execute(
            """
            SELECT id_teste, nome_candidato, email, telefone, whatsapp
            FROM candidatos_metadata
            """
        )
        for profile in rows_to_dicts(cursor, cursor.fetchall()):
            profile_id = normalize_text(profile.get("id_teste"))
            if not profile_id:
                continue
            profile_email = normalize_compare_text(profile.get("email"))
            if safe_email and profile_email == safe_email:
                return profile_id
            profile_phones = {_only_digits(profile.get("telefone")), _only_digits(profile.get("whatsapp"))}
            profile_phones.discard("")
            if safe_phones and profile_phones.intersection(safe_phones):
                return profile_id
            if safe_name and safe_email and normalize_compare_text(profile.get("nome_candidato")) == safe_name and profile_email == safe_email:
                return profile_id
        return ""

    def _candidate_profile_kwargs_for_email_import(self, cursor, id_teste: str, fields: dict) -> dict:
        incoming = _candidate_profile_kwargs_from_application(fields)
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            return incoming

        ensure_candidate_metadata_table(cursor)
        ensure_candidate_metadata_columns(cursor)
        cursor.execute(
            """
            SELECT
                endereco,
                escolaridade,
                possui_experiencia,
                musica,
                prato,
                futebol,
                time,
                rede_social
            FROM candidatos_metadata
            WHERE id_teste = ?
            """,
            (safe_id_teste,),
        )
        row = cursor.fetchone()
        if not row:
            return incoming

        existing = {
            "endereco": row[0],
            "escolaridade": row[1],
            "possui_experiencia": row[2],
            "musica": row[3],
            "prato": row[4],
            "futebol": row[5],
            "time": row[6],
            "rede_social": row[7],
        }
        return {
            key: value
            for key, value in incoming.items()
            if value is not None and not normalize_text(existing.get(key))
        }

    def get_configured_email_inbox_attachment(self, item_id: str, attachment_id: str = "") -> dict:
        row = self._ensure_email_inbox_downloaded(item_id)
        attachments = safe_json_loads(row.get("attachments_json"), [])
        try:
            return self._email_inbox_service().resolve_saved_attachment(attachments, attachment_id)
        except EmailInboxUnavailable as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.message) from exc

    def _save_email_inbox_attachment_link(
        self,
        cursor,
        *,
        id_teste: str,
        processo: dict | None,
        attachment: dict,
    ) -> None:
        ensure_candidate_attachments_table(cursor)
        process_id = normalize_text((processo or {}).get("id_processo"))
        process_ref = normalize_text((processo or {}).get("id_processo_ref"))
        filename = normalize_text(attachment.get("filename") or attachment.get("nome"))
        path = Path(normalize_text(attachment.get("path")))
        cursor.execute(
            """
            DELETE FROM candidatos_anexos
            WHERE id_teste = ? AND id_processo = ? AND id_processo_ref = ?
            """,
            (normalize_text(id_teste), process_id, process_ref),
        )
        cursor.execute(
            """
            INSERT INTO candidatos_anexos
            (
                id_teste,
                id_processo,
                id_processo_ref,
                nome_arquivo_original,
                nome_arquivo_armazenado,
                tipo_arquivo,
                caminho_arquivo,
                tamanho_bytes,
                criado_em,
                atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
            """,
            (
                normalize_text(id_teste),
                process_id,
                process_ref,
                filename,
                path.name,
                normalize_text(attachment.get("content_type")) or "application/octet-stream",
                str(path),
                path.stat().st_size if path.exists() else int(attachment.get("size") or 0),
            ),
        )

    def _load_email_inbox_pre_analysis(self, cursor, id_pre_analise: int) -> dict | None:
        if not id_pre_analise:
            return None
        ensure_cv_pre_analises_table(cursor)
        cursor.execute(
            """
            SELECT TOP 1
                id_pre_analise,
                id_processo,
                id_processo_ref,
                nome_candidato,
                email,
                telefone,
                whatsapp,
                score_final,
                classificacao,
                nome_arquivo,
                mime_type
            FROM cv_pre_analises
            WHERE id_pre_analise = ?
            """,
            (int(id_pre_analise),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        return rows[0] if rows else None

    def analyze_configured_email_inbox_cv(self, item_id: str) -> dict:
        row = self._ensure_email_inbox_downloaded(item_id)
        attachment = self.get_configured_email_inbox_attachment(item_id, "")
        path = Path(attachment["path"])
        filename = normalize_text(attachment.get("filename")) or path.name
        mime_type = normalize_text(attachment.get("content_type")) or "application/octet-stream"
        try:
            content = path.read_bytes()
            extracted = extract_text_from_uploaded_file(filename, content, mime_type)
        except CvTextExtractionError as exc:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                ensure_email_inbox_items_table(cursor)
                cursor.execute(
                    """
                    UPDATE email_inbox_items
                    SET status = 'Erro na analise', atualizado_em = GETDATE()
                    WHERE id = ?
                    """,
                    (normalize_text(item_id),),
                )
                conn.commit()
            finally:
                conn.close()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.user_message) from exc

        normalized_text = normalize_cv_text(extracted)
        if not normalized_text:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo vazio ou corrompido.")

        name_details = extract_candidate_name_details(
            normalized_text,
            fallback_name=normalize_text(row.get("nome_detectado")),
            filename=filename,
        )
        form_fields = _application_fields_from_row(row)
        candidate_name = normalize_text(form_fields.get("nome")) or name_details.get("nome") or normalize_text(row.get("nome_detectado")) or "Candidato recebido por e-mail"
        email = normalize_text(form_fields.get("email")) or extract_email(normalized_text) or normalize_text(row.get("email_detectado"))
        phone = normalize_text(form_fields.get("telefone")) or extract_phone(normalized_text) or normalize_text(row.get("telefone_detectado"))
        whatsapp = extract_whatsapp(normalized_text) or phone
        phone_base = whatsapp or phone
        keywords = extract_keywords(normalized_text)
        competencies = extract_competencies(normalized_text)
        experiences = extract_professional_experiences(normalized_text)
        evaluation = score_cv_for_role(
            normalize_text(row.get("vaga_detectada")),
            keywords,
            bool(email),
            bool(phone_base),
            len(normalized_text),
            candidate_name,
            email,
            phone_base,
            extract_education_strength(normalized_text),
            extract_experience_strength(normalized_text),
            name_details.get("confianca", "baixa"),
            competencies,
            experiences,
        )
        evaluation["nome_detectado"] = candidate_name
        evaluation["confianca_nome"] = name_details.get("confianca", "baixa")
        evaluation["fonte_nome"] = name_details.get("fonte", "")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            ensure_cv_pre_analises_table(cursor)
            ensure_candidate_attachments_table(cursor)
            fresh_row = self._select_email_inbox_item(cursor, item_id)
            existing_id = int(fresh_row.get("id_pre_analise") or 0)
            if not existing_id:
                cursor.execute(
                    """
                    SELECT TOP 1 id_pre_analise
                    FROM cv_pre_analises
                    WHERE origem = ?
                      AND (
                        (ISNULL(email_uid, '') <> '' AND email_uid = ?)
                        OR (ISNULL(email_message_id, '') <> '' AND email_message_id = ?)
                        OR (? <> '' AND LOWER(LTRIM(RTRIM(ISNULL(email, '')))) = LOWER(?))
                      )
                    ORDER BY id_pre_analise DESC
                    """,
                    (
                        EMAIL_INBOX_ORIGIN,
                        normalize_text(fresh_row.get("id")),
                        normalize_text(fresh_row.get("message_id")),
                        email,
                        email,
                    ),
                )
                existing = cursor.fetchone()
                existing_id = int(existing[0]) if existing else 0

            if existing_id:
                cursor.execute(
                    """
                    UPDATE email_inbox_items
                    SET
                        status = 'Analisado',
                        id_pre_analise = ?,
                        candidato_id = ?,
                        atualizado_em = GETDATE()
                    WHERE id = ?
                    """,
                    (existing_id, f"CV-{existing_id}", normalize_text(item_id)),
                )
                conn.commit()
                return {
                    "success": True,
                    "duplicate": True,
                    "id_pre_analise": existing_id,
                    "message": "CV recebido por e-mail já existia na pré-análise.",
                }

            cursor.execute(
                """
                INSERT INTO cv_pre_analises
                (
                    id_processo,
                    id_processo_ref,
                    nome_candidato,
                    email,
                    telefone,
                    whatsapp,
                    palavras_chave,
                    score_final,
                    classificacao,
                    classificacao_slug,
                    problemas,
                    texto_extraido,
                    nome_arquivo,
                    mime_type,
                    arquivo_original_base64,
                    ja_adicionado_ao_processo,
                    oculto_na_lista,
                    origem,
                    email_uid,
                    email_message_id,
                    email_attachment_name,
                    email_remetente,
                    email_assunto,
                    email_data
                )
                OUTPUT INSERTED.id_pre_analise
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    EMAIL_INBOX_QUEUE_PROCESS_ID,
                    "",
                    candidate_name,
                    email,
                    phone,
                    whatsapp,
                    json.dumps(evaluation["keywords_validas"], ensure_ascii=False),
                    evaluation["score"],
                    evaluation["classificacao"],
                    evaluation["slug"],
                    serialize_cv_problems(evaluation),
                    normalized_text,
                    filename,
                    mime_type,
                    base64.b64encode(content).decode("utf-8"),
                    EMAIL_INBOX_ORIGIN,
                    normalize_text(row.get("id")),
                    normalize_text(row.get("message_id")),
                    filename,
                    normalize_text(row.get("remetente")),
                    normalize_text(row.get("assunto")),
                    row.get("data_recebimento"),
                ),
            )
            id_pre_analise = int(cursor.fetchone()[0])
            id_teste = f"CV-{id_pre_analise}"
            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=candidate_name,
                email=email,
                telefone=phone,
                whatsapp=whatsapp,
                **_candidate_profile_kwargs_from_application(form_fields),
            )
            self._save_email_inbox_attachment_link(
                cursor,
                id_teste=id_teste,
                processo=None,
                attachment=attachment,
            )
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    status = 'Analisado',
                    id_pre_analise = ?,
                    candidato_id = ?,
                    nome_detectado = ?,
                    email_detectado = ?,
                    telefone_detectado = ?,
                    atualizado_em = GETDATE()
                WHERE id = ?
                """,
                (id_pre_analise, id_teste, candidate_name, email, phone, normalize_text(item_id)),
            )
            conn.commit()
            return {
                "success": True,
                "duplicate": False,
                "id_pre_analise": id_pre_analise,
                "classificacao": evaluation["classificacao"],
                "score": evaluation["score"],
            }
        finally:
            conn.close()

    def link_configured_email_inbox_to_process(self, item_id: str, data: dict) -> dict:
        process_ref = normalize_text(data.get("id_processo_ref") or data.get("id_processo"))
        if not process_ref:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Processo de destino não informado.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            id_pre_analise = int(row.get("id_pre_analise") or 0)
            has_attachment = bool(self._serialize_email_inbox_item(row).get("possui_anexo"))
        finally:
            conn.close()
        if not id_pre_analise and has_attachment:
            self.analyze_configured_email_inbox_cv(item_id)

        attachment = self._get_email_inbox_saved_attachment_if_any(item_id) if has_attachment else None
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            ensure_candidate_attachments_table(cursor)
            processo = get_process_row(cursor, process_ref)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo de destino não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este processo está encerrado e não aceita novos candidatos.",
                )
            fresh_row = self._select_email_inbox_item(cursor, item_id)
            pre_analysis = self._load_email_inbox_pre_analysis(cursor, int(fresh_row.get("id_pre_analise") or 0))
            identity = self._resolve_email_inbox_candidate_identity(cursor, fresh_row, pre_analysis)
            candidate_name = identity["nome_candidato"]
            email = identity["email"]
            phone = identity["telefone"]
            whatsapp = identity["whatsapp"]
            id_teste = identity["id_teste"]
            existing_candidate = self._find_process_candidate_by_identity(
                cursor,
                processo,
                id_teste=id_teste,
                email=email,
                telefone=phone,
                whatsapp=whatsapp,
            )
            if existing_candidate:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este candidato já está vinculado a este processo.")

            id_registro = insert_candidate_process_record(
                cursor,
                processo,
                {
                    "id_teste": id_teste,
                    "nome_candidato": candidate_name,
                    "vaga": processo.get("vaga") or normalize_text(fresh_row.get("vaga_detectada")),
                    "status_candidato": CANDIDATE_STATUS_ANALYSIS,
                    "pontuacao_final": str((pre_analysis or {}).get("score_final") or "").replace(".", ","),
                    "data_prova": datetime.now().isoformat(),
                    "origem": EMAIL_INBOX_ORIGIN,
                    "etapa_pipeline": "Triagem",
                    "data_atualizacao_pipeline": datetime.now(),
                },
            )
            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=candidate_name,
                email=email,
                telefone=phone,
                whatsapp=whatsapp,
                **self._candidate_profile_kwargs_for_email_import(cursor, id_teste, identity["form_fields"]),
            )
            if attachment:
                self._save_email_inbox_attachment_link(
                    cursor,
                    id_teste=id_teste,
                    processo=processo,
                    attachment=attachment,
                )
            self._record_candidate_movement(
                cursor,
                id_teste=id_teste,
                id_registro=id_registro,
                id_processo=processo.get("id_processo"),
                id_processo_ref=processo.get("id_processo_ref", ""),
                nome_candidato=candidate_name,
                vaga=processo.get("vaga") or "",
                origem_inicial=EMAIL_INBOX_ORIGIN,
                tipo_movimentacao="Candidato vinculado a partir de e-mail recebido",
                status_novo=CANDIDATE_STATUS_ANALYSIS,
                observacao=f"Remetente: {fresh_row.get('remetente')}; assunto: {fresh_row.get('assunto')}",
            )
            if pre_analysis:
                cursor.execute(
                    """
                    UPDATE cv_pre_analises
                    SET
                        ja_adicionado_ao_processo = 1,
                        id_processo = ?,
                        id_processo_ref = ?
                    WHERE id_pre_analise = ?
                    """,
                    (processo.get("id_processo"), processo.get("id_processo_ref", ""), int(pre_analysis.get("id_pre_analise"))),
                )
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    status = 'Vinculado ao processo',
                    processo_id = ?,
                    candidato_id = ?,
                    id_registro = ?,
                    atualizado_em = GETDATE()
                WHERE id = ?
                """,
                (processo.get("id_processo_ref") or processo.get("id_processo"), id_teste, id_registro, normalize_text(item_id)),
            )
            conn.commit()
            return {"success": True, "id_registro": id_registro}
        finally:
            conn.close()

    def send_configured_email_inbox_to_talent_bank(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            id_pre_analise = int(row.get("id_pre_analise") or 0)
            has_attachment = bool(self._serialize_email_inbox_item(row).get("possui_anexo"))
        finally:
            conn.close()
        if not id_pre_analise and has_attachment:
            self.analyze_configured_email_inbox_cv(item_id)

        attachment = self._get_email_inbox_saved_attachment_if_any(item_id) if has_attachment else None
        conn = self._connect()
        try:
            cursor = conn.cursor()
            row = self._select_email_inbox_item(cursor, item_id)
            pre_analysis = self._load_email_inbox_pre_analysis(cursor, int(row.get("id_pre_analise") or 0))
            identity = self._resolve_email_inbox_candidate_identity(cursor, row, pre_analysis)
            # Lido com a conexão ainda aberta: antes era chamado depois do close() e o
            # cursor fechado estourava, fazendo todo envio da Caixa de CV falhar (T1-CV-06).
            profile_kwargs = self._candidate_profile_kwargs_for_email_import(cursor, identity["id_teste"], identity["form_fields"])
            conn.commit()
        finally:
            conn.close()

        candidate_name = identity["nome_candidato"]
        email = identity["email"]
        phone = identity["telefone"]
        whatsapp = identity["whatsapp"]
        id_teste = identity["id_teste"]
        result = self.add_candidate_to_talent_bank(
            {
                "id_teste": id_teste,
                "id_processo": "",
                "id_processo_ref": "",
                "nome_candidato": candidate_name,
                "vaga": normalize_text(row.get("vaga_detectada")) or "Banco de Talentos",
                "pontuacao_final": str((pre_analysis or {}).get("score_final") or "").replace(".", ","),
                "data_movimentacao": datetime.now().isoformat(),
                "origem": EMAIL_INBOX_ORIGIN,
                "email": email,
                "telefone": phone,
                "whatsapp": whatsapp,
                **profile_kwargs,
            }
        )
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if attachment:
                self._save_email_inbox_attachment_link(
                    cursor,
                    id_teste=id_teste,
                    processo=None,
                    attachment=attachment,
                )
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    status = 'Enviado ao Banco de Talentos',
                    candidato_id = ?,
                    id_banco = ?,
                    atualizado_em = GETDATE()
                WHERE id = ?
                """,
                (id_teste, result.get("id_banco"), normalize_text(item_id)),
            )
            conn.commit()
        finally:
            conn.close()
        return result

    def ignore_configured_email_inbox_item(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            self._select_email_inbox_item(cursor, item_id)
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    status = 'Ignorado',
                    ignorado = 1,
                    atualizado_em = GETDATE()
                WHERE id = ?
                """,
                (normalize_text(item_id),),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def delete_configured_email_inbox_item(self, item_id: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            row = self._select_email_inbox_item(cursor, item_id)
            uid = normalize_text(row.get("message_uid"))
        finally:
            conn.close()

        if uid:
            try:
                self._email_inbox_service().delete_message(uid)
            except EmailInboxUnavailable as exc:
                self.logger.warning(
                    "Não foi possível excluir o e-mail no IMAP. O item será ocultado no sistema. item_id=%s erro=%s",
                    item_id,
                    exc.message,
                )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_email_inbox_items_table(cursor)
            self._select_email_inbox_item(cursor, item_id)
            cursor.execute(
                """
                UPDATE email_inbox_items
                SET
                    status = 'Excluído',
                    ignorado = 1,
                    atualizado_em = GETDATE()
                WHERE id = ?
                """,
                (normalize_text(item_id),),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

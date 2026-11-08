from __future__ import annotations

import base64
import html as html_lib
import imaplib
import json
import mimetypes
import os
import re
import smtplib
from datetime import datetime
from email import policy
from email.header import decode_header
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, status

from ..services.cv import (
    CvTextExtractionError,
    extract_candidate_name,
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
    normalize_cv_text,
    score_cv_for_role,
    serialize_cv_problems,
)
from ..services.graph_client import GraphClient
from ..services.helpers import normalize_compare_text, normalize_text, rows_to_dicts
from ..services.notifications import transicao_elegivel_para_email_automatico
from ..services.process_flow import (
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_QUALIFIED,
    build_process_closed_message,
    is_process_closed,
    map_cv_classification_to_status,
)
from .bootstrap import (
    ensure_candidate_attachments_table,
    ensure_cv_pre_analises_table,
    ensure_notification_automation_table,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    get_process_row,
    insert_candidate_process_record,
)

CV_ATTACHMENT_EXTENSIONS = {".pdf", ".doc", ".docx"}
EMAIL_INBOX_ORIGIN = "Recebimento de e-mail"
EMAIL_INBOX_FILE_DROP_MODE = "file_drop"
EMAIL_INBOX_QUEUE_PROCESS_ID = "EMAIL_INBOX"
EMAIL_INBOX_STATUS_FILE = "conecta_status.json"
EMAIL_INBOX_IGNORED_FLAG = "ignored.flag"
EMAIL_INBOX_UNCONFIGURED_MESSAGE = (
    "Recebimento de e-mail ainda não configurado. Configure a pasta de entrada gerada pelo Power Automate."
)


def _decode_header_value(value: str | None) -> str:
    parts = []
    for raw, charset in decode_header(value or ""):
        if isinstance(raw, bytes):
            parts.append(raw.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(raw)
    return normalize_text("".join(parts))


def _extract_first_email(value: str) -> str:
    addresses = getaddresses([value or ""])
    for _, address in addresses:
        safe = normalize_text(address)
        if safe:
            return safe
    match = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", value or "")
    return match.group(0) if match else ""


def _attachment_extension(filename: str) -> str:
    safe_name = normalize_text(filename).lower()
    if "." not in safe_name:
        return ""
    return f".{safe_name.rsplit('.', 1)[-1]}"


def _safe_email_item_id(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", normalize_text(value)).strip("._")
    return safe[:100] or "email"


def _email_candidate_id(item_id: str) -> str:
    safe = _safe_email_item_id(item_id)
    candidate_id = f"EMAIL-{safe}"
    return candidate_id[:120]


def _parse_metadata_datetime(value: str | None) -> datetime | None:
    safe_value = normalize_text(value)
    if not safe_value:
        return None
    try:
        parsed = datetime.fromisoformat(safe_value.replace("Z", "+00:00"))
        if parsed.tzinfo:
            return parsed.replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


class CommunicationRepositoryMixin:
    def _uses_graph_inbox(self) -> bool:
        mode = normalize_compare_text(getattr(self.settings, "email_inbox_mode", EMAIL_INBOX_FILE_DROP_MODE))
        return mode in {"graph", "msgraph", "microsoft graph", "microsoft-graph", "office365 graph"}

    def _uses_file_drop_inbox(self) -> bool:
        mode = normalize_compare_text(getattr(self.settings, "email_inbox_mode", EMAIL_INBOX_FILE_DROP_MODE))
        return mode in {"", "file_drop", "file drop", "file-drop", "folder", "pasta"}

    def _email_inbox_path(self) -> Path | None:
        inbox_path = normalize_text(getattr(self.settings, "email_inbox_path", ""))
        return Path(inbox_path) if inbox_path else None

    def _get_inbox_password(self) -> str:
        env_name = normalize_text(getattr(self.settings, "email_inbox_password_env", ""))
        return os.getenv(env_name, "") if env_name else ""

    def _get_graph_client_secret(self) -> str:
        env_name = normalize_text(getattr(self.settings, "email_graph_client_secret_env", ""))
        return os.getenv(env_name, "") if env_name else ""

    def _get_smtp_password(self) -> str:
        env_name = normalize_text(getattr(self.settings, "email_smtp_password_env", ""))
        return os.getenv(env_name, "") if env_name else ""

    def _inbox_unavailable_payload(self, message: str = "") -> dict:
        return {
            "success": True,
            "enabled": bool(getattr(self.settings, "email_inbox_enabled", False)),
            "configured": False,
            "email_address": normalize_text(getattr(self.settings, "email_inbox_address", "")),
            "mode": normalize_text(getattr(self.settings, "email_inbox_mode", EMAIL_INBOX_FILE_DROP_MODE))
            or EMAIL_INBOX_FILE_DROP_MODE,
            "inbox_path": normalize_text(getattr(self.settings, "email_inbox_path", "")),
            "message": message or EMAIL_INBOX_UNCONFIGURED_MESSAGE,
            "items": [],
        }

    def _graph_unconfigured_message(self) -> str:
        return (
            "Microsoft Graph ainda não configurado. Informe RH_EMAIL_GRAPH_TENANT_ID, "
            "RH_EMAIL_GRAPH_CLIENT_ID e a variável definida em RH_EMAIL_GRAPH_CLIENT_SECRET_ENV."
        )

    def _graph_mailbox_user(self) -> str:
        return (
            normalize_text(getattr(self.settings, "email_graph_mailbox", ""))
            or normalize_text(getattr(self.settings, "email_inbox_username", ""))
            or normalize_text(getattr(self.settings, "email_inbox_address", ""))
        )

    def _graph_client(self) -> GraphClient:
        # Achado S-27: implementação HTTP única (obtenção de token + request +
        # tratamento de erro) compartilhada com onedrive_service.py e
        # email_send_service.py — este mixin apenas configura o cliente com
        # as settings de e-mail (tenant/client/secret/scope/base_url já
        # existentes) e a mensagem de permissão específica de leitura de
        # e-mail (Mail.Read/Mail.ReadBasic.All).
        return GraphClient(
            tenant_id=normalize_text(getattr(self.settings, "email_graph_tenant_id", "")),
            client_id=normalize_text(getattr(self.settings, "email_graph_client_id", "")),
            client_secret=self._get_graph_client_secret(),
            scope=normalize_text(getattr(self.settings, "email_graph_scope", "")),
            base_url=normalize_text(getattr(self.settings, "email_graph_base_url", "")),
            unconfigured_message=self._graph_unconfigured_message(),
            forbidden_message=(
                "Microsoft Graph recusou a autorizacao. Verifique permissoes "
                "Mail.Read/Mail.ReadBasic.All e admin consent no Azure."
            ),
        )

    def _get_graph_token(self) -> str:
        return self._graph_client().get_token()

    def _graph_request(self, token: str, path: str, params: dict | None = None) -> dict:
        return self._graph_client().get_json(path, params=params, token=token)

    def _graph_message_path(self, message_id: str = "") -> str:
        mailbox = self._graph_mailbox_user()
        if not mailbox:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=self._graph_unconfigured_message(),
            )

        base = f"/users/{quote(mailbox, safe='')}"
        if message_id:
            return f"{base}/messages/{quote(message_id, safe='')}"

        folder = normalize_text(getattr(self.settings, "email_inbox_mailbox", "")) or "inbox"
        folder_id = "inbox" if normalize_compare_text(folder) == "inbox" else folder
        return f"{base}/mailFolders/{quote(folder_id, safe='')}/messages"

    def _strip_graph_uid(self, uid: str) -> str:
        safe_uid = normalize_text(uid)
        return safe_uid.removeprefix("graph:")

    def _graph_datetime(self, value: str | None):
        safe_value = normalize_text(value)
        if not safe_value:
            return None
        try:
            return datetime.fromisoformat(safe_value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return safe_value

    def _graph_message_body(self, message: dict) -> str:
        body = message.get("body") if isinstance(message.get("body"), dict) else {}
        content = normalize_text(body.get("content") or message.get("bodyPreview") or "")
        if normalize_compare_text(body.get("contentType")) == "html":
            content = re.sub(r"<br\s*/?>", "\n", content, flags=re.IGNORECASE)
            content = re.sub(r"</p\s*>", "\n", content, flags=re.IGNORECASE)
            content = re.sub(r"<[^>]+>", " ", content)
            content = html_lib.unescape(content)
        return normalize_text(content)

    def _graph_sender(self, message: dict) -> tuple[str, str]:
        sender = message.get("from") if isinstance(message.get("from"), dict) else {}
        email_address = sender.get("emailAddress") if isinstance(sender.get("emailAddress"), dict) else {}
        name = normalize_text(email_address.get("name"))
        address = normalize_text(email_address.get("address"))
        display = f"{name} <{address}>" if name and address else name or address
        return display, address

    def _graph_attachment_summaries(self, token: str, message_id: str, *, include_content: bool = False) -> list[dict]:
        path = f"{self._graph_message_path(message_id)}/attachments"
        payload = self._graph_request(token, path)
        attachments = []
        for item in payload.get("value", []):
            if item.get("isInline"):
                continue
            filename = normalize_text(item.get("name"))
            if not filename:
                continue
            attachment_id = normalize_text(item.get("id"))
            attachment = {
                "id": attachment_id,
                "nome": filename,
                "mime_type": normalize_text(item.get("contentType")),
                "cv_compativel": _attachment_extension(filename) in CV_ATTACHMENT_EXTENSIONS,
            }
            if include_content:
                content_bytes = item.get("contentBytes")
                if not content_bytes and attachment_id:
                    detail = self._graph_request(token, f"{path}/{quote(attachment_id, safe='')}")
                    content_bytes = detail.get("contentBytes")
                if content_bytes:
                    attachment["content_bytes"] = content_bytes
            attachments.append(attachment)
        return attachments

    def _serialize_graph_message(self, token: str, message: dict) -> dict:
        subject = normalize_text(message.get("subject")) or "(sem assunto)"
        body = self._graph_message_body(message)
        sender_raw, sender_email = self._graph_sender(message)
        message_id = normalize_text(message.get("id"))
        attachments = (
            self._graph_attachment_summaries(token, message_id)
            if message.get("hasAttachments") and message_id
            else []
        )
        candidate_email = extract_email(body) or sender_email
        return {
            "uid": f"graph:{message_id}",
            "message_id": normalize_text(message.get("internetMessageId")) or message_id,
            "remetente": sender_raw,
            "remetente_email": sender_email,
            "assunto": subject,
            "data_hora": self._graph_datetime(message.get("receivedDateTime")),
            "resumo": normalize_text(message.get("bodyPreview")) or ((body[:420] + "...") if len(body) > 420 else body),
            "nome_candidato_possivel": self._extract_candidate_name_from_email(subject, body),
            "vaga_pretendida_possivel": self._extract_role_from_email(subject, body),
            "telefone_encontrado": extract_whatsapp(body) or extract_phone(body),
            "email_encontrado": candidate_email,
            "possui_anexo": bool(attachments),
            "anexos": attachments,
            "nome_anexo": attachments[0]["nome"] if attachments else "",
            "status_analise": "Pendente",
        }

    def _list_graph_email_inbox(self, limit: int = 12) -> dict:
        token = self._get_graph_token()
        top = self._clamp_limit(limit, default=12, maximum=30)
        payload = self._graph_request(
            token,
            self._graph_message_path(),
            params={
                "$top": str(top),
                "$orderby": "receivedDateTime desc",
                "$select": "id,internetMessageId,subject,receivedDateTime,from,bodyPreview,body,hasAttachments",
            },
        )
        return {
            "success": True,
            "enabled": True,
            "configured": True,
            "email_address": normalize_text(getattr(self.settings, "email_inbox_address", "")),
            "message": "",
            "items": [self._serialize_graph_message(token, item) for item in payload.get("value", [])],
        }

    def _fetch_graph_message_and_cv_attachment(self, uid: str, requested_name: str = "") -> tuple[dict, str, str, bytes]:
        token = self._get_graph_token()
        message_id = self._strip_graph_uid(uid)
        if not message_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-mail não informado.")

        message = self._graph_request(
            token,
            self._graph_message_path(message_id),
            params={"$select": "id,internetMessageId,subject,receivedDateTime,from,bodyPreview,body,hasAttachments"},
        )
        requested = normalize_compare_text(requested_name)
        fallback = None
        for attachment in self._graph_attachment_summaries(token, message_id, include_content=True):
            if not attachment.get("cv_compativel"):
                continue
            content_base64 = normalize_text(attachment.get("content_bytes"))
            if not content_base64:
                continue
            content = base64.b64decode(content_base64)
            candidate = (attachment["nome"], attachment["mime_type"], content)
            if requested and normalize_compare_text(attachment["nome"]) == requested:
                return message, *candidate
            if fallback is None:
                fallback = candidate

        if fallback:
            return message, *fallback
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sem anexo de CV compatível neste e-mail.")

    def _open_inbox(self, *, readonly: bool = True):
        if not getattr(self.settings, "email_inbox_enabled", False):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Recebimento de e-mail ainda não configurado ou indisponível no momento.",
            )

        host = normalize_text(getattr(self.settings, "email_inbox_imap_host", ""))
        port = int(getattr(self.settings, "email_inbox_imap_port", 993) or 993)
        username = (
            normalize_text(getattr(self.settings, "email_inbox_username", ""))
            or normalize_text(getattr(self.settings, "email_inbox_address", ""))
        )
        password = self._get_inbox_password()
        mailbox = normalize_text(getattr(self.settings, "email_inbox_mailbox", "")) or "INBOX"

        if not host or not username or not password:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Recebimento de e-mail ainda não configurado ou indisponível no momento.",
            )

        mailbox_client = imaplib.IMAP4_SSL(host, port)
        mailbox_client.login(username, password)
        mailbox_client.select(mailbox, readonly=readonly)
        return mailbox_client

    def _fetch_email_message(self, uid: str):
        safe_uid = normalize_text(uid)
        if not safe_uid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-mail não informado.")

        mailbox = self._open_inbox(readonly=True)
        try:
            typ, data = mailbox.uid("fetch", safe_uid, "(RFC822)")
            if typ != "OK" or not data:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="E-mail não encontrado.")
            for item in data:
                if isinstance(item, tuple) and item[1]:
                    return BytesParser(policy=policy.default).parsebytes(item[1])
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="E-mail não encontrado.")
        finally:
            try:
                mailbox.logout()
            except Exception as exc:
                self.logger.debug("Falha ao encerrar sessao IMAP: %s", exc)

    def _message_plain_text(self, message) -> str:
        body = ""
        try:
            plain_part = message.get_body(preferencelist=("plain",))
            if plain_part:
                body = plain_part.get_content()
        except Exception:
            body = ""

        if body:
            return normalize_text(body)

        parts = []
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get_content_type() != "text/plain":
                continue
            try:
                parts.append(part.get_content())
            except Exception:
                payload = part.get_payload(decode=True) or b""
                parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
        return normalize_text("\n".join(parts))

    def _extract_candidate_name_from_email(self, subject: str, body: str, filename: str = "") -> str:
        for pattern in (
            r"\bnome\s*[:\-]\s*([^\n\r|]+)",
            r"\bcandidato\s*[:\-]\s*([^\n\r|]+)",
        ):
            match = re.search(pattern, body or "", flags=re.IGNORECASE)
            if match:
                return normalize_text(match.group(1))[:120]

        subject_clean = re.sub(r"\b(curriculo|currículo|cv|vaga|candidatura)\b", " ", subject or "", flags=re.IGNORECASE)
        subject_clean = re.split(r"[-|/]", subject_clean, maxsplit=1)[0]
        name = normalize_text(subject_clean)
        if len(name.split()) >= 2:
            return name[:120]
        return extract_candidate_name(body or "", filename=filename)

    def _extract_role_from_email(self, subject: str, body: str) -> str:
        for pattern in (
            r"\bvaga\s*[:\-]\s*([^\n\r|]+)",
            r"\bcargo\s*[:\-]\s*([^\n\r|]+)",
            r"\barea\s*[:\-]\s*([^\n\r|]+)",
        ):
            match = re.search(pattern, body or "", flags=re.IGNORECASE)
            if match:
                return normalize_text(match.group(1))[:120]

        match = re.search(r"\bvaga\s+(?:de|para)?\s*([A-Za-zÀ-ÿ0-9 /.-]{3,80})", subject or "", flags=re.IGNORECASE)
        return normalize_text(match.group(1)) if match else ""

    def _message_date(self, message) -> datetime | None:
        try:
            parsed = parsedate_to_datetime(message.get("date", ""))
            if parsed and parsed.tzinfo:
                return parsed.replace(tzinfo=None)
            return parsed
        except Exception:
            return None

    def _message_attachment_summaries(self, message) -> list[dict]:
        attachments = []
        for part in message.iter_attachments():
            filename = _decode_header_value(part.get_filename())
            if not filename:
                continue
            extension = _attachment_extension(filename)
            attachments.append(
                {
                    "nome": filename,
                    "mime_type": normalize_text(part.get_content_type()),
                    "cv_compativel": extension in CV_ATTACHMENT_EXTENSIONS,
                }
            )
        return attachments

    def _serialize_email_message(self, uid: str, message) -> dict:
        subject = _decode_header_value(message.get("subject"))
        sender_raw = _decode_header_value(message.get("from"))
        body = self._message_plain_text(message)
        attachments = self._message_attachment_summaries(message)
        candidate_email = extract_email(body) or _extract_first_email(sender_raw)
        return {
            "uid": normalize_text(uid),
            "message_id": normalize_text(message.get("message-id")),
            "remetente": sender_raw,
            "remetente_email": _extract_first_email(sender_raw),
            "assunto": subject or "(sem assunto)",
            "data_hora": self._message_date(message),
            "resumo": (body[:420] + "...") if len(body) > 420 else body,
            "nome_candidato_possivel": self._extract_candidate_name_from_email(subject, body),
            "vaga_pretendida_possivel": self._extract_role_from_email(subject, body),
            "telefone_encontrado": extract_whatsapp(body) or extract_phone(body),
            "email_encontrado": candidate_email,
            "possui_anexo": bool(attachments),
            "anexos": attachments,
            "nome_anexo": attachments[0]["nome"] if attachments else "",
            "status_analise": "Pendente",
        }

    def _read_email_drop_metadata(self, metadata_path: Path) -> dict | None:
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as exc:
            self.logger.warning("metadata.json invalido em %s: %s", metadata_path, exc)
            return None
        except OSError as exc:
            self.logger.warning("Não foi possível ler metadata.json em %s: %s", metadata_path, exc)
            return None
        if not isinstance(payload, dict):
            self.logger.warning("metadata.json ignorado por nao ser objeto JSON: %s", metadata_path)
            return None
        return payload

    def _email_drop_status_path(self, folder: Path) -> Path:
        return folder / EMAIL_INBOX_STATUS_FILE

    def _read_email_drop_status(self, folder: Path) -> dict:
        status_path = self._email_drop_status_path(folder)
        if not status_path.exists():
            return {}
        try:
            payload = json.loads(status_path.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            self.logger.warning("Status do e-mail recebido invalido em %s: %s", status_path, exc)
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write_email_drop_status(self, folder: Path, updates: dict) -> None:
        current = self._read_email_drop_status(folder)
        current.update(updates or {})
        current["atualizado_em"] = datetime.now().isoformat()
        self._email_drop_status_path(folder).write_text(
            json.dumps(current, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _resolve_email_drop_folder(self, item_id: str) -> Path:
        root = self._email_inbox_path()
        if not root or not root.exists() or not root.is_dir():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=EMAIL_INBOX_UNCONFIGURED_MESSAGE)
        safe_id = normalize_text(item_id)
        if not safe_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-mail não informado.")
        try:
            for candidate in root.iterdir():
                if candidate.is_dir() and candidate.name == safe_id:
                    return candidate
        except OSError as exc:
            self.logger.exception("Falha ao acessar pasta de e-mails recebidos: %s", exc)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=EMAIL_INBOX_UNCONFIGURED_MESSAGE) from exc
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="E-mail recebido não encontrado.")

    def _resolve_email_drop_attachment(self, folder: Path, metadata: dict) -> dict | None:
        requested_name = normalize_text(metadata.get("nome_anexo"))
        explicit_path = normalize_text(metadata.get("caminho_anexo"))
        candidates: list[Path] = []
        if explicit_path:
            candidates.append(Path(explicit_path))
        if requested_name:
            candidates.append(folder / requested_name)
        try:
            candidates.extend(
                item
                for item in folder.iterdir()
                if item.is_file()
                and item.name not in {"metadata.json", EMAIL_INBOX_STATUS_FILE, EMAIL_INBOX_IGNORED_FLAG}
            )
        except OSError as exc:
            self.logger.warning("Não foi possível listar anexos em %s: %s", folder, exc)

        seen: set[str] = set()
        for path in candidates:
            key = str(path).lower()
            if key in seen:
                continue
            seen.add(key)
            if not path.exists() or not path.is_file():
                continue
            filename = requested_name if requested_name and path.name == requested_name else path.name
            mime_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
            return {
                "path": path,
                "nome": filename,
                "mime_type": mime_type,
                "cv_compativel": _attachment_extension(filename) in CV_ATTACHMENT_EXTENSIONS,
                "tamanho_bytes": path.stat().st_size,
            }
        return None

    def _serialize_email_drop_item(
        self,
        folder: Path,
        metadata: dict,
        status_data: dict | None = None,
        *,
        include_body: bool = False,
    ) -> dict:
        status_data = status_data or {}
        item_id = normalize_text(metadata.get("id")) or folder.name
        sender = normalize_text(metadata.get("remetente")) or "Remetente não informado"
        subject = normalize_text(metadata.get("assunto")) or "Sem assunto"
        body = normalize_text(metadata.get("corpo"))
        attachment = self._resolve_email_drop_attachment(folder, metadata)
        requested_attachment = normalize_text(metadata.get("nome_anexo"))
        data_recebimento = _parse_metadata_datetime(metadata.get("data_recebimento"))
        if not data_recebimento:
            try:
                data_recebimento = datetime.fromtimestamp((folder / "metadata.json").stat().st_mtime)
            except OSError:
                data_recebimento = None

        hidden = bool(metadata.get("oculto")) or bool(status_data.get("oculto")) or (folder / EMAIL_INBOX_IGNORED_FLAG).exists()
        status_item = normalize_text(status_data.get("status") or metadata.get("status"))
        if hidden:
            status_item = "Ignorado"
        elif not attachment:
            status_item = status_item or "Sem anexo"
        else:
            status_item = status_item or "Recebido"

        filename = normalize_text(attachment.get("nome")) if attachment else requested_attachment
        detected_email = (
            normalize_text(metadata.get("email_detectado"))
            or extract_email(body)
            or _extract_first_email(sender)
        )
        detected_phone = (
            normalize_text(metadata.get("telefone_detectado"))
            or extract_whatsapp(body)
            or extract_phone(body)
        )
        detected_name = (
            normalize_text(metadata.get("nome_detectado"))
            or self._extract_candidate_name_from_email(subject, body, filename)
        )
        detected_role = (
            normalize_text(metadata.get("vaga_detectada"))
            or self._extract_role_from_email(subject, body)
        )
        resumo = normalize_text(metadata.get("resumo_corpo")) or ((body[:420] + "...") if len(body) > 420 else body)
        received_iso = data_recebimento.isoformat() if data_recebimento else ""
        public_attachment = []
        if attachment:
            public_attachment.append(
                {
                    "nome": attachment["nome"],
                    "mime_type": attachment["mime_type"],
                    "cv_compativel": attachment["cv_compativel"],
                }
            )

        item = {
            "id": item_id,
            "uid": item_id,
            "message_id": normalize_text(metadata.get("message_id")) or item_id,
            "remetente": sender,
            "remetente_email": _extract_first_email(sender),
            "assunto": subject,
            "resumo_corpo": resumo,
            "resumo": resumo,
            "data_recebimento": received_iso,
            "data_hora": received_iso,
            "nome_detectado": detected_name,
            "nome_candidato_possivel": detected_name,
            "vaga_detectada": detected_role,
            "vaga_pretendida_possivel": detected_role,
            "telefone_detectado": detected_phone,
            "telefone_encontrado": detected_phone,
            "email_detectado": detected_email,
            "email_encontrado": detected_email,
            "possui_anexo": bool(attachment),
            "nome_anexo": filename or "Sem anexo",
            "status": status_item,
            "status_analise": status_item,
            "origem": EMAIL_INBOX_ORIGIN,
            "anexos": public_attachment,
            "oculto": hidden,
            "id_pre_analise": status_data.get("id_pre_analise"),
            "id_registro": status_data.get("id_registro"),
            "id_banco": status_data.get("id_banco"),
            "processo_vinculado": normalize_text(status_data.get("processo_vinculado")),
        }
        if include_body:
            item["corpo"] = body
        return item

    def _get_email_drop_item(self, item_id: str, *, include_body: bool = False) -> tuple[dict, dict, dict, Path]:
        folder = self._resolve_email_drop_folder(item_id)
        metadata_path = folder / "metadata.json"
        if not metadata_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="metadata.json não encontrado para este e-mail.")
        metadata = self._read_email_drop_metadata(metadata_path)
        if metadata is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="metadata.json inválido para este e-mail.")
        status_data = self._read_email_drop_status(folder)
        item = self._serialize_email_drop_item(folder, metadata, status_data, include_body=include_body)
        return item, metadata, status_data, folder

    def _list_file_drop_email_inbox(self, limit: int = 50, include_ignored: bool = False) -> dict:
        root = self._email_inbox_path()
        if not root:
            return self._inbox_unavailable_payload(EMAIL_INBOX_UNCONFIGURED_MESSAGE)
        if not root.exists() or not root.is_dir():
            return self._inbox_unavailable_payload(EMAIL_INBOX_UNCONFIGURED_MESSAGE)

        items = []
        try:
            folders = [item for item in root.iterdir() if item.is_dir()]
        except OSError as exc:
            self.logger.exception("Falha ao listar pasta de e-mails recebidos: %s", exc)
            return self._inbox_unavailable_payload(EMAIL_INBOX_UNCONFIGURED_MESSAGE)

        for folder in folders:
            metadata_path = folder / "metadata.json"
            if not metadata_path.exists():
                self.logger.info("Pasta de e-mail ignorada sem metadata.json: %s", folder)
                continue
            metadata = self._read_email_drop_metadata(metadata_path)
            if metadata is None:
                continue
            status_data = self._read_email_drop_status(folder)
            item = self._serialize_email_drop_item(folder, metadata, status_data)
            if item.get("oculto") and not include_ignored:
                continue
            items.append(item)

        items.sort(key=lambda item: normalize_text(item.get("data_recebimento")), reverse=True)
        safe_limit = self._clamp_limit(limit, default=50, maximum=200)
        return {
            "success": True,
            "enabled": True,
            "configured": True,
            "mode": EMAIL_INBOX_FILE_DROP_MODE,
            "inbox_path": str(root),
            "email_address": normalize_text(getattr(self.settings, "email_inbox_address", "")),
            "message": "",
            "items": items[:safe_limit],
        }

    def list_email_inbox(self, limit: int = 50, include_ignored: bool = False) -> dict:
        if not getattr(self.settings, "email_inbox_enabled", False):
            return self._inbox_unavailable_payload(EMAIL_INBOX_UNCONFIGURED_MESSAGE)
        if not self._uses_file_drop_inbox():
            return self._inbox_unavailable_payload(EMAIL_INBOX_UNCONFIGURED_MESSAGE)
        return self._list_file_drop_email_inbox(limit=limit, include_ignored=include_ignored)

    def get_email_inbox_item(self, item_id: str) -> dict:
        item, _metadata, _status_data, _folder = self._get_email_drop_item(item_id, include_body=True)
        return {"success": True, "item": item}

    def _read_email_drop_attachment_content(self, folder: Path, metadata: dict) -> tuple[str, str, bytes, Path]:
        attachment = self._resolve_email_drop_attachment(folder, metadata)
        if not attachment:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este e-mail não possui anexo de currículo.")
        filename = normalize_text(attachment.get("nome"))
        if _attachment_extension(filename) not in CV_ATTACHMENT_EXTENSIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato de currículo não suportado. Use PDF, DOC ou DOCX.")
        path = attachment["path"]
        try:
            content = path.read_bytes()
        except OSError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anexo de currículo não encontrado.") from exc
        return filename, normalize_text(attachment.get("mime_type")) or "application/octet-stream", content, path

    def _save_email_drop_attachment_link(
        self,
        cursor,
        *,
        id_teste: str,
        processo: dict | None,
        filename: str,
        mime_type: str,
        path: Path,
    ) -> None:
        ensure_candidate_attachments_table(cursor)
        process_id = normalize_text((processo or {}).get("id_processo"))
        process_ref = normalize_text((processo or {}).get("id_processo_ref"))
        cursor.execute(
            """
            DELETE FROM candidatos_anexos
            WHERE id_teste = ? AND id_processo = ? AND id_processo_ref = ?
            """,
            (id_teste, process_id, process_ref),
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
                tamanho_bytes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                id_teste,
                process_id,
                process_ref,
                filename,
                filename,
                mime_type,
                str(path),
                path.stat().st_size if path.exists() else 0,
            ),
        )

    def _load_email_pre_analysis_row(self, cursor, id_pre_analise: int) -> dict | None:
        if not id_pre_analise:
            return None
        cursor.execute(
            """
            SELECT TOP 1
                id_pre_analise,
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

    def analyze_email_inbox_cv(self, item_id: str) -> dict:
        item, metadata, status_data, folder = self._get_email_drop_item(item_id, include_body=True)
        filename, mime_type, content, attachment_path = self._read_email_drop_attachment_content(folder, metadata)
        subject = normalize_text(item.get("assunto"))
        sender = normalize_text(item.get("remetente"))

        try:
            extracted = extract_text_from_uploaded_file(filename, content, mime_type)
        except CvTextExtractionError as exc:
            try:
                self._write_email_drop_status(folder, {"status": "Erro na análise"})
            except OSError:
                self.logger.warning("Não foi possível atualizar status do e-mail %s após erro de análise.", item_id)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.user_message) from exc

        normalized_text = normalize_cv_text(extracted)
        if not normalized_text:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo vazio ou corrompido.")

        name_details = extract_candidate_name_details(
            normalized_text,
            fallback_name=normalize_text(item.get("nome_detectado")),
            filename=filename,
        )
        candidate_name = name_details.get("nome") or normalize_text(item.get("nome_detectado"))
        email = extract_email(normalized_text) or normalize_text(item.get("email_detectado"))
        phone = extract_phone(normalized_text) or normalize_text(item.get("telefone_detectado"))
        whatsapp = extract_whatsapp(normalized_text) or phone
        phone_base = whatsapp or phone
        keywords = extract_keywords(normalized_text)
        competencies = extract_competencies(normalized_text)
        experiences = extract_professional_experiences(normalized_text)
        role = normalize_text(item.get("vaga_detectada"))
        evaluation = score_cv_for_role(
            role,
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
            ensure_cv_pre_analises_table(cursor)
            ensure_candidate_attachments_table(cursor)
            existing_id = int(status_data.get("id_pre_analise") or 0)
            if not existing_id and email:
                cursor.execute(
                    """
                    SELECT TOP 1 id_pre_analise
                    FROM cv_pre_analises
                    WHERE origem = ?
                      AND LOWER(LTRIM(RTRIM(ISNULL(email, '')))) = LOWER(?)
                    ORDER BY id_pre_analise DESC
                    """,
                    (EMAIL_INBOX_ORIGIN, email),
                )
                existing = cursor.fetchone()
                existing_id = int(existing[0]) if existing else 0

            if existing_id:
                self._write_email_drop_status(folder, {"status": "Analisado", "id_pre_analise": existing_id})
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
                    item.get("id"),
                    item.get("message_id"),
                    filename,
                    sender,
                    subject,
                    _parse_metadata_datetime(metadata.get("data_recebimento")),
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
            )
            self._save_email_drop_attachment_link(
                cursor,
                id_teste=id_teste,
                processo=None,
                filename=filename,
                mime_type=mime_type,
                path=attachment_path,
            )
            conn.commit()
            self._write_email_drop_status(
                folder,
                {
                    "status": "Analisado",
                    "id_pre_analise": id_pre_analise,
                    "score": evaluation["score"],
                    "classificacao": evaluation["classificacao"],
                },
            )
            return {
                "success": True,
                "duplicate": False,
                "id_pre_analise": id_pre_analise,
                "classificacao": evaluation["classificacao"],
                "score": evaluation["score"],
            }
        finally:
            conn.close()

    def link_email_inbox_to_process(self, item_id: str, data: dict) -> dict:
        item, metadata, status_data, folder = self._get_email_drop_item(item_id, include_body=True)
        process_ref = normalize_text(data.get("id_processo_ref") or data.get("id_processo"))
        if not process_ref:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Processo de destino não informado.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            ensure_candidate_attachments_table(cursor)
            processo = get_process_row(cursor, process_ref)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo de destino não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este processo está encerrado e não aceita novos candidatos.")

            pre_analysis = self._load_email_pre_analysis_row(cursor, int(status_data.get("id_pre_analise") or 0))
            candidate_name = normalize_text((pre_analysis or {}).get("nome_candidato")) or normalize_text(item.get("nome_detectado")) or "Candidato recebido por e-mail"
            email = normalize_text((pre_analysis or {}).get("email")) or normalize_text(item.get("email_detectado"))
            phone = normalize_text((pre_analysis or {}).get("telefone")) or normalize_text(item.get("telefone_detectado"))
            whatsapp = normalize_text((pre_analysis or {}).get("whatsapp")) or phone
            id_teste = f"CV-{pre_analysis.get('id_pre_analise')}" if pre_analysis else _email_candidate_id(item.get("id"))

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
                    "vaga": processo.get("vaga") or normalize_text(item.get("vaga_detectada")),
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
            )
            try:
                filename, mime_type, _content, attachment_path = self._read_email_drop_attachment_content(folder, metadata)
                self._save_email_drop_attachment_link(
                    cursor,
                    id_teste=id_teste,
                    processo=processo,
                    filename=filename,
                    mime_type=mime_type,
                    path=attachment_path,
                )
            except HTTPException as exc:
                self.logger.debug("Anexo de e-mail nao disponivel para vincular ao teste %s: %s", id_teste, exc.detail)
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
                observacao=f"Remetente: {item.get('remetente')}; assunto: {item.get('assunto')}",
            )
            if pre_analysis:
                cursor.execute(
                    """
                    UPDATE cv_pre_analises
                    SET ja_adicionado_ao_processo = 1,
                        id_processo = ?,
                        id_processo_ref = ?
                    WHERE id_pre_analise = ?
                    """,
                    (
                        processo.get("id_processo"),
                        processo.get("id_processo_ref", ""),
                        int(pre_analysis.get("id_pre_analise")),
                    ),
                )
            conn.commit()
            self._write_email_drop_status(
                folder,
                {
                    "status": "Vinculado ao processo",
                    "id_registro": id_registro,
                    "processo_vinculado": processo.get("id_processo_ref") or processo.get("id_processo"),
                },
            )
            return {"success": True, "id_registro": id_registro}
        finally:
            conn.close()

    def send_email_inbox_to_talent_bank(self, item_id: str) -> dict:
        item, metadata, status_data, folder = self._get_email_drop_item(item_id, include_body=True)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_candidate_attachments_table(cursor)
            pre_analysis = self._load_email_pre_analysis_row(cursor, int(status_data.get("id_pre_analise") or 0))
        finally:
            conn.close()

        candidate_name = normalize_text((pre_analysis or {}).get("nome_candidato")) or normalize_text(item.get("nome_detectado")) or "Candidato recebido por e-mail"
        email = normalize_text((pre_analysis or {}).get("email")) or normalize_text(item.get("email_detectado"))
        phone = normalize_text((pre_analysis or {}).get("telefone")) or normalize_text(item.get("telefone_detectado"))
        whatsapp = normalize_text((pre_analysis or {}).get("whatsapp")) or phone
        id_teste = f"CV-{pre_analysis.get('id_pre_analise')}" if pre_analysis else _email_candidate_id(item.get("id"))
        result = self.add_candidate_to_talent_bank(
            {
                "id_teste": id_teste,
                "id_processo": "",
                "id_processo_ref": "",
                "nome_candidato": candidate_name,
                "vaga": normalize_text(item.get("vaga_detectada")) or "Banco de Talentos",
                "pontuacao_final": str((pre_analysis or {}).get("score_final") or "").replace(".", ","),
                "data_movimentacao": datetime.now().isoformat(),
                "origem": EMAIL_INBOX_ORIGIN,
                "email": email,
                "telefone": phone,
                "whatsapp": whatsapp,
            }
        )
        try:
            filename, mime_type, _content, attachment_path = self._read_email_drop_attachment_content(folder, metadata)
            conn = self._connect()
            try:
                cursor = conn.cursor()
                self._save_email_drop_attachment_link(
                    cursor,
                    id_teste=id_teste,
                    processo=None,
                    filename=filename,
                    mime_type=mime_type,
                    path=attachment_path,
                )
                conn.commit()
            finally:
                conn.close()
        except HTTPException as exc:
            self.logger.debug("Anexo de e-mail nao disponivel para vincular ao banco de talentos %s: %s", id_teste, exc.detail)
        self._write_email_drop_status(
            folder,
            {
                "status": "Enviado ao Banco de Talentos",
                "id_banco": result.get("id_banco"),
            },
        )
        return result

    def ignore_email_inbox_item(self, item_id: str) -> dict:
        _item, _metadata, _status_data, folder = self._get_email_drop_item(item_id, include_body=False)
        try:
            (folder / EMAIL_INBOX_IGNORED_FLAG).write_text(datetime.now().isoformat(), encoding="utf-8")
            self._write_email_drop_status(folder, {"status": "Ignorado", "oculto": True})
        except OSError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Não foi possível marcar este e-mail como ignorado.") from exc
        return {"success": True}

    def list_process_email_inbox(self, id_processo: str, limit: int = 12) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
        finally:
            conn.close()

        if self._uses_file_drop_inbox():
            return self.list_email_inbox(limit=limit)

        if not getattr(self.settings, "email_inbox_enabled", False):
            return self._inbox_unavailable_payload()

        if self._uses_graph_inbox():
            try:
                return self._list_graph_email_inbox(limit)
            except HTTPException as exc:
                return self._inbox_unavailable_payload(normalize_text(exc.detail))
            except Exception as exc:
                self.logger.exception("Falha ao consultar e-mails pelo Microsoft Graph: %s", exc)
                return self._inbox_unavailable_payload(
                    "Não foi possível consultar o Microsoft Graph agora.",
                )

        try:
            mailbox = self._open_inbox(readonly=True)
        except HTTPException as exc:
            return self._inbox_unavailable_payload(normalize_text(exc.detail))
        except Exception as exc:
            self.logger.exception("Falha ao conectar na caixa de e-mail: %s", exc)
            return self._inbox_unavailable_payload(
                "Não foi possível conectar à caixa de e-mail. Verifique credenciais e permissão IMAP.",
            )

        try:
            typ, data = mailbox.uid("search", None, "ALL")
            if typ != "OK":
                return self._inbox_unavailable_payload("Não foi possível pesquisar mensagens na caixa de entrada.")
            uids = (data[0] or b"").split()
            selected = list(reversed(uids[-self._clamp_limit(limit, default=12, maximum=30):]))
            items = []
            for raw_uid in selected:
                uid = raw_uid.decode("ascii", errors="ignore")
                typ, fetched = mailbox.uid("fetch", uid, "(RFC822)")
                if typ != "OK":
                    continue
                for item in fetched:
                    if isinstance(item, tuple) and item[1]:
                        message = BytesParser(policy=policy.default).parsebytes(item[1])
                        items.append(self._serialize_email_message(uid, message))
                        break
            return {
                "success": True,
                "enabled": True,
                "configured": True,
                "email_address": normalize_text(getattr(self.settings, "email_inbox_address", "")),
                "message": "",
                "items": items,
            }
        except Exception as exc:
            self.logger.exception("Falha ao listar e-mails recebidos: %s", exc)
            return self._inbox_unavailable_payload(
                "Não foi possível listar os e-mails recebidos agora.",
            )
        finally:
            try:
                mailbox.logout()
            except Exception as exc:
                self.logger.debug("Falha ao encerrar sessao IMAP: %s", exc)

    def _find_cv_attachment(self, message, requested_name: str = "") -> tuple[str, str, bytes]:
        requested = normalize_compare_text(requested_name)
        fallback = None
        for part in message.iter_attachments():
            filename = _decode_header_value(part.get_filename())
            if not filename:
                continue
            extension = _attachment_extension(filename)
            if extension not in CV_ATTACHMENT_EXTENSIONS:
                continue
            content = part.get_payload(decode=True) or b""
            if requested and normalize_compare_text(filename) == requested:
                return filename, normalize_text(part.get_content_type()), content
            if fallback is None:
                fallback = (filename, normalize_text(part.get_content_type()), content)

        if fallback:
            return fallback
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sem anexo de CV compatível neste e-mail.")

    def analyze_email_cv_attachment(self, id_processo: str, data: dict) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("analisar CV recebido por e-mail", processo.get("id_processo")),
                )

            uid = normalize_text(data.get("uid"))
            attachment_name = normalize_text(data.get("attachment_name"))
            if self._uses_graph_inbox():
                graph_message, filename, mime_type, content = self._fetch_graph_message_and_cv_attachment(
                    uid,
                    attachment_name,
                )
                subject = normalize_text(graph_message.get("subject"))
                sender, _sender_email = self._graph_sender(graph_message)
                body = self._graph_message_body(graph_message)
                source_message_id = normalize_text(graph_message.get("internetMessageId")) or self._strip_graph_uid(uid)
                source_email_date = self._graph_datetime(graph_message.get("receivedDateTime"))
            else:
                message = self._fetch_email_message(uid)
                subject = _decode_header_value(message.get("subject"))
                sender = _decode_header_value(message.get("from"))
                body = self._message_plain_text(message)
                filename, mime_type, content = self._find_cv_attachment(message, attachment_name)
                source_message_id = normalize_text(message.get("message-id"))
                source_email_date = self._message_date(message)
            try:
                extracted = extract_text_from_uploaded_file(filename, content, mime_type)
            except CvTextExtractionError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.user_message) from exc

            normalized_text = normalize_cv_text(extracted)
            if not normalized_text:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo vazio ou corrompido.")

            name_details = extract_candidate_name_details(
                normalized_text,
                fallback_name=self._extract_candidate_name_from_email(subject, body, filename),
                filename=filename,
            )
            candidate_name = name_details.get("nome") or self._extract_candidate_name_from_email(subject, body, filename)
            email = extract_email(normalized_text) or extract_email(body) or _extract_first_email(sender)
            phone = extract_phone(normalized_text) or extract_phone(body)
            whatsapp = extract_whatsapp(normalized_text) or extract_whatsapp(body)
            phone_base = whatsapp or phone
            keywords = extract_keywords(normalized_text)
            competencies = extract_competencies(normalized_text)
            experiences = extract_professional_experiences(normalized_text)
            evaluation = score_cv_for_role(
                processo.get("vaga"),
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

            if email:
                cursor.execute(
                    """
                    SELECT TOP 1 id_pre_analise
                    FROM cv_pre_analises
                    WHERE id_processo = ?
                      AND id_processo_ref = ?
                      AND LOWER(LTRIM(RTRIM(ISNULL(email, '')))) = LOWER(?)
                    ORDER BY id_pre_analise DESC
                    """,
                    (processo.get("id_processo"), processo.get("id_processo_ref", ""), email),
                )
                existing = cursor.fetchone()
                if existing:
                    cursor.execute(
                        """
                        UPDATE cv_pre_analises
                        SET oculto_na_lista = 0
                        WHERE id_pre_analise = ?
                        """,
                        (int(existing[0]),),
                    )
                    conn.commit()
                    return {
                        "success": True,
                        "duplicate": True,
                        "id_pre_analise": int(existing[0]),
                        "message": "CV recebido por e-mail já existia na pré-análise deste processo.",
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
                    processo.get("id_processo"),
                    processo.get("id_processo_ref", ""),
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
                    mime_type or "application/octet-stream",
                    base64.b64encode(content).decode("utf-8"),
                    "Recebimento de e-mail",
                    uid,
                    source_message_id,
                    filename,
                    sender,
                    subject,
                    source_email_date,
                ),
            )
            id_pre_analise = int(cursor.fetchone()[0])

            status_candidato = map_cv_classification_to_status(evaluation["classificacao"])
            if status_candidato == CANDIDATE_STATUS_QUALIFIED:
                existing_candidate = self._find_process_candidate_by_identity(
                    cursor,
                    processo,
                    id_teste=f"CV-{id_pre_analise}",
                    email=email,
                    telefone=phone,
                    whatsapp=whatsapp,
                )
                if not existing_candidate:
                    insert_candidate_process_record(
                        cursor,
                        processo,
                        {
                            "id_teste": f"CV-{id_pre_analise}",
                            "nome_candidato": candidate_name,
                            "vaga": processo.get("vaga") or "",
                            "status_candidato": status_candidato,
                            "pontuacao_final": str(evaluation["score"]).replace(".", ","),
                            "data_prova": datetime.now().isoformat(),
                            "origem": "Recebimento de e-mail",
                            "etapa_pipeline": "Prova",
                            "data_atualizacao_pipeline": datetime.now(),
                        },
                    )
                cursor.execute(
                    """
                    UPDATE cv_pre_analises
                    SET ja_adicionado_ao_processo = 1
                    WHERE id_pre_analise = ?
                    """,
                    (id_pre_analise,),
                )

            self._upsert_candidate_profile(
                cursor,
                id_teste=f"CV-{id_pre_analise}",
                nome_candidato=candidate_name,
                email=email,
                telefone=phone,
                whatsapp=whatsapp,
            )
            self._record_candidate_movement(
                cursor,
                id_teste=f"CV-{id_pre_analise}",
                id_processo=processo.get("id_processo"),
                id_processo_ref=processo.get("id_processo_ref", ""),
                nome_candidato=candidate_name,
                vaga=processo.get("vaga") or "",
                origem_inicial="Recebimento de e-mail",
                tipo_movimentacao="CV analisado a partir de e-mail recebido",
                status_novo=status_candidato,
                observacao=f"Remetente: {sender}; assunto: {subject}",
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

    def _load_process_candidate_for_message(self, cursor, id_registro: int) -> dict:
        cursor.execute(
            """
            SELECT TOP 1
                cp.id_registro,
                cp.id_processo,
                cp.id_processo_ref,
                cp.id_teste,
                cp.nome_candidato,
                cp.vaga,
                cp.status_candidato,
                cp.origem,
                meta.email,
                meta.telefone,
                meta.whatsapp
            FROM candidatos_processos cp
            LEFT JOIN candidatos_metadata meta
                ON meta.id_teste = cp.id_teste
            WHERE cp.id_registro = ?
            """,
            (int(id_registro or 0),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado.")
        return rows[0]

    def record_candidate_approval_whatsapp(
        self,
        id_registro: int,
        data: dict,
        *,
        usuario_responsavel: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            row = self._load_process_candidate_for_message(cursor, id_registro)
            self._record_candidate_movement(
                cursor,
                id_teste=row.get("id_teste"),
                id_registro=row.get("id_registro"),
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref"),
                nome_candidato=row.get("nome_candidato"),
                vaga=row.get("vaga"),
                origem_inicial=row.get("origem"),
                tipo_movimentacao="Mensagem de aprovação enviada por WhatsApp",
                status_anterior=row.get("status_candidato"),
                status_novo=row.get("status_candidato"),
                observacao=normalize_text(data.get("mensagem_aprovacao")),
                usuario_responsavel=usuario_responsavel,
            )
            cursor.execute(
                """
                UPDATE candidatos_processos
                SET mensagem_aprovacao_enviada_whatsapp_em = GETDATE()
                WHERE id_registro = ?
                """,
                (int(id_registro),),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def record_candidate_whatsapp_contact(
        self,
        id_registro: int,
        data: dict,
        *,
        usuario_responsavel: str = "",
    ) -> dict:
        tipo_map = {
            "contato_enviado": "Contato enviado",
            "respondeu": "Respondeu",
            "confirmou_entrevista": "Confirmou entrevista",
            "cancelou_entrevista": "Cancelou entrevista",
            "solicitou_reagendamento": "Solicitou reagendamento",
            "observacao_livre": "Observação livre",
        }
        tipo = normalize_text(data.get("tipo_contato")) or "contato_enviado"
        rotulo_tipo = tipo_map.get(tipo, tipo_map["contato_enviado"])
        observacao = normalize_text(data.get("observacao"))
        mensagem = normalize_text(data.get("mensagem"))
        partes_observacao = [f"Registro manual: {rotulo_tipo}"]
        if observacao:
            partes_observacao.append(f"Observação: {observacao}")
        if mensagem:
            partes_observacao.append(f"Mensagem: {mensagem}")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            row = self._load_process_candidate_for_message(cursor, id_registro)
            self._record_candidate_movement(
                cursor,
                id_teste=row.get("id_teste"),
                id_registro=row.get("id_registro"),
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref"),
                nome_candidato=row.get("nome_candidato"),
                vaga=row.get("vaga"),
                origem_inicial=row.get("origem"),
                tipo_movimentacao=f"WhatsApp - {rotulo_tipo}",
                status_anterior=row.get("status_candidato"),
                status_novo=row.get("status_candidato"),
                observacao="; ".join(partes_observacao),
                usuario_responsavel=usuario_responsavel,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def send_candidate_approval_email(
        self,
        id_registro: int,
        data: dict,
        *,
        usuario_responsavel: str = "",
    ) -> dict:
        if not getattr(self.settings, "email_smtp_enabled", False):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Envio de e-mail ainda não configurado. Configure EMAIL_SMTP/RH_EMAIL_SMTP_* no backend.",
            )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_pipeline_columns(cursor)
            row = self._load_process_candidate_for_message(cursor, id_registro)
            recipient = normalize_text(row.get("email"))
            if not recipient:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidato sem e-mail cadastrado.")

            host = normalize_text(getattr(self.settings, "email_smtp_host", "")) or "smtp.gmail.com"
            use_ssl = bool(getattr(self.settings, "email_smtp_use_ssl", False))
            port = int(getattr(self.settings, "email_smtp_port", 465 if use_ssl else 587) or (465 if use_ssl else 587))
            username = (
                normalize_text(getattr(self.settings, "email_smtp_username", ""))
                or normalize_text(getattr(self.settings, "email_inbox_username", ""))
                or normalize_text(getattr(self.settings, "email_inbox_address", ""))
            )
            password = self._get_smtp_password()
            sender = normalize_text(getattr(self.settings, "email_smtp_from", "")) or username
            if not host or not sender:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Envio de e-mail ainda não configurado. Informe host e remetente SMTP.",
                )
            if username and not password:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Envio de e-mail ainda não configurado. Variável de senha SMTP não definida.",
                )

            message = EmailMessage()
            message["From"] = sender
            message["To"] = recipient
            message["Subject"] = normalize_text(data.get("assunto")) or "Aprovação no processo seletivo"
            message.set_content(normalize_text(data.get("mensagem_aprovacao")))

            attachment_name = normalize_text(data.get("anexo_aprovacao_nome"))
            attachment_payload = normalize_text(data.get("anexo_aprovacao_base64"))
            if attachment_name and attachment_payload:
                content = base64.b64decode(attachment_payload)
                maintype, subtype = ("application", "octet-stream")
                mime_type = normalize_text(data.get("anexo_aprovacao_tipo"))
                if "/" in mime_type:
                    maintype, subtype = mime_type.split("/", 1)
                message.add_attachment(content, maintype=maintype, subtype=subtype, filename=attachment_name)

            if use_ssl:
                smtp_client = smtplib.SMTP_SSL(host, port, timeout=20)
            else:
                smtp_client = smtplib.SMTP(host, port, timeout=20)
            try:
                if not use_ssl and bool(getattr(self.settings, "email_smtp_use_tls", True)):
                    smtp_client.starttls()
                if username:
                    smtp_client.login(username, password)
                smtp_client.send_message(message)
            finally:
                smtp_client.quit()

            self._record_candidate_movement(
                cursor,
                id_teste=row.get("id_teste"),
                id_registro=row.get("id_registro"),
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref"),
                nome_candidato=row.get("nome_candidato"),
                vaga=row.get("vaga"),
                origem_inicial=row.get("origem"),
                tipo_movimentacao="Mensagem de aprovação enviada por e-mail",
                status_anterior=row.get("status_candidato"),
                status_novo=row.get("status_candidato"),
                observacao=normalize_text(data.get("mensagem_aprovacao")),
                usuario_responsavel=usuario_responsavel,
            )
            cursor.execute(
                """
                UPDATE candidatos_processos
                SET mensagem_aprovacao_enviada_email_em = GETDATE()
                WHERE id_registro = ?
                """,
                (int(id_registro),),
            )
            conn.commit()
            return {"success": True, "message": "E-mail de aprovação enviado."}
        finally:
            conn.close()

    def send_internal_alert_email(
        self,
        *,
        destinatarios: list[str],
        assunto: str,
        mensagem: str,
    ) -> dict:
        """Envio de e-mail de alerta interno para o RH (não para candidatos).

        Reaproveita a mesma configuração SMTP de `send_candidate_approval_email`,
        mas envia texto simples para uma lista de destinatários internos (ex.:
        lembretes/alertas automáticos de processos parados). Levanta
        HTTPException 503 se o SMTP ainda não estiver configurado, para que o
        chamador (job agendado) trate isso como "automação indisponível" sem
        derrubar o restante do backend.
        """
        if not getattr(self.settings, "email_smtp_enabled", False):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Envio de e-mail ainda não configurado. Configure EMAIL_SMTP/RH_EMAIL_SMTP_* no backend.",
            )

        recipients = [normalize_text(item) for item in (destinatarios or []) if normalize_text(item)]
        if not recipients:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nenhum destinatário configurado para o alerta.",
            )

        host = normalize_text(getattr(self.settings, "email_smtp_host", "")) or "smtp.gmail.com"
        use_ssl = bool(getattr(self.settings, "email_smtp_use_ssl", False))
        port = int(getattr(self.settings, "email_smtp_port", 465 if use_ssl else 587) or (465 if use_ssl else 587))
        username = (
            normalize_text(getattr(self.settings, "email_smtp_username", ""))
            or normalize_text(getattr(self.settings, "email_inbox_username", ""))
            or normalize_text(getattr(self.settings, "email_inbox_address", ""))
        )
        password = self._get_smtp_password()
        sender = normalize_text(getattr(self.settings, "email_smtp_from", "")) or username
        if not host or not sender:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Envio de e-mail ainda não configurado. Informe host e remetente SMTP.",
            )
        if username and not password:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Envio de e-mail ainda não configurado. Variável de senha SMTP não definida.",
            )

        message = EmailMessage()
        message["From"] = sender
        message["To"] = ", ".join(recipients)
        message["Subject"] = normalize_text(assunto) or "Alerta automático - Conecta"
        message.set_content(normalize_text(mensagem))

        if use_ssl:
            smtp_client = smtplib.SMTP_SSL(host, port, timeout=20)
        else:
            smtp_client = smtplib.SMTP(host, port, timeout=20)
        try:
            if not use_ssl and bool(getattr(self.settings, "email_smtp_use_tls", True)):
                smtp_client.starttls()
            if username:
                smtp_client.login(username, password)
            smtp_client.send_message(message)
        finally:
            smtp_client.quit()

        return {"success": True, "destinatarios": recipients}

    def get_notification_automation_settings(self) -> dict:
        """Estado atual do interruptor de automação de e-mail por etapa
        (roadmap: e-mails automáticos por etapa). Default: desligado."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notification_automation_table(cursor)
            cursor.execute(
                """
                SELECT TOP 1 email_automatico_ativo, lembretes_automaticos_ativos, atualizado_por, atualizado_em
                FROM dbo.configuracoes_notificacoes_automaticas
                ORDER BY id_configuracao DESC
                """
            )
            row = cursor.fetchone()
            if not row:
                return {
                    "email_automatico_ativo": False,
                    "lembretes_automaticos_ativos": False,
                    "atualizado_por": "",
                    "atualizado_em": None,
                }
            return {
                "email_automatico_ativo": bool(row[0]),
                "lembretes_automaticos_ativos": bool(row[1]),
                "atualizado_por": normalize_text(row[2]),
                "atualizado_em": row[3],
            }
        finally:
            conn.close()

    def update_notification_automation_settings(self, data: dict, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notification_automation_table(cursor)
            ativo = bool(data.get("email_automatico_ativo"))
            lembretes_ativos = bool(data.get("lembretes_automaticos_ativos"))
            cursor.execute("SELECT COUNT(*) FROM dbo.configuracoes_notificacoes_automaticas")
            existe = int((cursor.fetchone() or [0])[0] or 0)
            if existe:
                cursor.execute(
                    """
                    UPDATE dbo.configuracoes_notificacoes_automaticas
                    SET email_automatico_ativo = ?, lembretes_automaticos_ativos = ?,
                        atualizado_por = ?, atualizado_em = GETDATE()
                    """,
                    (1 if ativo else 0, 1 if lembretes_ativos else 0, normalize_text(actor)),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO dbo.configuracoes_notificacoes_automaticas
                        (email_automatico_ativo, lembretes_automaticos_ativos, atualizado_por, atualizado_em)
                    VALUES (?, ?, ?, GETDATE())
                    """,
                    (1 if ativo else 0, 1 if lembretes_ativos else 0, normalize_text(actor)),
                )
            conn.commit()
            return {
                "success": True,
                "email_automatico_ativo": ativo,
                "lembretes_automaticos_ativos": lembretes_ativos,
            }
        finally:
            conn.close()

    def disparar_notificacao_por_etapa(
        self,
        *,
        candidato: dict,
        status_anterior: str,
        status_novo: str,
        payload: dict,
        usuario_responsavel: str = "",
    ) -> None:
        """Ponto único de automação de notificação por mudança de etapa/status
        do candidato (roadmap: "e-mails automáticos por etapa").

        Hoje dispara somente e-mail, reaproveitando o mesmo mecanismo/texto do
        envio manual (`send_candidate_approval_email` / rota approval-email).
        Preparado para, quando o WhatsApp automático for aprovado pelo RH,
        também disparar a partir deste mesmo ponto (reaproveitando
        `record_candidate_approval_whatsapp` / rota approval-whatsapp) sem
        precisar alterar novamente o fluxo de mudança de status.

        Nunca deve derrubar a mudança de status em si: qualquer falha aqui é
        registrada em log e engolida.
        """
        if not transicao_elegivel_para_email_automatico(status_novo):
            return

        try:
            settings_automacao = self.get_notification_automation_settings()
        except Exception:
            self.logger.warning(
                "Não foi possível checar a configuração de automação de notificações; e-mail automático não disparado.",
                exc_info=True,
            )
            return

        if not settings_automacao.get("email_automatico_ativo"):
            return

        mensagem_aprovacao = normalize_text(payload.get("mensagem_aprovacao"))
        if not mensagem_aprovacao:
            # RH não preparou o texto de aprovação junto da mudança de status
            # (campo obrigatório no fluxo manual) - não há o que enviar.
            return

        id_registro = candidato.get("id_registro")
        vaga = normalize_text(candidato.get("vaga"))
        try:
            self.send_candidate_approval_email(
                id_registro,
                {
                    "mensagem_aprovacao": mensagem_aprovacao,
                    "anexo_aprovacao_nome": payload.get("anexo_aprovacao_nome", ""),
                    "anexo_aprovacao_tipo": payload.get("anexo_aprovacao_tipo", ""),
                    "anexo_aprovacao_base64": payload.get("anexo_aprovacao_base64", ""),
                    "assunto": f"Aprovação no processo seletivo - {vaga}".strip(" -"),
                },
                usuario_responsavel=usuario_responsavel or "Automação Conecta",
            )
            self.logger.info(
                "E-mail automático de etapa disparado (id_registro=%s, %s -> %s).",
                id_registro,
                status_anterior,
                status_novo,
            )
            try:
                self.record_audit_log(
                    user={"nome": "Automação Conecta", "email": "", "perfil_nome": "Automação"},
                    modulo="E-mails",
                    acao="enviar_email_aprovacao_automatico",
                    entidade="candidato_processo",
                    entidade_id=str(id_registro or ""),
                    valor_anterior={"status": status_anterior},
                    valor_novo={"status": status_novo, "disparo": "automatico"},
                    justificativa="Envio automático disparado pela mudança de status (automação de e-mail por etapa ativada pelo RH).",
                    origem="automacao",
                )
            except Exception:
                self.logger.warning(
                    "Não foi possível registrar auditoria do e-mail automático (id_registro=%s).",
                    id_registro,
                    exc_info=True,
                )
        except HTTPException as exc:
            self.logger.warning(
                "Falha ao disparar e-mail automático de etapa (id_registro=%s): %s",
                id_registro,
                getattr(exc, "detail", exc),
            )
        except Exception:
            self.logger.exception(
                "Erro inesperado ao disparar e-mail automático de etapa (id_registro=%s).",
                id_registro,
            )

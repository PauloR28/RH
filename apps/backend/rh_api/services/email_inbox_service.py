from __future__ import annotations

import hashlib
import html
import imaplib
import json
import logging
import mimetypes
import os
import re
from datetime import datetime
from email import policy
from email.header import decode_header
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path

from ..config import Settings
from .cv import extract_candidate_name, extract_email, extract_phone, extract_whatsapp
from .helpers import clamp_limit, normalize_compare_text, normalize_text


logger = logging.getLogger(__name__)

EMAIL_INBOX_ORIGIN = "Recebimento de e-mail"
MANUAL_UPLOAD_ORIGIN = "Upload manual"
EMAIL_INBOX_NOT_CONFIGURED_MESSAGE = (
    "Caixa de e-mail corporativa ainda não configurada. Informe TENANT_ID, CLIENT_ID e CLIENT_SECRET no servidor."
)
EMAIL_INBOX_CONNECTION_ERROR_MESSAGE = (
    "Não foi possível conectar à caixa de e-mail. Verifique as configurações do servidor."
)
ALLOWED_CV_EXTENSIONS = {".pdf", ".doc", ".docx"}
BLOCKED_ATTACHMENT_EXTENSIONS = {
    ".bat",
    ".cmd",
    ".exe",
    ".gif",
    ".htm",
    ".html",
    ".jpeg",
    ".jpg",
    ".js",
    ".png",
    ".rar",
    ".svg",
    ".zip",
}

APPLICATION_FORM_LABELS = {
    "nome": ("nome", "nome completo"),
    "endereco": ("endereco", "endereço"),
    "email": ("e-mail", "email"),
    "telefone": ("telefone", "whatsapp", "celular"),
    "escolaridade": ("escolaridade",),
    "experiencia": ("experiencia", "experiência", "possui experiencia", "possui experiência"),
    "musica": ("musica", "música"),
    "prato": ("prato",),
    "futebol": ("futebol",),
    "time": ("time",),
    "rede_social": ("rede social", "redes sociais", "linkedin", "instagram"),
    "curriculo_anexado": ("curriculo anexado", "currículo anexado", "curriculo", "currículo"),
}
APPLICATION_REQUIRED_LABELS = {"nome", "email", "telefone", "escolaridade"}


class EmailInboxUnavailable(Exception):
    def __init__(self, message: str, *, configured: bool = False):
        super().__init__(message)
        self.message = message
        self.configured = configured


def _decode_header_value(value: str | None) -> str:
    parts = []
    for raw, charset in decode_header(value or ""):
        if isinstance(raw, bytes):
            parts.append(raw.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(raw)
    return normalize_text("".join(parts))


def _first_email(value: str) -> str:
    for _name, address in getaddresses([value or ""]):
        safe_address = normalize_text(address)
        if safe_address:
            return safe_address
    return extract_email(value)


def _first_sender_name(value: str) -> str:
    for name, _address in getaddresses([value or ""]):
        safe_name = normalize_text(name)
        if safe_name:
            return safe_name
    return ""


def _attachment_extension(filename: str) -> str:
    safe_name = normalize_text(filename).lower()
    if "." not in safe_name:
        return ""
    return f".{safe_name.rsplit('.', 1)[-1]}"


def _clean_filename(filename: str) -> str:
    safe_name = Path(normalize_text(filename) or "curriculo").name
    stem = Path(safe_name).stem or "curriculo"
    extension = Path(safe_name).suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9_. -]+", "", stem).strip(" ._-")
    stem = re.sub(r"\s+", "_", stem)[:90] or "curriculo"
    return f"{stem}{extension}"


def _looks_like_person_name(value: str) -> bool:
    safe_value = normalize_text(value)
    if not safe_value or any(char.isdigit() for char in safe_value):
        return False
    words = [item for item in safe_value.split() if item]
    if len(words) < 2 or len(words) > 6:
        return False
    normalized = normalize_compare_text(safe_value)
    blocked = {
        "curriculo",
        "cv",
        "vaga",
        "candidatura",
        "operador",
        "analista",
        "control desk",
        "jovem aprendiz",
        "supervisor",
        "assistente",
        "auxiliar",
    }
    return not any(item in normalized for item in blocked)


def _strip_cv_words(value: str) -> str:
    cleaned = re.sub(
        r"\b(curriculo|curriculo de|currículo|currículo de|cv|resume|candidatura|candidato|vaga)\b",
        " ",
        value or "",
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[_.,;]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return normalize_text(cleaned).strip(" -|/")


def _parse_message_datetime(message) -> datetime | None:
    try:
        parsed = parsedate_to_datetime(message.get("date", ""))
    except Exception:
        return None
    if parsed and parsed.tzinfo:
        return parsed.replace(tzinfo=None)
    return parsed


def _iso_datetime(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return normalize_text(value)


def _html_to_text(content: str) -> str:
    text = re.sub(r"(?i)<\s*(br|tr|p|div|li|h[1-6])\b[^>]*>", "\n", content or "")
    text = re.sub(r"(?i)<\s*/\s*(tr|p|div|li|h[1-6]|td|th)\s*>", "\n", text)
    text = re.sub(r"(?i)<\s*(td|th)\b[^>]*>", "\n", text)
    text = re.sub(r"(?is)<\s*(script|style)\b.*?<\s*/\s*\1\s*>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return normalize_text(text)


def _label_key(value: str) -> str:
    cleaned = re.sub(r"[:：\-–—]+$", "", normalize_text(value))
    cleaned = re.sub(r"\s+", " ", cleaned)
    return normalize_compare_text(cleaned)


APPLICATION_LABEL_TO_FIELD = {
    _label_key(alias): field
    for field, aliases in APPLICATION_FORM_LABELS.items()
    for alias in aliases
}


def _canonical_yes_no(value: str) -> str:
    normalized = normalize_compare_text(value)
    if re.search(r"\b(sim|s|yes|y)\b", normalized):
        return "Sim"
    if re.search(r"\b(nao|n|no)\b", normalized):
        return "Nao"
    return ""


def _clean_application_value(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", normalize_text(value))
    return cleaned.strip(" :;-")


def _extract_application_form_fields(subject: str, body: str, sender: str = "") -> dict:
    lines = [
        normalize_text(line)
        for line in re.split(r"[\r\n]+", body or "")
        if normalize_text(line)
    ]
    fields = {field: "" for field in APPLICATION_FORM_LABELS}

    index = 0
    while index < len(lines):
        line = lines[index]
        inline_match = re.match(r"^\s*([^:：]{2,40})\s*[:：]\s*(.*?)\s*$", line)
        label_source = inline_match.group(1) if inline_match else line
        field = APPLICATION_LABEL_TO_FIELD.get(_label_key(label_source))
        if not field:
            index += 1
            continue

        value = inline_match.group(2) if inline_match and inline_match.group(2) else ""
        if not value:
            collected = []
            cursor = index + 1
            while cursor < len(lines):
                next_line = lines[cursor]
                next_inline = re.match(r"^\s*([^:：]{2,40})\s*[:：]\s*(.*?)\s*$", next_line)
                next_label_source = next_inline.group(1) if next_inline else next_line
                if APPLICATION_LABEL_TO_FIELD.get(_label_key(next_label_source)):
                    break
                if _label_key(next_line) == "pesquisa cultural":
                    cursor += 1
                    continue
                collected.append(next_line)
                cursor += 1
            value = " ".join(collected)
            index = max(index, cursor - 1)

        fields[field] = fields[field] or _clean_application_value(value)
        index += 1

    if fields["email"]:
        fields["email"] = extract_email(fields["email"]) or fields["email"]
    if fields["telefone"]:
        fields["telefone"] = extract_whatsapp(fields["telefone"]) or extract_phone(fields["telefone"]) or fields["telefone"]
    fields["experiencia"] = _canonical_yes_no(fields["experiencia"]) or fields["experiencia"]
    fields["curriculo_anexado"] = _canonical_yes_no(fields["curriculo_anexado"]) or fields["curriculo_anexado"]

    normalized_body = normalize_compare_text(body)
    normalized_subject = normalize_compare_text(subject)
    normalized_sender = normalize_compare_text(sender)
    detected_labels = {field for field, value in fields.items() if value}
    required_hits = {
        field
        for field in APPLICATION_REQUIRED_LABELS
        if re.search(rf"(^|\n|\b){re.escape(normalize_compare_text(APPLICATION_FORM_LABELS[field][0]))}\b", normalized_body)
        or fields.get(field)
    }
    has_title = "novo cadastro rh" in normalized_body
    subject_hint = any(item in normalized_subject for item in ("site", "candidato", "trabalhe conosco", "rh"))
    sender_hint = any(item in normalized_sender for item in ("site", "wordpress", "central24", "conecta", "rh"))
    is_application = (
        has_title
        and len(required_hits) >= 3
    ) or (
        subject_hint
        and len(required_hits) >= 3
        and len(detected_labels) >= 4
    ) or (
        sender_hint
        and len(required_hits) >= 4
    )

    missing = sorted(field for field in APPLICATION_REQUIRED_LABELS if not fields.get(field))
    errors = []
    if is_application:
        if missing:
            errors.append("Campo obrigatorio nao encontrado: " + ", ".join(missing))
        if fields["email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", fields["email"]):
            errors.append("E-mail invalido")
        if not fields["telefone"]:
            errors.append("Telefone nao identificado")

    return {
        "is_application": is_application,
        "fields": fields,
        "missing_required": missing,
        "errors": errors,
    }


class EmailInboxService:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def provider(self) -> str:
        return normalize_compare_text(getattr(self.settings, "email_inbox_provider", "")) or "microsoft365"

    @property
    def protocol(self) -> str:
        return normalize_compare_text(getattr(self.settings, "email_inbox_protocol", "")) or "imap"

    @property
    def auth_mode(self) -> str:
        return normalize_compare_text(getattr(self.settings, "email_inbox_auth_mode", "")) or "password"

    @property
    def max_attachment_bytes(self) -> int:
        size_mb = int(getattr(self.settings, "email_inbox_max_attachment_mb", 10) or 10)
        return max(1, size_mb) * 1024 * 1024

    @property
    def attachments_root(self) -> Path:
        configured_path = normalize_text(getattr(self.settings, "email_inbox_attachments_dir", ""))
        return Path(configured_path) if configured_path else Path("data") / "private" / "email_attachments"

    def status(self) -> dict:
        enabled = bool(getattr(self.settings, "email_inbox_enabled", False))
        provider = normalize_text(getattr(self.settings, "email_inbox_provider", "")) or "microsoft365"
        protocol = normalize_text(getattr(self.settings, "email_inbox_protocol", "")) or "imap"
        mailbox = normalize_text(getattr(self.settings, "email_inbox_mailbox", "")) or "INBOX"
        auth_mode = normalize_text(getattr(self.settings, "email_inbox_auth_mode", "")) or "oauth2"
        username = (
            normalize_text(getattr(self.settings, "email_inbox_username", ""))
            or normalize_text(getattr(self.settings, "email_inbox_address", ""))
        )
        host = normalize_text(getattr(self.settings, "email_inbox_imap_host", ""))

        message = ""
        configured = True
        provider_key = normalize_compare_text(provider)
        protocol_key = normalize_compare_text(protocol)
        allowed_providers = {"microsoft365", "office365", "outlook", "exchange", "exchange online", "imap", "graph"}

        if not enabled:
            configured = False
            message = "Caixa de e-mail desativada no servidor."
        elif provider_key not in allowed_providers or protocol_key != "imap":
            configured = False
            message = "Caixa de e-mail corporativa ainda não configurada. Configure PROVIDER=microsoft365 e PROTOCOL=imap."
        elif not host or not username:
            configured = False
            message = EMAIL_INBOX_NOT_CONFIGURED_MESSAGE
        elif self.auth_mode == "oauth2":
            tenant_id = normalize_text(getattr(self.settings, "email_inbox_tenant_id", ""))
            client_id = normalize_text(getattr(self.settings, "email_inbox_client_id", ""))
            secret_env = normalize_text(getattr(self.settings, "email_inbox_client_secret_env", ""))
            if not tenant_id or not client_id or not secret_env or not os.getenv(secret_env, ""):
                configured = False
                message = EMAIL_INBOX_NOT_CONFIGURED_MESSAGE
        elif self.auth_mode == "password":
            password_env = normalize_text(getattr(self.settings, "email_inbox_password_env", ""))
            if not password_env or not os.getenv(password_env, ""):
                configured = False
                message = EMAIL_INBOX_NOT_CONFIGURED_MESSAGE
        else:
            configured = False
            message = "Modo de autenticação da caixa de e-mail não suportado."

        status_key = "configured"
        if not enabled:
            status_key = "disabled"
        elif not configured:
            status_key = "not_configured"

        return {
            "success": True,
            "enabled": enabled,
            "configured": configured,
            "provider": provider,
            "protocol": protocol,
            "mailbox": mailbox,
            "auth_mode": auth_mode,
            "email_address": normalize_text(getattr(self.settings, "email_inbox_address", "")),
            "status": status_key,
            "message": message,
            "error": "" if configured else message,
        }

    def _ensure_configured(self) -> None:
        status_payload = self.status()
        if not status_payload.get("enabled") or not status_payload.get("configured"):
            raise EmailInboxUnavailable(
                status_payload.get("message") or EMAIL_INBOX_NOT_CONFIGURED_MESSAGE,
                configured=False,
            )

    def _oauth2_access_token(self) -> str:
        tenant_id = normalize_text(getattr(self.settings, "email_inbox_tenant_id", ""))
        client_id = normalize_text(getattr(self.settings, "email_inbox_client_id", ""))
        secret_env = normalize_text(getattr(self.settings, "email_inbox_client_secret_env", ""))
        client_secret = os.getenv(secret_env, "") if secret_env else ""
        scope = normalize_text(getattr(self.settings, "email_inbox_oauth_scope", "")) or "https://outlook.office365.com/.default"
        if not tenant_id or not client_id or not client_secret:
            raise EmailInboxUnavailable(EMAIL_INBOX_NOT_CONFIGURED_MESSAGE)

        try:
            import msal  # type: ignore[import-not-found]
        except ImportError as exc:
            raise EmailInboxUnavailable(
                "MSAL não está instalado no servidor para autenticação OAuth2 do IMAP."
            ) from exc

        app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret,
        )
        token_payload = app.acquire_token_silent([scope], account=None)
        if not token_payload:
            token_payload = app.acquire_token_for_client(scopes=[scope])
        access_token = normalize_text(token_payload.get("access_token"))
        if not access_token:
            logger.warning("OAuth2 IMAP sem access_token: %s", token_payload.get("error_description") or token_payload.get("error"))
            raise EmailInboxUnavailable("OAuth2 não autorizou acesso ao IMAP. Verifique tenant, app, secret e permissões.")
        return access_token

    def _open_mailbox(self, *, readonly: bool = True):
        self._ensure_configured()
        host = normalize_text(getattr(self.settings, "email_inbox_imap_host", ""))
        port = int(getattr(self.settings, "email_inbox_imap_port", 993) or 993)
        username = (
            normalize_text(getattr(self.settings, "email_inbox_username", ""))
            or normalize_text(getattr(self.settings, "email_inbox_address", ""))
        )
        mailbox_name = normalize_text(getattr(self.settings, "email_inbox_mailbox", "")) or "INBOX"

        try:
            mailbox = imaplib.IMAP4_SSL(host, port)
            if self.auth_mode == "oauth2":
                token = self._oauth2_access_token()
                auth_string = f"user={username}\x01auth=Bearer {token}\x01\x01"
                mailbox.authenticate("XOAUTH2", lambda _challenge: auth_string.encode("utf-8"))
            else:
                password_env = normalize_text(getattr(self.settings, "email_inbox_password_env", ""))
                mailbox.login(username, os.getenv(password_env, ""))

            mailbox.select(mailbox_name, readonly=readonly)
            return mailbox
        except EmailInboxUnavailable:
            raise
        except Exception as exc:
            logger.exception("Falha ao conectar a caixa IMAP: %s", exc)
            raise EmailInboxUnavailable(EMAIL_INBOX_CONNECTION_ERROR_MESSAGE, configured=True) from exc

    def _message_body(self, message) -> str:
        try:
            plain_part = message.get_body(preferencelist=("plain",))
            if plain_part:
                return normalize_text(plain_part.get_content())
        except Exception as exc:
            logger.debug("Falha ao extrair corpo em texto simples do e-mail: %s", exc)

        try:
            html_part = message.get_body(preferencelist=("html",))
            if html_part:
                return _html_to_text(html_part.get_content())
        except Exception as exc:
            logger.debug("Falha ao extrair corpo em HTML do e-mail: %s", exc)

        parts = []
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get_content_type() not in {"text/plain", "text/html"}:
                continue
            payload = part.get_payload(decode=True) or b""
            text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            if part.get_content_type() == "text/html":
                text = _html_to_text(text)
            parts.append(text)
        return normalize_text("\n".join(parts))

    def _candidate_name_from_email(self, subject: str, body: str, filename: str = "") -> str:
        for pattern in (
            r"\bnome\s*[:\-]\s*([^\n\r|]+)",
            r"\bcandidato\s*[:\-]\s*([^\n\r|]+)",
        ):
            match = re.search(pattern, body or "", flags=re.IGNORECASE)
            if match:
                candidate = normalize_text(match.group(1))[:120]
                if candidate:
                    return candidate

        subject_parts = [normalize_text(item) for item in re.split(r"\s[-|/]\s", subject or "") if normalize_text(item)]
        if len(subject_parts) >= 2:
            first = _strip_cv_words(subject_parts[0])
            second = _strip_cv_words(subject_parts[-1])
            if _looks_like_person_name(second) and normalize_compare_text(subject_parts[0]) in {
                "candidatura operador",
                "candidatura",
            }:
                return second[:120]
            if _looks_like_person_name(first):
                return first[:120]
            if _looks_like_person_name(second):
                return second[:120]

        subject_name = _strip_cv_words(subject or "")
        if _looks_like_person_name(subject_name):
            return subject_name[:120]

        filename_name = _strip_cv_words(Path(normalize_text(filename)).stem)
        if _looks_like_person_name(filename_name):
            return filename_name[:120]

        return extract_candidate_name(body or "", filename=filename)[:120]

    def _role_from_email(self, subject: str, body: str) -> str:
        for pattern in (
            r"\bvaga\s*[:\-]\s*([^\n\r|]+)",
            r"\bcargo\s*[:\-]\s*([^\n\r|]+)",
            r"\barea\s*[:\-]\s*([^\n\r|]+)",
        ):
            match = re.search(pattern, body or "", flags=re.IGNORECASE)
            if match:
                return normalize_text(match.group(1))[:120]

        subject_parts = [normalize_text(item) for item in re.split(r"\s[-|/]\s", subject or "") if normalize_text(item)]
        if len(subject_parts) >= 2:
            first = normalize_text(subject_parts[0])
            second = normalize_text(subject_parts[-1])
            normalized_first = normalize_compare_text(first)
            if "candidatura" in normalized_first:
                return _strip_cv_words(first)[:120]
            if _looks_like_person_name(_strip_cv_words(first)):
                return _strip_cv_words(second)[:120]

        match = re.search(r"\bvaga\s+(?:de|para)?\s*([A-Za-zÀ-ÿ0-9 /.-]{3,80})", subject or "", flags=re.IGNORECASE)
        return normalize_text(match.group(1))[:120] if match else ""

    def _attachment_id(self, item_id: str, index: int, filename: str, size: int) -> str:
        digest = hashlib.sha256(f"{item_id}:{index}:{filename}:{size}".encode("utf-8")).hexdigest()[:18]
        return f"att-{digest}"

    def _iter_cv_attachments(self, item_id: str, message, *, include_content: bool = False) -> list[dict]:
        attachments = []
        for index, part in enumerate(message.iter_attachments()):
            disposition = normalize_compare_text(part.get_content_disposition())
            if disposition == "inline":
                continue
            filename = _decode_header_value(part.get_filename())
            if not filename:
                continue
            extension = _attachment_extension(filename)
            if extension in BLOCKED_ATTACHMENT_EXTENSIONS or extension not in ALLOWED_CV_EXTENSIONS:
                continue
            payload = part.get_payload(decode=True) or b""
            size = len(payload)
            if size <= 0 or size > self.max_attachment_bytes:
                continue
            content_type = normalize_text(part.get_content_type()) or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            item = {
                "id": self._attachment_id(item_id, index, filename, size),
                "filename": filename,
                "content_type": content_type,
                "size": size,
                "is_cv_candidate": True,
                "nome": filename,
                "mime_type": content_type,
                "tamanho_bytes": size,
                "cv_compativel": True,
            }
            if include_content:
                item["content"] = payload
            attachments.append(item)
        return attachments

    def _message_item_id(self, uid: str, message_id: str) -> str:
        mailbox = normalize_text(getattr(self.settings, "email_inbox_mailbox", "")) or "INBOX"
        basis = message_id or f"{mailbox}:{uid}"
        digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:32]
        return f"imap-{digest}"

    def _serialize_message(self, uid: str, message) -> dict:
        subject = _decode_header_value(message.get("subject")) or "(sem assunto)"
        sender = _decode_header_value(message.get("from")) or "Remetente não informado"
        message_id = normalize_text(message.get("message-id"))
        item_id = self._message_item_id(uid, message_id)
        body = self._message_body(message)
        attachments = self._iter_cv_attachments(item_id, message)
        primary_filename = attachments[0]["filename"] if attachments else ""
        received_at = _parse_message_datetime(message)
        application_form = _extract_application_form_fields(subject, body, sender)
        application_fields = application_form["fields"]
        detected_email = application_fields.get("email") or extract_email(body) or _first_email(sender)
        detected_phone = application_fields.get("telefone") or extract_whatsapp(body) or extract_phone(body)
        detected_name = application_fields.get("nome") or self._candidate_name_from_email(subject, body, primary_filename)
        detected_role = self._role_from_email(subject, body)
        curriculum_answer = application_fields.get("curriculo_anexado")
        inconsistencies = []
        if application_form["is_application"] and curriculum_answer == "Sim" and not attachments:
            inconsistencies.append("Curriculo informado como anexado, mas nenhum arquivo valido foi encontrado.")
        inconsistencies.extend(application_form.get("errors") or [])
        status_value = "Recebido"
        if inconsistencies:
            status_value = "Inconsistencia no cadastro"
        resumo = (body[:420] + "...") if len(body) > 420 else body
        return {
            "id": item_id,
            "uid": normalize_text(uid),
            "message_uid": normalize_text(uid),
            "message_id": message_id,
            "remetente": sender,
            "remetente_nome": _first_sender_name(sender),
            "remetente_email": _first_email(sender),
            "assunto": subject,
            "data_recebimento": _iso_datetime(received_at),
            "data_hora": _iso_datetime(received_at),
            "resumo": resumo,
            "resumo_corpo": resumo,
            "corpo": body,
            "possui_anexo": bool(attachments),
            "anexos": attachments,
            "nome_anexo": primary_filename,
            "nome_detectado": detected_name,
            "nome_candidato_possivel": detected_name,
            "telefone_detectado": detected_phone,
            "telefone_encontrado": detected_phone,
            "email_detectado": detected_email,
            "email_encontrado": detected_email,
            "vaga_detectada": detected_role,
            "vaga_pretendida_possivel": detected_role,
            "experiencia_detectada": application_fields.get("experiencia"),
            "trabalhe_conosco": bool(application_form["is_application"]),
            "campos_formulario": application_fields,
            "curriculo_anexado_informado": curriculum_answer,
            "inconsistencias": inconsistencies,
            "status": status_value,
            "status_analise": status_value,
            "origem": EMAIL_INBOX_ORIGIN,
        }

    def fetch_message(self, uid: str):
        safe_uid = normalize_text(uid)
        if not safe_uid:
            raise EmailInboxUnavailable("E-mail não informado.", configured=True)
        mailbox = self._open_mailbox(readonly=True)
        try:
            typ, data = mailbox.uid("fetch", safe_uid, "(RFC822)")
            if typ != "OK" or not data:
                raise EmailInboxUnavailable("E-mail não encontrado.", configured=True)
            for item in data:
                if isinstance(item, tuple) and item[1]:
                    return BytesParser(policy=policy.default).parsebytes(item[1])
            raise EmailInboxUnavailable("E-mail não encontrado.", configured=True)
        finally:
            try:
                mailbox.logout()
            except Exception as exc:
                logger.debug("Falha ao encerrar sessao IMAP: %s", exc)

    def delete_message(self, uid: str) -> None:
        safe_uid = normalize_text(uid)
        if not safe_uid:
            raise EmailInboxUnavailable("UID do e-mail não informado.", configured=True)

        mailbox = self._open_mailbox(readonly=False)
        try:
            typ, _ = mailbox.uid("STORE", safe_uid, "+FLAGS", r"(\Deleted)")
            if typ != "OK":
                raise EmailInboxUnavailable("Não foi possível marcar o e-mail para exclusão.", configured=True)

            mailbox.expunge()
        finally:
            try:
                mailbox.logout()
            except Exception as exc:
                logger.debug("Falha ao encerrar sessao IMAP: %s", exc)

    def fetch_messages(
        self,
        *,
        limit: int = 50,
        unread_only: bool = False,
        with_attachments_only: bool = False,
        query: str = "",
    ) -> list[dict]:
        safe_limit = clamp_limit(
            limit, default=50, maximum=int(getattr(self.settings, "email_inbox_max_messages", 50) or 50)
        )
        mailbox = self._open_mailbox(readonly=True)
        try:
            search_flag = "UNSEEN" if unread_only else "ALL"
            typ, data = mailbox.uid("search", None, search_flag)
            if typ != "OK":
                raise EmailInboxUnavailable("Não foi possível pesquisar mensagens na caixa de entrada.", configured=True)
            uids = (data[0] or b"").split()
            fetch_count = max(safe_limit, min(len(uids), safe_limit * 3))
            selected = list(reversed(uids[-fetch_count:]))
            items = []
            query_term = normalize_compare_text(query)
            for raw_uid in selected:
                uid = raw_uid.decode("ascii", errors="ignore")
                try:
                    typ, fetched = mailbox.uid("fetch", uid, "(RFC822)")
                    if typ != "OK":
                        continue
                    message = None
                    for fetched_item in fetched:
                        if isinstance(fetched_item, tuple) and fetched_item[1]:
                            message = BytesParser(policy=policy.default).parsebytes(fetched_item[1])
                            break
                    if message is None:
                        continue
                    item = self._serialize_message(uid, message)
                    if with_attachments_only and not item.get("possui_anexo") and not item.get("trabalhe_conosco"):
                        continue
                    if query_term:
                        haystack = " ".join(
                            normalize_text(item.get(key))
                            for key in ("remetente", "assunto", "resumo", "nome_detectado", "vaga_detectada", "email_detectado", "experiencia_detectada")
                        )
                        if query_term not in normalize_compare_text(haystack):
                            continue
                    items.append(item)
                    if len(items) >= safe_limit:
                        break
                except Exception as exc:
                    logger.warning("E-mail ignorado por falha de leitura no IMAP uid=%s: %s", uid, exc)
            return items
        except EmailInboxUnavailable:
            raise
        except Exception as exc:
            logger.exception("Falha ao listar mensagens IMAP: %s", exc)
            raise EmailInboxUnavailable(EMAIL_INBOX_CONNECTION_ERROR_MESSAGE, configured=True) from exc
        finally:
            try:
                mailbox.logout()
            except Exception as exc:
                logger.debug("Falha ao encerrar sessao IMAP: %s", exc)

    def download_cv_attachments(self, *, uid: str, item_id: str) -> dict:
        message = self.fetch_message(uid)
        summary = self._serialize_message(uid, message)
        attachments = self._iter_cv_attachments(item_id, message, include_content=True)
        if not attachments:
            raise EmailInboxUnavailable("Este e-mail não possui anexo de currículo válido.", configured=True)

        received_at = _parse_message_datetime(message) or datetime.now()
        date_folder = received_at.strftime("%Y-%m-%d")
        message_hash = hashlib.sha256(
            (summary.get("message_id") or uid or item_id).encode("utf-8")
        ).hexdigest()[:18]
        target_folder = self.attachments_root / date_folder / message_hash
        target_folder.mkdir(parents=True, exist_ok=True)

        saved_attachments = []
        for attachment in attachments:
            original_name = normalize_text(attachment.get("filename")) or "curriculo.pdf"
            safe_name = _clean_filename(original_name)
            target_path = target_folder / safe_name
            if target_path.exists():
                stem = target_path.stem
                extension = target_path.suffix
                suffix = 2
                while target_path.exists():
                    target_path = target_folder / f"{stem}-{suffix}{extension}"
                    suffix += 1
            content = attachment.pop("content", b"")
            target_path.write_bytes(content)
            saved_attachments.append(
                {
                    **attachment,
                    "filename": original_name,
                    "nome": original_name,
                    "stored_filename": target_path.name,
                    "path": str(target_path),
                    "relative_path": str(target_path.relative_to(self.attachments_root)),
                }
            )

        metadata_path = target_folder / "metadata.json"
        metadata_payload = {
            "id": item_id,
            "message_uid": uid,
            "message_id": summary.get("message_id"),
            "remetente": summary.get("remetente"),
            "assunto": summary.get("assunto"),
            "data": summary.get("data_recebimento"),
            "data_recebimento": summary.get("data_recebimento"),
            "resumo": summary.get("resumo"),
            "corpo": summary.get("corpo"),
            "anexos": [
                {
                    key: value
                    for key, value in attachment.items()
                    if key not in {"path"}
                }
                for attachment in saved_attachments
            ],
            "status": "Recebido",
            "trabalhe_conosco": bool(summary.get("trabalhe_conosco")),
            "campos_formulario": summary.get("campos_formulario") or {},
            "curriculo_anexado_informado": summary.get("curriculo_anexado_informado"),
            "inconsistencias": summary.get("inconsistencias") or [],
            "origem": EMAIL_INBOX_ORIGIN,
        }
        metadata_path.write_text(
            json.dumps(metadata_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {
            "summary": summary,
            "attachments": saved_attachments,
            "metadata_path": str(metadata_path),
        }

    def save_manual_attachment(self, *, item_id: str, filename: str, content: bytes, content_type: str = "") -> dict:
        if not content:
            raise EmailInboxUnavailable("Arquivo vazio.", configured=True)
        extension = _attachment_extension(filename)
        if extension in BLOCKED_ATTACHMENT_EXTENSIONS or extension not in ALLOWED_CV_EXTENSIONS:
            raise EmailInboxUnavailable("Tipo de arquivo não suportado. Envie PDF, DOC ou DOCX.", configured=True)
        if len(content) > self.max_attachment_bytes:
            raise EmailInboxUnavailable("Arquivo maior que o limite permitido.", configured=True)

        received_at = datetime.now()
        date_folder = received_at.strftime("%Y-%m-%d")
        message_hash = hashlib.sha256(item_id.encode("utf-8")).hexdigest()[:18]
        target_folder = self.attachments_root / date_folder / message_hash
        target_folder.mkdir(parents=True, exist_ok=True)

        original_name = normalize_text(filename) or "curriculo.pdf"
        safe_name = _clean_filename(original_name)
        target_path = target_folder / safe_name
        if target_path.exists():
            stem = target_path.stem
            suffix_ext = target_path.suffix
            suffix = 2
            while target_path.exists():
                target_path = target_folder / f"{stem}-{suffix}{suffix_ext}"
                suffix += 1
        target_path.write_bytes(content)

        safe_content_type = normalize_text(content_type) or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
        attachment = {
            "id": self._attachment_id(item_id, 0, original_name, len(content)),
            "filename": original_name,
            "content_type": safe_content_type,
            "size": len(content),
            "is_cv_candidate": True,
            "nome": original_name,
            "mime_type": safe_content_type,
            "tamanho_bytes": len(content),
            "cv_compativel": True,
            "stored_filename": target_path.name,
            "path": str(target_path),
            "relative_path": str(target_path.relative_to(self.attachments_root)),
        }

        metadata_path = target_folder / "metadata.json"
        metadata_payload = {
            "id": item_id,
            "message_uid": "",
            "message_id": "",
            "remetente": "",
            "assunto": "Currículo adicionado manualmente",
            "data": _iso_datetime(received_at),
            "data_recebimento": _iso_datetime(received_at),
            "resumo": "",
            "corpo": "",
            "anexos": [{key: value for key, value in attachment.items() if key != "path"}],
            "status": "Recebido",
            "trabalhe_conosco": False,
            "campos_formulario": {},
            "curriculo_anexado_informado": "",
            "inconsistencias": [],
            "origem": MANUAL_UPLOAD_ORIGIN,
        }
        metadata_path.write_text(
            json.dumps(metadata_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return {"attachment": attachment, "received_at": received_at}

    def resolve_saved_attachment(self, attachments: list[dict], attachment_id: str = "") -> dict:
        requested_id = normalize_text(attachment_id)
        candidates = attachments or []
        selected = None
        for attachment in candidates:
            if requested_id and normalize_text(attachment.get("id")) != requested_id:
                continue
            selected = attachment
            break
        if selected is None and not requested_id and candidates:
            selected = candidates[0]
        if not selected:
            raise EmailInboxUnavailable("Anexo não encontrado.", configured=True)

        path = Path(normalize_text(selected.get("path")))
        try:
            root = self.attachments_root.resolve()
            resolved = path.resolve()
        except OSError as exc:
            raise EmailInboxUnavailable("Anexo não encontrado.", configured=True) from exc
        if root not in [resolved, *resolved.parents]:
            raise EmailInboxUnavailable("Anexo inválido.", configured=True)
        if not resolved.exists() or not resolved.is_file():
            raise EmailInboxUnavailable("Anexo não encontrado.", configured=True)

        return {
            **selected,
            "path": str(resolved),
            "filename": normalize_text(selected.get("filename")) or resolved.name,
            "content_type": normalize_text(selected.get("content_type")) or "application/octet-stream",
        }

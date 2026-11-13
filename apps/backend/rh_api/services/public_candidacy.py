from __future__ import annotations

import json
import secrets
import unicodedata
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from fastapi import HTTPException, status

from .helpers import normalize_text
from .public_job_texts import get_default_public_job_texts

PUBLIC_CANDIDACY_ROUTE = "candidatar"
PUBLIC_CV_MAX_BYTES = 5 * 1024 * 1024
PUBLIC_APPLICATION_ORIGIN = "Página de candidatura"
PUBLIC_APPLICATION_SUCCESS_MESSAGE = (
    "Candidatura enviada com sucesso. Recebemos suas informações e seu currículo. "
    "O RH analisará seu perfil e poderá entrar em contato pelo telefone ou e-mail informado."
)
PUBLIC_APPLICATION_DUPLICATE_MESSAGE = "Você já possui candidatura registrada para esta vaga."
PUBLIC_APPLICATION_CLOSED_MESSAGE = "Esta vaga não está mais disponível para candidatura."
PUBLIC_CANDIDATE_BASE_URL_WARNING = (
    "URL pública ainda não configurada. Defina PUBLIC_CANDIDATE_BASE_URL no servidor para liberar inscrições externas."
)

_ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}
_PDF_MAGIC = b"%PDF"
_DOC_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_GENERIC_CONTENT_TYPES = {"application/octet-stream", "binary/octet-stream"}
_ALLOWED_CONTENT_TYPES = {
    ".pdf": {"application/pdf"},
    ".doc": {"application/msword", "application/doc"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
    },
}
_MIME_BY_EXTENSION = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


@dataclass(frozen=True)
class ValidatedPublicCvUpload:
    original_filename: str
    stored_filename: str
    extension: str
    mime_type: str
    size_bytes: int
    content_bytes: bytes


def slugify_public_text(value: str, *, fallback: str = "vaga", max_length: int = 48) -> str:
    normalized = unicodedata.normalize("NFD", normalize_text(value))
    without_marks = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    sanitized = []
    last_was_dash = False

    for char in without_marks.lower():
        if char.isalnum():
            sanitized.append(char)
            last_was_dash = False
            continue

        if sanitized and not last_was_dash:
            sanitized.append("-")
            last_was_dash = True

    slug = "".join(sanitized).strip("-")
    if not slug:
        slug = fallback
    if len(slug) > max_length:
        slug = slug[:max_length].rstrip("-")
    return slug or fallback


def generate_public_token(length: int = 8) -> str:
    token = secrets.token_urlsafe(length).lower()
    return "".join(char for char in token if char.isalnum())[: max(6, length)]


def build_public_process_slug(vaga: str, token: str) -> str:
    return f"{slugify_public_text(vaga)}-{normalize_text(token).lower()}"


def resolve_public_frontend_base_url(
    configured_base_url: str = "",
    *,
    referrer_url: str = "",
    origin_url: str = "",
) -> str:
    candidate = normalize_text(configured_base_url) or normalize_text(referrer_url) or normalize_text(origin_url)
    if not candidate:
        return "/"

    parts = urlsplit(candidate)
    path = parts.path or ""

    if not path or path == "/":
        path = "/"

    if not parts.scheme and not parts.netloc:
        return urlunsplit(("", "", path, parts.query, ""))

    return urlunsplit((parts.scheme or "http", parts.netloc, path, parts.query, ""))


def normalize_public_application_base_url(base_url: str = "") -> str:
    candidate = normalize_text(base_url)
    if not candidate:
        return resolve_public_frontend_base_url("")

    parts = urlsplit(candidate)
    path = parts.path or "/"
    if not parts.scheme and not parts.netloc:
        return urlunsplit(("", "", path, parts.query, ""))

    return urlunsplit((parts.scheme or "http", parts.netloc, path, parts.query, ""))


def resolve_public_candidate_base_url(
    configured_candidate_base_url: str = "",
    configured_frontend_base_url: str = "",
    *,
    referrer_url: str = "",
    origin_url: str = "",
) -> tuple[str, bool]:
    configured = normalize_text(configured_candidate_base_url)
    if configured:
        return normalize_public_application_base_url(configured), True

    fallback = resolve_public_frontend_base_url(
        configured_frontend_base_url,
        referrer_url=referrer_url,
        origin_url=origin_url,
    )
    return fallback, False


def build_public_application_url(base_url: str, slug: str) -> str:
    safe_slug = normalize_text(slug)
    if not safe_slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slug público da vaga não informado.",
        )

    base = normalize_public_application_base_url(base_url)
    return f"{base}#/{PUBLIC_CANDIDACY_ROUTE}/{quote(safe_slug)}"


def _public_config_items_from_json(raw_value: str, key: str) -> tuple[list[str], bool]:
    safe_raw = normalize_text(raw_value)
    if not safe_raw:
        return [], False

    try:
        parsed = json.loads(safe_raw)
    except Exception:
        lines = [item.strip() for item in safe_raw.splitlines() if item.strip()]
        return lines, bool(lines)

    if isinstance(parsed, dict):
        parsed_items = parsed.get(key, [])
    else:
        parsed_items = parsed

    if not isinstance(parsed_items, list):
        return [], True

    items = []
    for item in parsed_items:
        if isinstance(item, str):
            text = normalize_text(item)
            visible = True
        elif isinstance(item, dict):
            text = normalize_text(item.get("texto"))
            visible = item.get("visivel", True) is not False
        else:
            continue

        if text and visible:
            items.append(text)

    return items, True


def resolve_public_process_description(processo: dict | None) -> str:
    safe_process = processo or {}
    descricao_publica = normalize_text(safe_process.get("descricao_publica"))
    if descricao_publica:
        return descricao_publica

    return get_default_public_job_texts(safe_process)["descricao"]


def resolve_public_process_requirements(processo: dict | None) -> str:
    safe_process = processo or {}
    requisitos_publicos, has_config = _public_config_items_from_json(
        safe_process.get("requisitos_publicos"),
        "requisitos",
    )
    if has_config:
        return "\n".join(requisitos_publicos)

    return "\n".join(get_default_public_job_texts(safe_process)["requisitos"])


def resolve_public_process_responsibilities(processo: dict | None) -> str:
    safe_process = processo or {}
    responsabilidades_publicas, has_config = _public_config_items_from_json(
        safe_process.get("responsabilidades_publicas"),
        "responsabilidades",
    )
    if has_config:
        return "\n".join(responsabilidades_publicas)

    return "\n".join(get_default_public_job_texts(safe_process)["responsabilidades"])


def validate_public_cv_upload(
    filename: str,
    content_type: str,
    content_bytes: bytes,
) -> ValidatedPublicCvUpload:
    safe_name = normalize_text(filename)
    extension = Path(safe_name).suffix.lower()
    if extension not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de currículo não suportado. Envie um arquivo PDF, DOC ou DOCX.",
        )

    safe_content = content_bytes or b""
    if not safe_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não foi possível encontrar texto no currículo enviado.",
        )

    if len(safe_content) > PUBLIC_CV_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O currículo excede o limite de 5 MB permitido.",
        )

    normalized_content_type = normalize_text(content_type).lower()
    allowed_content_types = _ALLOWED_CONTENT_TYPES.get(extension, set())
    if (
        normalized_content_type
        and normalized_content_type not in allowed_content_types
        and normalized_content_type not in _GENERIC_CONTENT_TYPES
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O tipo do arquivo enviado não corresponde a um currículo válido.",
        )

    if extension == ".pdf":
        if not safe_content.startswith(_PDF_MAGIC):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Não foi possível ler o currículo. Verifique se o arquivo não está corrompido e tente novamente.",
            )
    elif extension == ".doc":
        if not safe_content.startswith(_DOC_MAGIC):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Não foi possível ler o currículo. Verifique se o arquivo não está corrompido e tente novamente.",
            )
    elif extension == ".docx":
        if not safe_content.startswith(b"PK"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Não foi possível ler o currículo. Verifique se o arquivo não está corrompido e tente novamente.",
            )
        try:
            with zipfile.ZipFile(BytesIO(safe_content)) as zip_file:
                if "word/document.xml" not in zip_file.namelist():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Não foi possível ler o currículo. Verifique se o arquivo não está corrompido e tente novamente.",
                    )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Não foi possível ler o currículo. Verifique se o arquivo não está corrompido e tente novamente.",
            ) from exc

    stored_filename = f"{slugify_public_text(Path(safe_name).stem, fallback='curriculo', max_length=28)}-{secrets.token_hex(10)}{extension}"
    return ValidatedPublicCvUpload(
        original_filename=safe_name,
        stored_filename=stored_filename,
        extension=extension,
        mime_type=_MIME_BY_EXTENSION[extension],
        size_bytes=len(safe_content),
        content_bytes=safe_content,
    )

"""Validação e armazenamento de arquivos da Central de Treinamentos (slide
.pptx, vídeo de módulo, documentos/imagens da aba "Saiba +").

Mesmo padrão já usado para currículos públicos
(`services/public_candidacy.py`): allowlist de extensão + assinatura de bytes
(magic bytes) + limite de tamanho + disco local configurável, com uma linha
de metadados gravada pelo repository. Ver
docs/central-treinamentos/01-plano-tecnico.md §3."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, status

from .helpers import normalize_text
from .public_candidacy import generate_public_token

_OOXML_ZIP_MAGIC = b"PK\x03\x04"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"
_MP4_MAGIC_OFFSET_4 = b"ftyp"  # bytes 4-8 de um MP4/MOV válido
_WEBM_MAGIC = b"\x1a\x45\xdf\xa3"

CATEGORIA_PPTX = "pptx"
CATEGORIA_VIDEO = "video"
CATEGORIA_DOCUMENTO = "documento"
CATEGORIA_IMAGEM = "imagem"

_ALLOWED_EXTENSIONS: dict[str, set[str]] = {
    CATEGORIA_PPTX: {".pptx"},
    CATEGORIA_VIDEO: {".mp4", ".webm"},
    CATEGORIA_DOCUMENTO: {".pdf", ".doc", ".docx"},
    CATEGORIA_IMAGEM: {".png", ".jpg", ".jpeg"},
}

_MIME_BY_EXTENSION: dict[str, str] = {
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


@dataclass(frozen=True)
class ValidatedTrainingUpload:
    original_filename: str
    stored_filename: str
    extension: str
    mime_type: str
    size_bytes: int
    content_bytes: bytes


def _extension_of(filename: str) -> str:
    return "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _has_valid_magic_bytes(extension: str, content: bytes) -> bool:
    if extension == ".pptx" or extension == ".docx":
        return content.startswith(_OOXML_ZIP_MAGIC)
    if extension == ".doc":
        return content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    if extension == ".pdf":
        return content.startswith(b"%PDF")
    if extension == ".png":
        return content.startswith(_PNG_MAGIC)
    if extension in (".jpg", ".jpeg"):
        return content.startswith(_JPEG_MAGIC)
    if extension == ".mp4":
        return content[4:8] == _MP4_MAGIC_OFFSET_4
    if extension == ".webm":
        return content.startswith(_WEBM_MAGIC)
    return False


def validate_training_upload(
    *,
    original_filename: str,
    content: bytes,
    categoria: str,
    max_bytes: int,
) -> ValidatedTrainingUpload:
    safe_filename = normalize_text(original_filename) or "arquivo"
    extension = _extension_of(safe_filename)
    allowed = _ALLOWED_EXTENSIONS.get(categoria, set())

    if extension not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Extensão não permitida para este tipo de arquivo (aceitas: {', '.join(sorted(allowed))}).",
        )
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo vazio.")
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Arquivo maior que o limite permitido ({max_bytes // (1024 * 1024)} MB).",
        )
    if not _has_valid_magic_bytes(extension, content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O conteúdo do arquivo não corresponde à extensão informada.",
        )

    stored_filename = f"{generate_public_token(12)}{extension}"
    return ValidatedTrainingUpload(
        original_filename=safe_filename,
        stored_filename=stored_filename,
        extension=extension,
        mime_type=_MIME_BY_EXTENSION.get(extension, "application/octet-stream"),
        size_bytes=len(content),
        content_bytes=content,
    )


def save_training_upload(upload: ValidatedTrainingUpload, *, upload_dir: str, subpasta: str) -> Path:
    storage_root = Path(upload_dir) / subpasta
    storage_root.mkdir(parents=True, exist_ok=True)
    stored_path = storage_root / upload.stored_filename
    stored_path.write_bytes(upload.content_bytes)
    return stored_path

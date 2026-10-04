"""Armazenamento de anexos dos Chamados.

O banco guarda só metadados; o arquivo fica FORA do banco, atrás de `StorageProvider`, para trocar de provedor
(SharePoint/Graph, bucket S3) sem mexer no módulo. Hoje há um provedor: disco local, na mesma árvore dos demais uploads do
Conecta (coberta pela rotina de backup existente). O download sempre passa pela API, que checa o acesso ao chamado.
"""

from __future__ import annotations

import hashlib
import io
import os
import uuid
import zipfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException, status

SUBPASTA = "chamados"

_PNG = b"\x89PNG\r\n\x1a\n"
_JPG = b"\xff\xd8\xff"
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# extensão -> (mime, verificador do conteúdo). O tipo é validado pelo CONTEÚDO, nunca só pela extensão.
def _zip_com(prefixo: str):
    def verificar(c: bytes) -> bool:
        if not c.startswith(b"PK\x03\x04"):
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(c)) as z:
                return any(n.startswith(prefixo) for n in z.namelist())
        except zipfile.BadZipFile:
            return False

    return verificar


def _texto(c: bytes) -> bool:
    if b"\x00" in c[:8192]:
        return False
    try:
        c[:8192].decode("utf-8")
        return True
    except UnicodeDecodeError:
        try:
            c[:8192].decode("latin-1")
            return True
        except UnicodeDecodeError:
            return False


TIPOS: dict[str, tuple[str, object]] = {
    ".png": ("image/png", lambda c: c.startswith(_PNG)),
    ".jpg": ("image/jpeg", lambda c: c.startswith(_JPG)),
    ".jpeg": ("image/jpeg", lambda c: c.startswith(_JPG)),
    ".gif": ("image/gif", lambda c: c[:4] == b"GIF8"),
    ".webp": ("image/webp", lambda c: c[:4] == b"RIFF" and c[8:12] == b"WEBP"),
    ".mp4": ("video/mp4", lambda c: c[4:8] == b"ftyp"),
    ".mov": ("video/quicktime", lambda c: c[4:8] == b"ftyp"),
    ".webm": ("video/webm", lambda c: c.startswith(b"\x1a\x45\xdf\xa3")),
    ".pdf": ("application/pdf", lambda c: c.startswith(b"%PDF")),
    ".doc": ("application/msword", lambda c: c.startswith(_OLE)),
    ".xls": ("application/vnd.ms-excel", lambda c: c.startswith(_OLE)),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", _zip_com("word/")),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", _zip_com("xl/")),
    ".txt": ("text/plain", _texto),
}
# Tipos que o navegador pode exibir inline sem risco; o resto sempre baixa como anexo.
MIMES_INLINE = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "video/mp4", "video/webm"})


@dataclass(frozen=True)
class AnexoValidado:
    nome_original: str
    extensao: str
    mime: str
    tamanho: int
    sha256: str
    conteudo: bytes


def validar_anexo(nome: str, conteudo: bytes, *, max_bytes: int) -> AnexoValidado:
    nome_limpo = os.path.basename(str(nome or "").replace("\\", "/")).strip() or "arquivo"
    ext = os.path.splitext(nome_limpo)[1].lower()
    if ext not in TIPOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Tipo de arquivo não permitido ({', '.join(sorted(TIPOS))}).")
    if not conteudo:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Arquivo vazio.")
    if len(conteudo) > max_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Arquivo maior que o limite de {max_bytes // (1024 * 1024)} MB.")
    mime, verificador = TIPOS[ext]
    if not verificador(conteudo):  # type: ignore[operator]
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O conteúdo do arquivo não corresponde à extensão informada.")
    return AnexoValidado(nome_limpo[:255], ext, mime, len(conteudo), hashlib.sha256(conteudo).hexdigest(), conteudo)


def nova_chave(extensao: str, agora: datetime | None = None) -> str:
    """Nome interno único (UUID); o nome original fica só nos metadados."""
    agora = agora or datetime.now(timezone.utc)
    return f"{agora:%Y}/{agora:%m}/{uuid.uuid4().hex}{extensao}"


class StorageProvider(ABC):
    nome = "abstrato"

    @abstractmethod
    def put(self, chave: str, conteudo: bytes) -> None: ...

    @abstractmethod
    def open(self, chave: str) -> BinaryIO: ...

    @abstractmethod
    def delete(self, chave: str) -> None: ...

    @abstractmethod
    def exists(self, chave: str) -> bool: ...


class LocalStorageProvider(StorageProvider):
    nome = "local"

    def __init__(self, raiz: str | Path):
        self.raiz = Path(raiz)

    def _caminho(self, chave: str) -> Path:
        destino = (self.raiz / chave).resolve()
        if self.raiz.resolve() not in destino.parents:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caminho de arquivo inválido.")
        return destino

    def put(self, chave: str, conteudo: bytes) -> None:
        destino = self._caminho(chave)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(conteudo)

    def open(self, chave: str) -> BinaryIO:
        caminho = self._caminho(chave)
        if not caminho.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")
        return open(caminho, "rb")

    def delete(self, chave: str) -> None:
        caminho = self._caminho(chave)
        if caminho.exists():
            caminho.unlink()

    def exists(self, chave: str) -> bool:
        return self._caminho(chave).exists()


def provider_padrao(settings) -> StorageProvider:
    """Pasta própria (`RH_CHAMADOS_UPLOAD_DIR`) ou, por padrão, a subpasta `chamados` dos uploads do Conecta."""
    raiz = os.getenv("RH_CHAMADOS_UPLOAD_DIR", "").strip() or str(Path(settings.training_upload_dir) / SUBPASTA)
    return LocalStorageProvider(raiz)

from __future__ import annotations

from fastapi import HTTPException, status

from ..services.helpers import normalize_text, rows_to_dicts
from .bootstrap import ensure_documentos_biblioteca_table

_COLUNAS = """
    id_documento,
    titulo,
    topico,
    area,
    descricao,
    url_arquivo,
    ativo,
    criado_por,
    criado_em,
    atualizado_em
"""


class DocumentosBibliotecaRepositoryMixin:
    """Central de Documentos: biblioteca de arquivos de referência (links), organizados por tópico/área."""

    def list_documentos_biblioteca(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_documentos_biblioteca_table(cursor)
            cursor.execute(
                f"""
                SELECT {_COLUNAS}
                FROM documentos_biblioteca
                ORDER BY topico ASC, titulo ASC
                """
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def get_documento_biblioteca(self, id_documento: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_documentos_biblioteca_table(cursor)
            cursor.execute(
                f"SELECT {_COLUNAS} FROM documentos_biblioteca WHERE id_documento = ?",
                (int(id_documento or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento não encontrado.")
            return rows[0]
        finally:
            conn.close()

    @staticmethod
    def _validate_documento_input(data: dict) -> tuple[str, str, str, str, str, bool]:
        titulo = normalize_text(data.get("titulo"))
        if not titulo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o título do documento.")
        topico = normalize_text(data.get("topico"))
        if not topico:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o tópico do documento.")
        area = normalize_text(data.get("area"))
        descricao = normalize_text(data.get("descricao"))
        url_arquivo = str(data.get("url_arquivo") or "").strip()
        if not url_arquivo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o link do arquivo.")
        ativo = bool(data.get("ativo", True))
        return titulo, topico, area, descricao, url_arquivo, ativo

    def create_documento_biblioteca(self, data: dict, *, actor: str = "") -> dict:
        titulo, topico, area, descricao, url_arquivo, ativo = self._validate_documento_input(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_documentos_biblioteca_table(cursor)
            cursor.execute(
                """
                INSERT INTO documentos_biblioteca
                (titulo, topico, area, descricao, url_arquivo, ativo, criado_por, criado_em, atualizado_em)
                OUTPUT INSERTED.id_documento
                VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                """,
                (titulo, topico, area or None, descricao or None, url_arquivo, 1 if ativo else 0, actor or None),
            )
            inserted = cursor.fetchone()
            id_documento = int(inserted[0] or 0)
            conn.commit()
        finally:
            conn.close()

        return self.get_documento_biblioteca(id_documento)

    def update_documento_biblioteca(self, id_documento: int, data: dict, *, actor: str = "") -> dict:
        titulo, topico, area, descricao, url_arquivo, ativo = self._validate_documento_input(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_documentos_biblioteca_table(cursor)

            cursor.execute("SELECT id_documento FROM documentos_biblioteca WHERE id_documento = ?", (int(id_documento or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento não encontrado.")

            cursor.execute(
                """
                UPDATE documentos_biblioteca
                SET titulo = ?, topico = ?, area = ?, descricao = ?, url_arquivo = ?, ativo = ?, atualizado_em = GETDATE()
                WHERE id_documento = ?
                """,
                (titulo, topico, area or None, descricao or None, url_arquivo, 1 if ativo else 0, int(id_documento or 0)),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_documento_biblioteca(id_documento)

    def delete_documento_biblioteca(self, id_documento: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_documentos_biblioteca_table(cursor)

            cursor.execute("SELECT id_documento FROM documentos_biblioteca WHERE id_documento = ?", (int(id_documento or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento não encontrado.")

            cursor.execute("DELETE FROM documentos_biblioteca WHERE id_documento = ?", (int(id_documento or 0),))
            conn.commit()
        finally:
            conn.close()

        return {"success": True}

from __future__ import annotations

from fastapi import HTTPException, status

from ..services.helpers import normalize_text, rows_to_dicts
from .bootstrap import ensure_policies_tables

_POLICY_COLUMNS = """
    id_politica,
    titulo,
    corpo_texto,
    versao,
    ativo,
    criado_por,
    atualizado_por,
    criado_em,
    atualizado_em
"""


class PolicyRepositoryMixin:
    """Políticas institucionais (LGPD, código de conduta, etc.) e confirmações de leitura."""

    def list_policies(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_policies_tables(cursor)
            cursor.execute(
                f"""
                SELECT {_POLICY_COLUMNS}
                FROM politicas
                ORDER BY criado_em DESC, id_politica DESC
                """
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def get_policy(self, id_politica: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_policies_tables(cursor)
            cursor.execute(
                f"""
                SELECT {_POLICY_COLUMNS}
                FROM politicas
                WHERE id_politica = ?
                """,
                (int(id_politica or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Política não encontrada.")
            return rows[0]
        finally:
            conn.close()

    def create_policy(self, data: dict, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_policies_tables(cursor)

            titulo = normalize_text(data.get("titulo"))
            corpo_texto = str(data.get("corpo_texto") or "").strip()
            if not titulo or not corpo_texto:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Informe o título e o texto da política.",
                )

            ativo = bool(data.get("ativo", True))
            if ativo:
                cursor.execute("UPDATE politicas SET ativo = 0 WHERE ativo = 1")

            cursor.execute(
                """
                SELECT ISNULL(MAX(versao), 0) + 1 FROM politicas
                """
            )
            versao_row = cursor.fetchone()
            versao = int(versao_row[0] if versao_row else 1)

            cursor.execute(
                """
                INSERT INTO politicas
                (titulo, corpo_texto, versao, ativo, criado_por, atualizado_por, criado_em, atualizado_em)
                OUTPUT INSERTED.id_politica
                VALUES (?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                """,
                (
                    titulo,
                    corpo_texto,
                    versao,
                    1 if ativo else 0,
                    normalize_text(actor),
                    normalize_text(actor),
                ),
            )
            inserted = cursor.fetchone()
            id_politica = int(inserted[0] or 0)
            conn.commit()
        finally:
            conn.close()

        return self.get_policy(id_politica)

    def update_policy(self, id_politica: int, data: dict, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_policies_tables(cursor)

            cursor.execute("SELECT id_politica FROM politicas WHERE id_politica = ?", (int(id_politica or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Política não encontrada.")

            titulo = normalize_text(data.get("titulo"))
            corpo_texto = str(data.get("corpo_texto") or "").strip()
            if not titulo or not corpo_texto:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Informe o título e o texto da política.",
                )
            ativo = bool(data.get("ativo", True))

            # Reativar uma política automaticamente cria uma nova versão pendente de
            # confirmação para todos os usuários (a tabela de confirmações não é
            # apagada, então basta trocar a versão para invalidar leituras antigas).
            cursor.execute("SELECT versao FROM politicas WHERE id_politica = ?", (int(id_politica or 0),))
            versao_row = cursor.fetchone()
            nova_versao = int((versao_row[0] if versao_row else 0) or 0) + 1

            if ativo:
                cursor.execute("UPDATE politicas SET ativo = 0 WHERE ativo = 1 AND id_politica <> ?", (int(id_politica or 0),))

            cursor.execute(
                """
                UPDATE politicas
                SET
                    titulo = ?,
                    corpo_texto = ?,
                    versao = ?,
                    ativo = ?,
                    atualizado_por = ?,
                    atualizado_em = GETDATE()
                WHERE id_politica = ?
                """,
                (
                    titulo,
                    corpo_texto,
                    nova_versao,
                    1 if ativo else 0,
                    normalize_text(actor),
                    int(id_politica or 0),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_policy(id_politica)

    def get_pending_policy_for_user(self, *, id_usuario: int | None, usuario_login: str) -> dict | None:
        """Retorna a política ativa mais recente que o usuário ainda não confirmou."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_policies_tables(cursor)

            cursor.execute(
                f"""
                SELECT TOP 1 {_POLICY_COLUMNS}
                FROM politicas
                WHERE ativo = 1
                ORDER BY criado_em DESC, id_politica DESC
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                return None
            politica = rows[0]

            safe_login = normalize_text(usuario_login)
            if not safe_login:
                return politica

            cursor.execute(
                """
                SELECT TOP 1 versao_confirmada
                FROM politicas_confirmacoes
                WHERE id_politica = ? AND usuario_login = ?
                """,
                (int(politica.get("id_politica") or 0), safe_login),
            )
            confirmacao = cursor.fetchone()
            versao_confirmada = int(confirmacao[0]) if confirmacao and confirmacao[0] is not None else 0
            if versao_confirmada >= int(politica.get("versao") or 1):
                return None
            return politica
        finally:
            conn.close()

    def confirm_policy_reading(
        self,
        id_politica: int,
        *,
        id_usuario: int | None,
        usuario_login: str,
        usuario_nome: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_policies_tables(cursor)

            cursor.execute("SELECT versao FROM politicas WHERE id_politica = ?", (int(id_politica or 0),))
            politica_row = cursor.fetchone()
            if not politica_row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Política não encontrada.")
            versao_atual = int(politica_row[0] or 1)

            safe_login = normalize_text(usuario_login)
            if not safe_login:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Usuário não identificado para confirmar a leitura.",
                )

            cursor.execute(
                """
                SELECT id_confirmacao, versao_confirmada
                FROM politicas_confirmacoes
                WHERE id_politica = ? AND usuario_login = ?
                """,
                (int(id_politica or 0), safe_login),
            )
            existente = cursor.fetchone()
            if existente:
                ja_confirmado = int(existente[1] or 0) >= versao_atual
                cursor.execute(
                    """
                    UPDATE politicas_confirmacoes
                    SET versao_confirmada = ?, id_usuario = ?, usuario_nome = ?, confirmado_em = GETDATE()
                    WHERE id_confirmacao = ?
                    """,
                    (
                        versao_atual,
                        int(id_usuario) if id_usuario else None,
                        normalize_text(usuario_nome),
                        int(existente[0]),
                    ),
                )
                conn.commit()
                return {"success": True, "ja_confirmado": ja_confirmado}

            cursor.execute(
                """
                INSERT INTO politicas_confirmacoes
                (id_politica, id_usuario, usuario_login, usuario_nome, versao_confirmada, confirmado_em)
                VALUES (?, ?, ?, ?, ?, GETDATE())
                """,
                (
                    int(id_politica or 0),
                    int(id_usuario) if id_usuario else None,
                    safe_login,
                    normalize_text(usuario_nome),
                    versao_atual,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return {"success": True, "ja_confirmado": False}

from __future__ import annotations

import json
import logging
import math
import re
from datetime import datetime

from fastapi import HTTPException, status

from ..services.helpers import (
    normalize_compare_text,
    normalize_text,
    parse_float_br,
    rows_to_dicts,
)
from .bootstrap import (
    ensure_decimal_process_columns,
    ensure_process_reference_columns,
    get_gabaritos_payload_column,
)

logger = logging.getLogger(__name__)


class HistoryRepositoryMixin:
    @staticmethod
    def _normalize_column_lookup(columns_meta) -> dict[str, dict]:
        result = {}
        for column in columns_meta:
            safe_name = normalize_text(getattr(column, "column_name", ""))
            if safe_name:
                result[normalize_compare_text(safe_name)] = {
                    "column_name": safe_name,
                    "data_type": normalize_compare_text(getattr(column, "type_name", "")),
                    "max_length": int(getattr(column, "column_size", 0) or 0),
                    "is_nullable": bool(getattr(column, "nullable", True)),
                }
        return result

    @staticmethod
    def _resolve_history_column(column_lookup: dict[str, dict], *aliases: str) -> dict:
        for alias in aliases:
            resolved = column_lookup.get(normalize_compare_text(alias))
            if resolved:
                return resolved
        return {}

    @staticmethod
    def _is_identity_history_column(cursor, column_name: str) -> bool:
        safe_column = normalize_text(column_name)
        if not safe_column:
            return False

        cursor.execute(
            """
            SELECT CONVERT(INT, COLUMNPROPERTY(OBJECT_ID('dbo.historico_provas'), ?, 'IsIdentity'))
            """,
            (safe_column,),
        )
        row = cursor.fetchone()
        return bool(int(row[0] or 0)) if row else False

    @staticmethod
    def _is_integer_history_type(data_type: str) -> bool:
        return normalize_compare_text(data_type) in {
            "int",
            "bigint",
            "smallint",
            "tinyint",
            "bit",
        }

    @staticmethod
    def _is_decimal_history_type(data_type: str) -> bool:
        return normalize_compare_text(data_type) in {
            "decimal",
            "numeric",
            "float",
            "real",
            "money",
            "smallmoney",
        }

    @staticmethod
    def _preview_history_value(value, *, max_chars: int = 140):
        if value is None:
            return None

        safe_text = normalize_text(value)
        if len(safe_text) <= max_chars:
            return safe_text

        return f"{safe_text[:max_chars]}..."

    @staticmethod
    def _truncate_history_text(value, max_length: int) -> str:
        safe_value = normalize_text(value)
        if max_length <= 0 or len(safe_value) <= max_length:
            return safe_value
        return safe_value[:max_length]

    @staticmethod
    def _coerce_history_int(raw_value):
        if raw_value in (None, ""):
            return None

        if isinstance(raw_value, bool):
            return int(raw_value)

        if isinstance(raw_value, int):
            return raw_value

        text = normalize_text(raw_value)
        if re.fullmatch(r"[-+]?\d+", text):
            return int(text)

        try:
            numeric = float(text.replace(",", "."))
        except Exception:
            return None

        if not numeric.is_integer():
            return None

        return int(numeric)

    @staticmethod
    def _escape_history_identifier(value: str) -> str:
        return normalize_text(value).replace("]", "]]")

    def _get_next_history_numeric_value(self, cursor, column_name: str) -> int:
        safe_column = self._escape_history_identifier(column_name)
        cursor.execute(f"SELECT ISNULL(MAX([{safe_column}]), 0) + 1 FROM historico_provas")
        row = cursor.fetchone()
        return int(row[0] or 1) if row else 1

    def _is_identity_column(self, cursor, table_name: str, column_name: str) -> bool:
        safe_table = normalize_text(table_name)
        safe_column = normalize_text(column_name)
        if not safe_table or not safe_column:
            return False

        cursor.execute(
            """
            SELECT CONVERT(INT, COLUMNPROPERTY(OBJECT_ID(?), ?, 'IsIdentity'))
            """,
            (f"dbo.{safe_table}", safe_column),
        )
        row = cursor.fetchone()
        return bool(int(row[0] or 0)) if row else False

    def _get_next_numeric_value(self, cursor, table_name: str, column_name: str) -> int:
        safe_table = self._escape_history_identifier(table_name)
        safe_column = self._escape_history_identifier(column_name)
        cursor.execute(f"SELECT ISNULL(MAX([{safe_column}]), 0) + 1 FROM dbo.[{safe_table}]")
        row = cursor.fetchone()
        return int(row[0] or 1) if row else 1

    def _prepare_history_value(self, cursor, alias: str, column_meta: dict, raw_value):
        data_type = normalize_compare_text(column_meta.get("data_type"))
        column_name = normalize_text(column_meta.get("column_name"))
        is_nullable = bool(column_meta.get("is_nullable", True))
        max_length = int(column_meta.get("max_length", 0) or 0)

        if self._is_integer_history_type(data_type):
            coerced = self._coerce_history_int(raw_value)
            if coerced is not None:
                return coerced
            if alias == "codigo":
                return self._get_next_history_numeric_value(cursor, column_name)
            if raw_value in (None, "") and is_nullable:
                return None
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"O campo '{alias}' precisa ser numerico para ser gravado na coluna "
                    f"'{column_name}' ({data_type}). Valor recebido: {self._preview_history_value(raw_value)}"
                ),
            )

        if self._is_decimal_history_type(data_type):
            if raw_value in (None, "") and is_nullable:
                return None
            return parse_float_br(raw_value)

        safe_text = normalize_text(raw_value)
        if alias == "codigo" and not safe_text:
            safe_text = f"HIST-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        return self._truncate_history_text(safe_text, max_length)

    def get_history_columns(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT
                    c.name AS column_name,
                    t.name AS data_type,
                    c.max_length,
                    c.is_nullable,
                    c.is_identity,
                    c.column_id
                FROM sys.columns c
                JOIN sys.types t ON c.user_type_id = t.user_type_id
                WHERE c.object_id = OBJECT_ID('dbo.historico_provas')
                ORDER BY c.column_id
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            return {
                "table": "dbo.historico_provas",
                "columns": [
                    {
                        "column_name": normalize_text(row.get("column_name")),
                        "data_type": normalize_text(row.get("data_type")),
                        "max_length": int(row.get("max_length") or 0),
                        "is_nullable": bool(row.get("is_nullable")),
                        "is_identity": bool(row.get("is_identity")),
                        "column_id": int(row.get("column_id") or 0),
                    }
                    for row in rows
                ],
            }
        finally:
            conn.close()

    def get_gabaritos_columns(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            columns = [col.column_name for col in cursor.columns(table="gabaritos")]
            return {"columns": columns}
        finally:
            conn.close()

    def list_history(self, page: int | None = None, page_size: int = 10, nome: str = "", vaga: str = "", data: str = ""):
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_reference_columns(cursor)
            ensure_decimal_process_columns(cursor)
            filters = []
            params = []

            if normalize_text(nome):
                filters.append("nome_candidato LIKE ?")
                params.append(f"%{nome.strip()}%")
            if normalize_text(vaga):
                filters.append("vaga LIKE ?")
                params.append(f"%{vaga.strip()}%")
            if normalize_text(data):
                filters.append("data_iso LIKE ?")
                params.append(f"{data.strip()}%")

            base_select = """
                SELECT
                    id_teste,
                    id_processo,
                    id_processo_ref,
                    nome_candidato,
                    vaga,
                    nivel,
                    trilha,
                    data_iso,
                    data_exibicao,
                    pontuacao_final,
                    status,
                    tempo_minutos,
                    arquivo_gabarito,
                    etapas_json
                FROM historico_provas
            """

            where_clause = f" WHERE {' AND '.join(filters)}" if filters else ""
            if page is None and not filters:
                cursor.execute(base_select)
                return rows_to_dicts(cursor, cursor.fetchall())

            page_safe = max(1, int(page or 1))
            page_size_safe = self._clamp_limit(page_size, default=10, maximum=100)
            offset = (page_safe - 1) * page_size_safe

            cursor.execute(f"SELECT COUNT(*) FROM historico_provas{where_clause}", tuple(params))
            total_items = int(cursor.fetchone()[0] or 0)

            order_clause = " ORDER BY data_iso DESC, id_teste DESC"
            pagination_clause = " OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
            cursor.execute(
                f"{base_select}{where_clause}{order_clause}{pagination_clause}",
                tuple(params + [offset, page_size_safe]),
            )
            items = rows_to_dicts(cursor, cursor.fetchall())
            total_pages = max(1, math.ceil(total_items / page_size_safe))
            return {
                "items": items,
                "page": page_safe,
                "page_size": page_size_safe,
                "total_items": total_items,
                "total_pages": total_pages,
            }
        finally:
            conn.close()

    def save_history(self, row: dict, raw_payload: dict | None = None) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_reference_columns(cursor)
            ensure_decimal_process_columns(cursor)
            columns_meta = list(cursor.columns(table="historico_provas", schema="dbo"))
            column_lookup = self._normalize_column_lookup(columns_meta)
            if not column_lookup:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Não foi possível identificar as colunas da tabela historico_provas.",
                )

            id_teste = normalize_text(row.get("id_teste"))
            arquivo_gabarito = normalize_text(row.get("arquivo_gabarito")) or normalize_text(
                row.get("pontuacao_bruta"),
            )

            payload = {
                "id_teste": id_teste,
                "id_processo": normalize_text(row.get("id_processo")),
                "id_processo_ref": normalize_text(row.get("id_processo_ref")),
                "nome_candidato": normalize_text(row.get("nome_candidato")),
                "vaga": normalize_text(row.get("vaga")),
                "nivel": normalize_text(row.get("nivel")),
                "trilha": normalize_text(row.get("trilha")),
                "data_iso": normalize_text(row.get("data_iso")),
                "data_exibicao": normalize_text(row.get("data_exibicao")),
                "pontuacao_final": row.get("pontuacao_final", 0),
                "status": normalize_text(row.get("status")),
                "tempo_minutos": row.get("tempo_minutos", 0),
                "arquivo_gabarito": arquivo_gabarito,
                "etapas_json": normalize_text(row.get("etapas_json")),
            }

            code_column = self._resolve_history_column(
                column_lookup,
                "Código",
                "Codigo",
                "codigo",
            )
            code_column_name = normalize_text(code_column.get("column_name"))
            include_code_column = bool(code_column_name) and not self._is_identity_history_column(
                cursor,
                code_column_name,
            )

            ordered_columns = []
            values = []
            if include_code_column:
                ordered_columns.append(code_column_name)
                values.append(
                    self._prepare_history_value(
                        cursor,
                        "codigo",
                        code_column,
                        normalize_text(row.get("Codigo"))
                        or normalize_text(row.get("codigo"))
                        or id_teste,
                    )
                )

            for alias in (
                "id_teste",
                "id_processo",
                "id_processo_ref",
                "nome_candidato",
                "vaga",
                "nivel",
                "trilha",
                "data_iso",
                "data_exibicao",
                "pontuacao_final",
                "status",
                "tempo_minutos",
                "arquivo_gabarito",
                "etapas_json",
            ):
                column_meta = self._resolve_history_column(column_lookup, alias)
                column_name = normalize_text(column_meta.get("column_name"))
                if not column_name:
                    continue
                ordered_columns.append(column_name)
                values.append(
                    self._prepare_history_value(
                        cursor,
                        alias,
                        column_meta,
                        payload.get(alias, payload.get(column_name, "")),
                    )
                )

            if not ordered_columns:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Nenhuma coluna válida foi encontrada para gravar o histórico da prova.",
                )

            if self.settings.is_development:
                logger.info(
                    "Historico preparado para insert. raw=%s parsed=%s columns=%s",
                    json.dumps(
                        {
                            key: self._preview_history_value(value)
                            for key, value in (raw_payload or {}).items()
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            key: self._preview_history_value(value)
                            for key, value in payload.items()
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        [
                            {
                                "column": column_name,
                                "value": self._preview_history_value(values[index]),
                            }
                            for index, column_name in enumerate(ordered_columns)
                        ],
                        ensure_ascii=False,
                    ),
                )

            placeholders = ", ".join(["?"] * len(ordered_columns))
            columns_sql = ",\n                    ".join(f"[{column}]" for column in ordered_columns)
            cursor.execute(
                f"""
                INSERT INTO historico_provas
                (
                    {columns_sql}
                )
                VALUES ({placeholders})
                """,
                tuple(values),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def get_answer_files(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            payload_column = get_gabaritos_payload_column(cursor)
            cursor.execute(f"SELECT record_id, {payload_column} FROM gabaritos")
            rows = cursor.fetchall()
            result = {}
            for row in rows:
                result[str(row[0])] = {"content": row[1]}
            return result
        finally:
            conn.close()

    def save_answer_file(self, data: dict) -> dict:
        record_id = normalize_text(data.get("recordId"))
        payload = data.get("payload")
        if not record_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="recordId é obrigatório.")

        payload_text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            payload_column = get_gabaritos_payload_column(cursor)
            payload_column_sql = f"[{self._escape_history_identifier(payload_column)}]"

            cursor.execute("SELECT COUNT(*) FROM dbo.gabaritos WHERE record_id = ?", (record_id,))
            exists = int(cursor.fetchone()[0] or 0)

            if exists:
                cursor.execute(
                    f"UPDATE dbo.gabaritos SET {payload_column_sql} = ? WHERE record_id = ?",
                    (payload_text, record_id),
                )
            else:
                columns_meta = list(cursor.columns(table="gabaritos", schema="dbo"))
                column_lookup = self._normalize_column_lookup(columns_meta)

                code_column = self._resolve_history_column(
                    column_lookup,
                    "Código",
                    "Codigo",
                    "codigo",
                )
                code_column_name = normalize_text(code_column.get("column_name"))

                include_code_column = bool(code_column_name) and not self._is_identity_column(
                    cursor,
                    "gabaritos",
                    code_column_name,
                )

                if include_code_column:
                    code_column_sql = f"[{self._escape_history_identifier(code_column_name)}]"
                    next_code = self._get_next_numeric_value(cursor, "gabaritos", code_column_name)

                    cursor.execute(
                        f"""
                        INSERT INTO dbo.gabaritos
                        (
                            {code_column_sql},
                            record_id,
                            {payload_column_sql}
                        )
                        VALUES (?, ?, ?)
                        """,
                        (next_code, record_id, payload_text),
                    )
                else:
                    cursor.execute(
                        f"""
                        INSERT INTO dbo.gabaritos
                        (
                            record_id,
                            {payload_column_sql}
                        )
                        VALUES (?, ?)
                        """,
                        (record_id, payload_text),
                    )

            conn.commit()
            return {"success": True}
        finally:
            conn.close()

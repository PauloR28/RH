from __future__ import annotations

import base64
import json
import logging
import math
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

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
    is_valid_email,
    is_valid_phone,
    normalize_cv_text,
    score_cv_for_role,
    serialize_cv_problems,
)
from ..services.helpers import (
    normalize_compare_text,
    normalize_indication_type,
    normalize_text,
    rows_to_dicts,
)
from ..services.process_flow import (
    CANDIDATE_STATUS_TALENT_BANK,
    build_process_closed_message,
    canonicalize_candidate_status,
    is_process_closed,
    map_cv_classification_to_status,
)
from ..services.public_candidacy import validate_public_cv_upload
from .bootstrap import (
    ensure_candidate_attachments_table,
    ensure_cv_pre_analises_table,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    get_process_row,
    insert_candidate_process_record,
    resolve_process_row_for_related_record,
)

logger = logging.getLogger(__name__)


class CvAnalysisRepositoryMixin:
    @staticmethod
    def _phone_tokens(*values: str | None) -> set[str]:
        tokens = {
            "".join(char for char in normalize_text(value) if char.isdigit())
            for value in values
        }
        tokens.discard("")
        return tokens

    def _find_process_candidate_by_identity(
        self,
        cursor,
        processo: dict,
        *,
        id_teste: str = "",
        email: str = "",
        telefone: str = "",
        whatsapp: str = "",
    ) -> dict | None:
        process_id = normalize_text(processo.get("id_processo"))
        process_ref = normalize_text(processo.get("id_processo_ref"))
        candidate_id = normalize_text(id_teste)
        candidate_email = normalize_compare_text(email)
        candidate_phones = self._phone_tokens(telefone, whatsapp)

        cursor.execute(
            """
            SELECT
                cp.id_registro,
                cp.id_processo,
                cp.id_processo_ref,
                cp.id_teste,
                cp.nome_candidato,
                cp.status_candidato,
                meta.email,
                meta.telefone,
                meta.whatsapp
            FROM candidatos_processos cp
            LEFT JOIN candidatos_metadata meta
                ON meta.id_teste = cp.id_teste
            WHERE cp.id_processo = ?
              AND cp.id_processo_ref = ?
            ORDER BY cp.id_registro DESC
            """,
            (process_id, process_ref),
        )
        for candidate in rows_to_dicts(cursor, cursor.fetchall()):
            same_id = candidate_id and normalize_text(candidate.get("id_teste")) == candidate_id
            same_email = (
                candidate_email
                and normalize_compare_text(candidate.get("email")) == candidate_email
            )
            candidate_row_phones = self._phone_tokens(
                candidate.get("telefone"),
                candidate.get("whatsapp"),
            )
            same_phone = bool(candidate_phones & candidate_row_phones)

            if same_id or same_email or same_phone:
                return candidate

        return None

    def _annotate_pre_analysis_process_links(
        self,
        cursor,
        processo: dict,
        items: list[dict],
    ) -> None:
        for item in items:
            id_teste = f"CV-{item.get('id_pre_analise')}"
            linked = self._find_process_candidate_by_identity(
                cursor,
                processo,
                id_teste=id_teste,
                email=item.get("email"),
                telefone=item.get("telefone"),
                whatsapp=item.get("whatsapp"),
            )
            if not linked:
                continue

            linked_status = canonicalize_candidate_status(linked.get("status_candidato"))
            item["ja_adicionado_ao_processo"] = 1
            item["id_registro_processo"] = linked.get("id_registro")
            item["status_candidato_processo"] = linked_status
            item["situacao_pre_analise"] = (
                "Banco de Talentos"
                if linked_status == CANDIDATE_STATUS_TALENT_BANK
                else "Ja incluido no processo"
            )

    async def upload_candidate_profile_cv(self, id_teste: str, arquivo: UploadFile) -> dict:
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidato não informado.")

        content = await arquivo.read()
        upload = validate_public_cv_upload(
            arquivo.filename or "curriculo",
            arquivo.content_type or "",
            content,
        )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_candidate_attachments_table(cursor)
            ensure_process_reference_columns(cursor)
            if not self._candidate_sheet_exists(cursor, safe_id_teste):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado.")

            storage_root = self._get_storage_root()
            stored_path = storage_root / upload.stored_filename
            stored_path.write_bytes(upload.content_bytes)
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
                    safe_id_teste,
                    "",
                    "",
                    upload.original_filename,
                    upload.stored_filename,
                    upload.mime_type,
                    str(stored_path),
                    upload.size_bytes,
                ),
            )
            conn.commit()
            return {
                "success": True,
                "filename": upload.original_filename,
                "content_type": upload.mime_type,
                "size_bytes": upload.size_bytes,
            }
        finally:
            conn.close()

    def list_cv_pre_analyses(
        self,
        id_processo: str,
        page: int = 1,
        page_size: int = 5,
        *,
        nome: str = "",
        score_min: str = "",
        score_max: str = "",
        classificacao: str = "",
        incluir_ocultos: bool = False,
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            page_safe = max(1, int(page or 1))
            page_size_safe = self._clamp_limit(page_size, default=5, maximum=50)

            cursor.execute(
                """
                SELECT
                    id_pre_analise,
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
                    criado_em
                FROM cv_pre_analises
                WHERE id_processo = ?
                """,
                (processo.get("id_processo"),),
            )
            items = rows_to_dicts(cursor, cursor.fetchall())
            items = self._attach_process_context(cursor, items, timestamp_fields=["criado_em"])
            items = [
                item
                for item in items
                if normalize_text(item.get("id_processo_ref"))
                == normalize_text(processo.get("id_processo_ref"))
            ]
            classificacoes = sorted(
                {
                    normalize_text(item.get("classificacao"))
                    for item in items
                    if normalize_text(item.get("classificacao"))
                },
                key=normalize_compare_text,
            )
            if not incluir_ocultos:
                items = [item for item in items if int(item.get("oculto_na_lista") or 0) != 1]
            nome_filtro = normalize_compare_text(nome)
            if nome_filtro:
                items = [
                    item
                    for item in items
                    if nome_filtro in normalize_compare_text(item.get("nome_candidato"))
                ]
            try:
                min_score = float(str(score_min).replace(",", ".")) if normalize_text(score_min) else None
            except ValueError:
                min_score = None
            try:
                max_score = float(str(score_max).replace(",", ".")) if normalize_text(score_max) else None
            except ValueError:
                max_score = None
            if min_score is not None:
                items = [item for item in items if float(item.get("score_final") or 0) >= min_score]
            if max_score is not None:
                items = [item for item in items if float(item.get("score_final") or 0) <= max_score]
            classificacao_filtro = normalize_compare_text(classificacao)
            if classificacao_filtro:
                items = [
                    item
                    for item in items
                    if normalize_compare_text(item.get("classificacao")) == classificacao_filtro
                    or normalize_compare_text(item.get("classificacao_slug")) == classificacao_filtro
                ]
            self._annotate_pre_analysis_process_links(cursor, processo, items)
            if not incluir_ocultos:
                items = [
                    item
                    for item in items
                    if int(item.get("ja_adicionado_ao_processo") or 0) != 1
                ]
            items.sort(key=lambda item: int(item.get("id_pre_analise") or 0), reverse=True)
            total_items = len(items)
            offset = (page_safe - 1) * page_size_safe
            items = items[offset : offset + page_size_safe]
            total_pages = max(1, math.ceil(total_items / page_size_safe))
            return {
                "items": items,
                "page": page_safe,
                "page_size": page_size_safe,
                "total_items": total_items,
                "total_pages": total_pages,
                "classificacoes": classificacoes,
            }
        finally:
            conn.close()

    def clear_cv_pre_analyses_list(self, id_processo: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_process_reference_columns(cursor)
            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")

            cursor.execute(
                """
                UPDATE cv_pre_analises
                SET oculto_na_lista = 1
                WHERE id_processo = ?
                  AND id_processo_ref = ?
                  AND ISNULL(oculto_na_lista, 0) = 0
                """,
                (processo.get("id_processo"), processo.get("id_processo_ref", "")),
            )
            affected = cursor.rowcount if cursor.rowcount is not None else 0
            conn.commit()
            return {
                "success": True,
                "hidden": max(0, int(affected or 0)),
                "message": "Lista limpa sem excluir currículos, candidatos ou histórico.",
            }
        finally:
            conn.close()

    async def create_cv_pre_analysis(
        self,
        id_processo: str,
        arquivo: UploadFile,
        guardar_cv_original: str = "0",
    ) -> dict:
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
                    detail=build_process_closed_message("analisar CV neste processo", processo.get("id_processo")),
                )

            content = await arquivo.read()
            try:
                texto_extraido = extract_text_from_uploaded_file(
                    arquivo.filename,
                    content,
                    arquivo.content_type or "",
                )
            except CvTextExtractionError as exc:
                logger.exception(
                    "Falha ao extrair texto do CV: arquivo=%s mime=%s detalhe=%s",
                    arquivo.filename,
                    arquivo.content_type or "",
                    exc.technical_message,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=exc.user_message,
                ) from exc
            texto_normalizado = normalize_cv_text(texto_extraido)
            if not texto_normalizado:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Arquivo vazio ou corrompido.",
                )

            nome_detectado = extract_candidate_name_details(
                texto_normalizado,
                filename=arquivo.filename,
            )
            nome_candidato = nome_detectado.get("nome") or extract_candidate_name(
                texto_normalizado,
                filename=arquivo.filename,
            )
            email = extract_email(texto_normalizado)
            telefone = extract_phone(texto_normalizado)
            whatsapp = extract_whatsapp(texto_normalizado)
            palavras = extract_keywords(texto_normalizado)
            telefone_base = whatsapp or telefone

            if email:
                cursor.execute(
                    """
                    SELECT id_processo_ref
                    FROM cv_pre_analises
                    WHERE id_processo = ? AND email = ?
                    """,
                    (processo.get("id_processo"), email),
                )
                rows = rows_to_dicts(cursor, cursor.fetchall())
                ja_existe = any(
                    normalize_text(item.get("id_processo_ref")) == normalize_text(processo.get("id_processo_ref"))
                    for item in rows
                )
                if ja_existe:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Já existe uma pré-análise com este e-mail neste processo.")

            education_strength = extract_education_strength(texto_normalizado)
            experience_strength = extract_experience_strength(texto_normalizado)
            competencias = extract_competencies(texto_normalizado)
            experiencias = extract_professional_experiences(texto_normalizado)
            vaga_analise = (normalize_text(processo.get("vaga")) if processo else "") or "Banco de Talentos"
            avaliacao = score_cv_for_role(
                vaga_analise,
                palavras,
                bool(email),
                bool(telefone_base),
                len(texto_normalizado),
                nome_candidato,
                email,
                telefone_base,
                education_strength,
                experience_strength,
                nome_detectado.get("confianca", "baixa"),
                competencias,
                experiencias,
            )
            avaliacao["nome_detectado"] = nome_candidato
            avaliacao["confianca_nome"] = nome_detectado.get("confianca", "baixa")
            avaliacao["fonte_nome"] = nome_detectado.get("fonte", "")

            arquivo_original_base64 = None
            if normalize_compare_text(guardar_cv_original) in {"1", "true"}:
                arquivo_original_base64 = base64.b64encode(content).decode("utf-8")

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
                    origem
                )
                OUTPUT INSERTED.id_pre_analise
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    processo.get("id_processo"),
                    processo.get("id_processo_ref", ""),
                    nome_candidato,
                    email,
                    telefone,
                    whatsapp,
                    json.dumps(avaliacao["keywords_validas"], ensure_ascii=False),
                    avaliacao["score"],
                    avaliacao["classificacao"],
                    avaliacao["slug"],
                    serialize_cv_problems(avaliacao),
                    texto_normalizado,
                    arquivo.filename,
                    arquivo.content_type or "application/octet-stream",
                    arquivo_original_base64,
                    "Analise direta do CV",
                ),
            )
            id_pre_analise = int(cursor.fetchone()[0])

            if avaliacao["classificacao"] == "Qualificado":
                status_candidato = map_cv_classification_to_status(avaliacao["classificacao"])
                existing_candidate = self._find_process_candidate_by_identity(
                    cursor,
                    processo,
                    id_teste=f"CV-{id_pre_analise}",
                    email=email,
                    telefone=telefone,
                    whatsapp=whatsapp,
                )
                if not existing_candidate:
                    insert_candidate_process_record(
                        cursor,
                        processo,
                        {
                            "id_teste": f"CV-{id_pre_analise}",
                            "nome_candidato": nome_candidato,
                            "vaga": processo.get("vaga") or "",
                            "status_candidato": status_candidato,
                            "pontuacao_final": str(avaliacao["score"]).replace(".", ","),
                            "data_prova": datetime.now().isoformat(),
                            "origem": "Analise direta do CV",
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
                    nome_candidato=nome_candidato,
                )

            conn.commit()
            return {"success": True, "id_pre_analise": id_pre_analise}
        finally:
            conn.close()

    def update_cv_pre_analysis(self, id_pre_analise: int, data: dict) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_process_reference_columns(cursor)
            cursor.execute(
                """
                SELECT id_processo, id_processo_ref, nome_candidato, email, telefone, whatsapp, criado_em
                FROM cv_pre_analises
                WHERE id_pre_analise = ?
                """,
                (id_pre_analise,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pré-análise não encontrada.")
            row = rows[0]

            processo = resolve_process_row_for_related_record(
                cursor,
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref", ""),
                timestamp_values=[row.get("criado_em")],
            )
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado para a pré-análise.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("editar pré-análise de CV", processo.get("id_processo")),
                )
            novo_nome = normalize_text(data.get("nome_candidato"))
            if not novo_nome:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome do candidato.")

            novo_email = normalize_text(data.get("email")) or normalize_text(row.get("email"))
            if novo_email and not is_valid_email(novo_email):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um e-mail válido.")

            novo_telefone = normalize_text(data.get("telefone")) or normalize_text(row.get("telefone"))
            novo_whatsapp = normalize_text(data.get("whatsapp")) or normalize_text(row.get("whatsapp"))
            if novo_telefone and not is_valid_phone(novo_telefone):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um telefone válido.")
            if novo_whatsapp and not is_valid_phone(novo_whatsapp):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um WhatsApp válido.")

            if novo_email:
                cursor.execute(
                    """
                    SELECT id_processo_ref
                    FROM cv_pre_analises
                    WHERE id_processo = ? AND email = ? AND id_pre_analise <> ?
                    """,
                    (processo.get("id_processo"), novo_email, id_pre_analise),
                )
                existing_rows = rows_to_dicts(cursor, cursor.fetchall())
                duplicado = any(
                    normalize_text(item.get("id_processo_ref")) == normalize_text(processo.get("id_processo_ref"))
                    for item in existing_rows
                )
                if duplicado:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Já existe outra pré-análise com este e-mail neste processo.")

            cursor.execute(
                """
                UPDATE cv_pre_analises
                SET nome_candidato = ?, email = ?, telefone = ?, whatsapp = ?
                WHERE id_pre_analise = ?
                """,
                (
                    novo_nome,
                    novo_email,
                    novo_telefone,
                    novo_whatsapp,
                    id_pre_analise,
                ),
            )
            id_teste = f"CV-{id_pre_analise}"
            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=novo_nome,
                email=novo_email,
                telefone=novo_telefone,
                whatsapp=novo_whatsapp,
            )
            self._sync_candidate_identity_copies(
                cursor,
                id_teste=id_teste,
                nome_candidato=novo_nome,
                email=novo_email,
                telefone=novo_telefone,
                whatsapp=novo_whatsapp,
            )
            conn.commit()
            return {
                "success": True,
                "candidato": {
                    "id_teste": id_teste,
                    "nome_candidato": novo_nome,
                    "email": novo_email,
                    "telefone": novo_telefone,
                    "whatsapp": novo_whatsapp,
                },
            }
        finally:
            conn.close()

    def delete_cv_pre_analysis(self, id_pre_analise: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_process_reference_columns(cursor)
            cursor.execute(
                """
                SELECT id_processo, id_processo_ref, criado_em
                FROM cv_pre_analises
                WHERE id_pre_analise = ?
                """,
                (id_pre_analise,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pré-análise não encontrada.")
            row = rows[0]
            processo = resolve_process_row_for_related_record(
                cursor,
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref", ""),
                timestamp_values=[row.get("criado_em")],
            )
            if processo and is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("excluir pré-análise de CV", processo.get("id_processo")),
                )
            cursor.execute("DELETE FROM cv_pre_analises WHERE id_pre_analise = ?", (id_pre_analise,))
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def dismiss_cv_pre_analysis(self, id_pre_analise: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            cursor.execute(
                """
                SELECT id_pre_analise
                FROM cv_pre_analises
                WHERE id_pre_analise = ?
                """,
                (id_pre_analise,),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pré-análise não encontrada.")

            cursor.execute(
                """
                UPDATE cv_pre_analises
                SET oculto_na_lista = 1
                WHERE id_pre_analise = ?
                """,
                (id_pre_analise,),
            )
            conn.commit()
            return {
                "success": True,
                "message": "Pré-análise dispensada sem excluir currículo, análise ou histórico.",
            }
        finally:
            conn.close()

    def analyze_candidate_profile_cv(self, id_teste: str, id_processo: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)

            safe_id_teste = normalize_text(id_teste)
            if not safe_id_teste:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidato não informado.")

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
                    cp.pontuacao_final,
                    cp.data_prova,
                    cp.origem,
                    cp.etapa_pipeline,
                    cp.data_atualizacao_pipeline,
                    meta.email,
                    meta.telefone,
                    meta.whatsapp,
                    meta.nome_candidato AS nome_perfil,
                    anexo.nome_arquivo_original,
                    anexo.tipo_arquivo,
                    anexo.caminho_arquivo
                FROM candidatos_processos cp
                LEFT JOIN candidatos_metadata meta
                    ON meta.id_teste = cp.id_teste
                OUTER APPLY (
                    SELECT TOP 1
                        nome_arquivo_original,
                        tipo_arquivo,
                        caminho_arquivo
                    FROM candidatos_anexos
                    WHERE id_teste = cp.id_teste
                    ORDER BY criado_em DESC, id_anexo DESC
                ) anexo
                WHERE cp.id_teste = ?
                  AND (? = '' OR cp.id_processo = ? OR cp.id_processo_ref = ?)
                ORDER BY cp.id_registro DESC
                """,
                (safe_id_teste, normalize_text(id_processo), normalize_text(id_processo), normalize_text(id_processo)),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                if not self._candidate_sheet_exists(cursor, safe_id_teste):
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado.")

                profile = self._get_candidate_sheet_profile(cursor, safe_id_teste)
                cursor.execute(
                    """
                    SELECT TOP 1
                        nome_arquivo_original,
                        tipo_arquivo,
                        caminho_arquivo
                    FROM candidatos_anexos
                    WHERE id_teste = ?
                    ORDER BY criado_em DESC, id_anexo DESC
                    """,
                    (safe_id_teste,),
                )
                attachment_rows = rows_to_dicts(cursor, cursor.fetchall())
                attachment = attachment_rows[0] if attachment_rows else {}
                rows = [
                    {
                        "id_registro": None,
                        "id_processo": "",
                        "id_processo_ref": "",
                        "id_teste": safe_id_teste,
                        "nome_candidato": self._lookup_candidate_sheet_name(cursor, safe_id_teste),
                        "vaga": "",
                        "status_candidato": "",
                        "pontuacao_final": "",
                        "data_prova": "",
                        "origem": "Ficha do candidato",
                        "etapa_pipeline": "",
                        "data_atualizacao_pipeline": None,
                        "email": profile.get("email", ""),
                        "telefone": profile.get("telefone", ""),
                        "whatsapp": profile.get("whatsapp", ""),
                        "nome_perfil": profile.get("nome_candidato", ""),
                        "nome_arquivo_original": attachment.get("nome_arquivo_original", ""),
                        "tipo_arquivo": attachment.get("tipo_arquivo", ""),
                        "caminho_arquivo": attachment.get("caminho_arquivo", ""),
                    }
                ]
            row = rows[0]

            processo = (
                get_process_row(cursor, id_processo)
                if normalize_text(id_processo)
                else resolve_process_row_for_related_record(
                    cursor,
                    id_processo=row.get("id_processo"),
                    id_processo_ref=row.get("id_processo_ref", ""),
                    timestamp_values=[row.get("data_prova"), row.get("data_atualizacao_pipeline")],
                )
            )
            if processo and is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("analisar CV neste processo", processo.get("id_processo")),
                )
            processo_id_analise = (
                normalize_text(processo.get("id_processo"))
                if processo
                else normalize_text(row.get("id_processo"))
            )
            processo_ref_analise = (
                normalize_text(processo.get("id_processo_ref"))
                if processo
                else normalize_text(row.get("id_processo_ref"))
            )
            vaga_analise = (
                normalize_text(processo.get("vaga"))
                if processo
                else normalize_text(row.get("vaga"))
            ) or "Banco de Talentos"

            caminho_texto = normalize_text(row.get("caminho_arquivo"))
            caminho_arquivo = Path(caminho_texto) if caminho_texto else None
            nome_arquivo_cv = normalize_text(row.get("nome_arquivo_original"))
            tipo_arquivo_cv = normalize_text(row.get("tipo_arquivo"))
            content = b""

            if caminho_arquivo and caminho_arquivo.is_file():
                try:
                    content = caminho_arquivo.read_bytes()
                except OSError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Não foi possível ler o currículo anexado.",
                    ) from exc
            else:
                id_pre_analise_arquivo = (
                    int(safe_id_teste[3:])
                    if safe_id_teste.upper().startswith("CV-") and safe_id_teste[3:].isdigit()
                    else 0
                )
                cursor.execute(
                    """
                    SELECT TOP 1 nome_arquivo, mime_type, arquivo_original_base64
                    FROM cv_pre_analises
                    WHERE id_pre_analise = ?
                       OR (? <> '' AND LOWER(LTRIM(RTRIM(ISNULL(email, '')))) = LOWER(?))
                    ORDER BY id_pre_analise DESC
                    """,
                    (
                        id_pre_analise_arquivo,
                        normalize_text(row.get("email")),
                        normalize_text(row.get("email")),
                    ),
                )
                pre_rows = rows_to_dicts(cursor, cursor.fetchall())
                pre_analysis = pre_rows[0] if pre_rows else {}
                encoded = normalize_text(pre_analysis.get("arquivo_original_base64"))
                if encoded:
                    try:
                        content = base64.b64decode(encoded, validate=True)
                    except Exception as exc:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="O currículo armazenado está corrompido e precisa ser reenviado.",
                        ) from exc
                    nome_arquivo_cv = normalize_text(pre_analysis.get("nome_arquivo")) or nome_arquivo_cv
                    tipo_arquivo_cv = normalize_text(pre_analysis.get("mime_type")) or tipo_arquivo_cv

            if not content:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Currículo não encontrado para este candidato. Reenvie o arquivo e tente novamente.",
                )
            try:
                texto_extraido = extract_text_from_uploaded_file(
                    nome_arquivo_cv or "curriculo.pdf",
                    content,
                    tipo_arquivo_cv,
                )
            except CvTextExtractionError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.user_message) from exc

            texto_normalizado = normalize_cv_text(texto_extraido)
            if not texto_normalizado:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Não foi possível encontrar texto selecionável no currículo enviado.",
                )

            fallback_nome = row.get("nome_perfil") or row.get("nome_candidato")
            nome_detectado = extract_candidate_name_details(
                texto_normalizado,
                fallback_name=fallback_nome,
                filename=nome_arquivo_cv or "curriculo.pdf",
            )
            nome_candidato = nome_detectado.get("nome") or fallback_nome
            email = normalize_text(row.get("email")) or extract_email(texto_normalizado)
            telefone = normalize_text(row.get("telefone")) or extract_phone(texto_normalizado)
            whatsapp = normalize_text(row.get("whatsapp")) or extract_whatsapp(texto_normalizado)
            telefone_base = whatsapp or telefone
            palavras = extract_keywords(texto_normalizado)
            education_strength = extract_education_strength(texto_normalizado)
            experience_strength = extract_experience_strength(texto_normalizado)
            competencias = extract_competencies(texto_normalizado)
            experiencias = extract_professional_experiences(texto_normalizado)
            avaliacao = score_cv_for_role(
                vaga_analise,
                palavras,
                bool(email),
                bool(telefone_base),
                len(texto_normalizado),
                nome_candidato,
                email,
                telefone_base,
                education_strength,
                experience_strength,
                nome_detectado.get("confianca", "baixa"),
                competencias,
                experiencias,
            )
            avaliacao["nome_detectado"] = nome_candidato
            avaliacao["confianca_nome"] = nome_detectado.get("confianca", "baixa")
            avaliacao["fonte_nome"] = nome_detectado.get("fonte", "")

            existing = None
            if email:
                cursor.execute(
                    """
                    SELECT TOP 1 id_pre_analise
                    FROM cv_pre_analises
                    WHERE id_processo = ?
                      AND id_processo_ref = ?
                      AND email = ?
                    ORDER BY id_pre_analise DESC
                    """,
                    (processo_id_analise, processo_ref_analise, email),
                )
                existing = cursor.fetchone()
            arquivo_original_base64 = base64.b64encode(content).decode("utf-8")
            if existing:
                id_pre_analise = int(existing[0])
                cursor.execute(
                    """
                    UPDATE cv_pre_analises
                    SET nome_candidato = ?, telefone = ?, whatsapp = ?,
                        palavras_chave = ?, score_final = ?, classificacao = ?,
                        classificacao_slug = ?, problemas = ?, texto_extraido = ?,
                        nome_arquivo = ?, mime_type = ?, arquivo_original_base64 = ?
                    WHERE id_pre_analise = ?
                    """,
                    (
                        nome_candidato,
                        telefone,
                        whatsapp,
                        json.dumps(avaliacao["keywords_validas"], ensure_ascii=False),
                        avaliacao["score"],
                        avaliacao["classificacao"],
                        avaliacao["slug"],
                        serialize_cv_problems(avaliacao),
                        texto_normalizado,
                        nome_arquivo_cv or "curriculo.pdf",
                        tipo_arquivo_cv or "application/octet-stream",
                        arquivo_original_base64,
                        id_pre_analise,
                    ),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO cv_pre_analises
                    (
                        id_processo, id_processo_ref, nome_candidato, email,
                        telefone, whatsapp, palavras_chave, score_final,
                        classificacao, classificacao_slug, problemas,
                        texto_extraido, nome_arquivo, mime_type,
                        arquivo_original_base64, ja_adicionado_ao_processo,
                        origem
                    )
                    OUTPUT INSERTED.id_pre_analise
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        processo_id_analise,
                        processo_ref_analise,
                        nome_candidato,
                        email,
                        telefone,
                        whatsapp,
                        json.dumps(avaliacao["keywords_validas"], ensure_ascii=False),
                        avaliacao["score"],
                        avaliacao["classificacao"],
                        avaliacao["slug"],
                        serialize_cv_problems(avaliacao),
                        texto_normalizado,
                        nome_arquivo_cv or "curriculo.pdf",
                        tipo_arquivo_cv or "application/octet-stream",
                        arquivo_original_base64,
                        normalize_text(row.get("origem")) or "Pagina de inscricao",
                    ),
                )
                id_pre_analise = int(cursor.fetchone()[0])

            status_candidato = map_cv_classification_to_status(avaliacao["classificacao"])
            if status_candidato == "Qualificado" and processo and row.get("id_registro"):
                self._apply_candidate_status_update(
                    cursor,
                    current_row=row,
                    new_status=status_candidato,
                    new_stage="Prova",
                    data_movimentacao=datetime.now().isoformat(),
                )

            self._upsert_candidate_profile(
                cursor,
                id_teste=safe_id_teste,
                nome_candidato=nome_candidato,
                email=email,
                telefone=telefone,
                whatsapp=whatsapp,
            )
            conn.commit()
            return {"success": True, "id_pre_analise": id_pre_analise, "classificacao": avaliacao["classificacao"], "score": avaliacao["score"]}
        finally:
            conn.close()

    def add_cv_pre_analysis_to_talent_bank(self, id_pre_analise: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_process_reference_columns(cursor)
            cursor.execute(
                """
                SELECT
                    id_pre_analise, id_processo, id_processo_ref, nome_candidato,
                    email, telefone, whatsapp, score_final, classificacao, criado_em
                FROM cv_pre_analises
                WHERE id_pre_analise = ?
                """,
                (id_pre_analise,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pré-análise não encontrada.")
            row = rows[0]
            processo = resolve_process_row_for_related_record(
                cursor,
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref", ""),
                timestamp_values=[row.get("criado_em")],
            )
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("enviar candidato para o Banco de Talentos", processo.get("id_processo")),
                )
            id_teste = f"CV-{row.get('id_pre_analise')}"
            ensure_candidate_attachments_table(cursor)
            if normalize_text(row.get("email")):
                cursor.execute(
                    """
                    SELECT TOP 1 cp.id_teste
                    FROM candidatos_processos cp
                    INNER JOIN candidatos_metadata meta
                        ON meta.id_teste = cp.id_teste
                    INNER JOIN candidatos_anexos anexo
                        ON anexo.id_teste = cp.id_teste
                    WHERE cp.id_processo = ?
                      AND cp.id_processo_ref = ?
                      AND LOWER(LTRIM(RTRIM(ISNULL(meta.email, '')))) = LOWER(?)
                    ORDER BY cp.id_registro DESC
                    """,
                    (
                        row.get("id_processo"),
                        row.get("id_processo_ref"),
                        normalize_text(row.get("email")),
                    ),
                )
                candidate_with_cv = cursor.fetchone()
                if candidate_with_cv and normalize_text(candidate_with_cv[0]):
                    id_teste = normalize_text(candidate_with_cv[0])
            cursor.execute("SELECT id_banco FROM banco_talentos WHERE id_teste = ?", (id_teste,))
            existing = cursor.fetchone()
            payload = {
                "id_teste": id_teste,
                "id_processo": row.get("id_processo"),
                "id_processo_ref": row.get("id_processo_ref"),
                "nome_candidato": row.get("nome_candidato"),
                "vaga": "",
                "pontuacao_final": str(row.get("score_final") or "").replace(".", ","),
                "data_movimentacao": datetime.now().isoformat(),
                "origem": "Analise direta do CV",
                "email": row.get("email"),
                "telefone": row.get("telefone"),
                "whatsapp": row.get("whatsapp"),
            }
            conn.close()
            result = self.add_candidate_to_talent_bank(payload)
            result["duplicate"] = bool(existing)
            return result
        finally:
            try:
                conn.close()
            except Exception as exc:
                logger.debug("Falha ao encerrar conexao apos analise de CV: %s", exc)

    def add_cv_pre_analysis_to_process(
        self,
        id_pre_analise: int,
        manual_override: bool = False,
        motivo_override: str = "",
        eh_indicacao: bool = False,
        tipo_indicacao: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_cv_pre_analises_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)

            cursor.execute(
                """
                SELECT
                    id_pre_analise,
                    id_processo,
                    id_processo_ref,
                    nome_candidato,
                    email,
                    telefone,
                    whatsapp,
                    score_final,
                    classificacao,
                    ja_adicionado_ao_processo,
                    criado_em
                FROM cv_pre_analises
                WHERE id_pre_analise = ?
                """,
                (id_pre_analise,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pré-análise não encontrada.")
            row = rows[0]
            processo = resolve_process_row_for_related_record(
                cursor,
                id_processo=row.get("id_processo"),
                id_processo_ref=row.get("id_processo_ref", ""),
                timestamp_values=[row.get("criado_em")],
            )
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("aproveitar pré-análise de CV", processo.get("id_processo")),
                )

            status_candidato = map_cv_classification_to_status(row.get("classificacao"))
            if status_candidato != "Qualificado" and not manual_override:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Somente candidatos qualificados podem seguir da pré-análise para o processo seletivo.",
                )
            effective_status = "Qualificado" if manual_override else status_candidato
            effective_origin = "Analise direta do CV (uso manual RH)" if manual_override else "Analise direta do CV"
            manual_note = normalize_text(motivo_override) or "Utilizado manualmente pelo RH apesar da classificacao automatica."
            indication_type = normalize_indication_type(tipo_indicacao)
            is_indication = bool(eh_indicacao) or bool(indication_type)
            if bool(eh_indicacao) and not indication_type:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione o tipo de indicação.")

            existing_candidate = self._find_process_candidate_by_identity(
                cursor,
                processo,
                id_teste=f"CV-{row.get('id_pre_analise')}",
                email=row.get("email"),
                telefone=row.get("telefone"),
                whatsapp=row.get("whatsapp"),
            )
            if existing_candidate:
                cursor.execute(
                    """
                    UPDATE cv_pre_analises
                    SET ja_adicionado_ao_processo = 1
                    WHERE id_pre_analise = ?
                    """,
                    (id_pre_analise,),
                )
                existing_status = canonicalize_candidate_status(
                    existing_candidate.get("status_candidato"),
                )
                cursor.execute(
                    """
                    UPDATE candidatos_processos
                    SET
                        origem = CASE WHEN ? = 1 THEN ? ELSE origem END,
                        pontuacao_final = CASE
                            WHEN ISNULL(LTRIM(RTRIM(CONVERT(NVARCHAR(60), pontuacao_final))), '') = '' THEN ?
                            ELSE pontuacao_final
                        END,
                        eh_indicacao = CASE WHEN ? = 1 THEN 1 ELSE ISNULL(eh_indicacao, 0) END,
                        tipo_indicacao = CASE WHEN ? <> '' THEN ? ELSE tipo_indicacao END,
                        indicacao_em = CASE WHEN ? = 1 THEN ISNULL(indicacao_em, GETDATE()) ELSE indicacao_em END
                    WHERE id_registro = ?
                    """,
                    (
                        1 if manual_override else 0,
                        effective_origin,
                        (str(row.get("score_final")).replace(".", ",") if row.get("score_final") is not None else ""),
                        1 if is_indication else 0,
                        indication_type,
                        indication_type,
                        1 if is_indication else 0,
                        existing_candidate.get("id_registro"),
                    ),
                )
                if manual_override:
                    self._upsert_candidate_profile(
                        cursor,
                        id_teste=existing_candidate.get("id_teste") or f"CV-{row.get('id_pre_analise')}",
                        nome_candidato=row.get("nome_candidato"),
                        observacao_rh=manual_note,
                    )
                observacoes_movimento = []
                if manual_override:
                    observacoes_movimento.append(manual_note)
                if is_indication:
                    observacoes_movimento.append(f"Indicação: {indication_type}")
                if observacoes_movimento:
                    self._record_candidate_movement(
                        cursor,
                        id_teste=existing_candidate.get("id_teste") or f"CV-{row.get('id_pre_analise')}",
                        id_registro=existing_candidate.get("id_registro"),
                        id_processo=processo.get("id_processo", ""),
                        id_processo_ref=processo.get("id_processo_ref", ""),
                        nome_candidato=row.get("nome_candidato"),
                        vaga=processo.get("vaga") or "",
                        origem_inicial=effective_origin,
                        tipo_movimentacao=(
                            "Candidato aproveitado manualmente"
                            if manual_override
                            else "Indicação registrada no processo"
                        ),
                        status_anterior="Pré-análise de CV",
                        status_novo=existing_status,
                        observacao=" | ".join(observacoes_movimento),
                    )
                conn.commit()
                return {
                    "success": True,
                    "already_exists": True,
                    "id_registro": existing_candidate.get("id_registro"),
                    "status_candidato": existing_status,
                    "message": "Este candidato já estava vinculado ao processo; a pré-análise foi marcada como utilizada.",
                }

            if int(row.get("ja_adicionado_ao_processo") or 0) == 1:
                conn.commit()
                return {
                    "success": True,
                    "already_exists": True,
                    "message": "Este CV já foi adicionado ao processo.",
                }
            id_registro = insert_candidate_process_record(
                cursor,
                processo,
                {
                    "id_teste": f"CV-{row.get('id_pre_analise')}",
                    "nome_candidato": row.get("nome_candidato"),
                    "vaga": processo.get("vaga") or "",
                    "status_candidato": effective_status,
                    "pontuacao_final": (
                        str(row.get("score_final")).replace(".", ",")
                        if row.get("score_final") is not None
                        else ""
                    ),
                    "data_prova": datetime.now().isoformat(),
                    "origem": effective_origin,
                    "etapa_pipeline": "Prova" if effective_status == "Qualificado" else "Triagem",
                    "data_atualizacao_pipeline": datetime.now(),
                    "eh_indicacao": is_indication,
                    "tipo_indicacao": indication_type,
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
                id_teste=f"CV-{row.get('id_pre_analise')}",
                nome_candidato=row.get("nome_candidato"),
                observacao_rh=manual_note if manual_override else None,
            )
            observacoes_movimento = [f"Origem: {effective_origin}"]
            if manual_override:
                observacoes_movimento.append(manual_note)
            if is_indication:
                observacoes_movimento.append(f"Indicação: {indication_type}")
            self._record_candidate_movement(
                cursor,
                id_teste=f"CV-{row.get('id_pre_analise')}",
                id_registro=id_registro,
                id_processo=processo.get("id_processo", ""),
                id_processo_ref=processo.get("id_processo_ref", ""),
                nome_candidato=row.get("nome_candidato"),
                vaga=processo.get("vaga") or "",
                origem_inicial=effective_origin,
                tipo_movimentacao="Candidato vinculado a processo seletivo",
                status_anterior="Pré-análise de CV",
                status_novo=effective_status,
                observacao=" | ".join(observacoes_movimento),
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

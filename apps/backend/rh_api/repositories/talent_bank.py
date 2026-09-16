from __future__ import annotations

import math
import re
from datetime import datetime

import pyodbc
from fastapi import HTTPException, status

from ..services.helpers import (
    normalize_compare_text,
    normalize_indication_type,
    normalize_text,
    rows_to_dicts,
)
from ..services.process_flow import (
    CANDIDATE_STATUS_ANALYSIS,
    CANDIDATE_STATUS_TALENT_BANK,
    build_process_closed_message,
    canonicalize_candidate_status,
    is_process_closed,
)
from .bootstrap import (
    describe_database_error,
    ensure_pipeline_columns,
    ensure_process_reference_columns,
    ensure_scorecards_table,
    ensure_talent_bank_table,
    get_process_row,
    insert_candidate_process_record,
)


# Palavras muito genericas para o matching por palavra-chave (nao carregam
# significado de aderencia a vaga). Motor de busca textual simples e
# explicavel (sem IA/embeddings/servico pago) - roadmap de expansao definiu
# "zero custo" para o matching automatico com banco de talentos.
_MATCHING_STOPWORDS = {
    "de", "da", "do", "das", "dos", "para", "com", "sem", "em", "e", "ou",
    "a", "o", "as", "os", "um", "uma", "uns", "umas", "no", "na", "nos", "nas",
    "vaga", "vagas", "processo", "candidato", "candidata", "empresa", "area",
    "setor", "trabalho", "funcao", "cargo", "atividades", "requisitos",
}


# Roadmap de expansao (respostas.txt): "por questoes de seguranca, depois de
# 6 meses o candidato deve sair do banco de talentos". Nao apagamos nada
# automaticamente (decisao do RH continua manual, via remover_talent_bank
# ja existente) - so marcamos o candidato como expirado, escondendo-o do
# matching automatico e sinalizando na tela para revisao humana.
TALENT_BANK_EXPIRATION_DAYS = 180


def _dias_desde(valor) -> int | None:
    texto = normalize_text(valor)
    if not texto:
        return None
    try:
        referencia = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return None
    agora = datetime.now(referencia.tzinfo) if referencia.tzinfo else datetime.now()
    return max(0, (agora - referencia).days)


def _extract_matching_keywords(text) -> set[str]:
    """Extrai palavras-chave normalizadas (sem acento, minusculas, >=3 letras)
    de um texto livre, descartando stopwords. Base do motor de matching
    textual (comparacao simples por palavras em comum, tipo LIKE)."""
    normalized = normalize_compare_text(text)
    tokens = re.findall(r"[a-z0-9]+", normalized)
    return {token for token in tokens if len(token) >= 3 and token not in _MATCHING_STOPWORDS}


class TalentBankRepositoryMixin:
    @staticmethod
    def _paginate_talent_bank(items: list[dict], page: int | None, page_size: int | None) -> dict | list[dict]:
        if page is None and page_size is None:
            return items

        safe_page = max(1, int(page or 1))
        safe_page_size = self._clamp_limit(page_size, default=20, maximum=100)
        total = len(items)
        total_pages = max(1, math.ceil(total / safe_page_size))
        safe_page = min(safe_page, total_pages)
        start = (safe_page - 1) * safe_page_size
        return {
            "items": items[start : start + safe_page_size],
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
            "total_pages": total_pages,
            "has_next": safe_page < total_pages,
            "has_previous": safe_page > 1,
        }

    def list_talent_bank(
        self,
        search: str = "",
        skill: str = "",
        tag: str = "",
        page: int | None = None,
        page_size: int | None = None,
    ) -> list[dict] | dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_talent_bank_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            profile_map = self._get_candidate_profile_map(cursor)
            interview_map = self._get_latest_interview_map(cursor)
            cv_map = self._get_candidate_cv_map(cursor)
            cursor.execute(
                """
                SELECT
                    id_banco,
                    id_processo,
                    id_processo_ref,
                    id_teste,
                    nome_candidato,
                    vaga,
                    pontuacao_final,
                    data_movimentacao,
                    origem,
                    eh_indicacao,
                    tipo_indicacao,
                    indicacao_em
                FROM banco_talentos
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            rows = self._attach_process_context(
                cursor,
                rows,
                timestamp_fields=["data_movimentacao"],
            )
            result = []
            search_term = normalize_compare_text(search)
            skill_term = normalize_compare_text(skill)
            tag_term = normalize_compare_text(tag)

            for item in rows:
                id_teste = normalize_text(item.get("id_teste"))
                profile = profile_map.get(id_teste, {})
                latest_interview = interview_map.get(id_teste, {})
                cv_attachment = cv_map.get(id_teste, {})
                item["tags"] = profile.get("tags", [])
                item["habilidades"] = profile.get("habilidades", [])
                item["observacao_rh"] = profile.get("observacao_rh", "")
                item["email"] = profile.get("email", "")
                item["telefone"] = profile.get("telefone", "")
                item["whatsapp"] = profile.get("whatsapp", "")
                item["cidade"] = profile.get("cidade", "")
                item["bairro"] = profile.get("bairro", "")
                item["eh_indicacao"] = bool(item.get("eh_indicacao"))
                item["tipo_indicacao"] = normalize_text(item.get("tipo_indicacao"))
                item["cv_disponivel"] = bool(normalize_text(cv_attachment.get("caminho_arquivo")))
                item["cv_nome_arquivo"] = normalize_text(cv_attachment.get("nome_arquivo_original"))
                item["cv_tipo_arquivo"] = normalize_text(cv_attachment.get("tipo_arquivo"))
                item["status_entrevista"] = (
                    canonicalize_candidate_status(latest_interview.get("status_entrevista"))
                    if normalize_text(latest_interview.get("status_entrevista"))
                    else ""
                )
                item["data_entrevista"] = latest_interview.get("data_entrevista")
                item["link_entrevista"] = normalize_text(latest_interview.get("link_agendamento"))
                dias_no_banco = _dias_desde(item.get("data_movimentacao"))
                item["dias_no_banco"] = dias_no_banco
                item["expirado"] = dias_no_banco is not None and dias_no_banco >= TALENT_BANK_EXPIRATION_DAYS

                item_search_text = " ".join(
                    [
                        normalize_text(item.get("nome_candidato")),
                        normalize_text(item.get("vaga")),
                        normalize_text(item.get("id_processo")),
                        " ".join(item.get("habilidades", [])),
                        " ".join(item.get("tags", [])),
                    ]
                )
                if search_term and search_term not in normalize_compare_text(item_search_text):
                    continue
                if skill_term and all(skill_term not in normalize_compare_text(skill_item) for skill_item in item.get("habilidades", [])):
                    continue
                if tag_term and all(tag_term not in normalize_compare_text(tag_item) for tag_item in item.get("tags", [])):
                    continue

                result.append(item)

            return self._paginate_talent_bank(result, page, page_size)
        finally:
            conn.close()

    def delete_talent_bank_candidate(self, id_banco: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_talent_bank_table(cursor)
            cursor.execute("DELETE FROM banco_talentos WHERE id_banco = ?", (id_banco,))
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def revalidate_talent_bank_candidate(self, id_banco: int) -> dict:
        """Reinicia a contagem de permanencia do candidato no banco de
        talentos (roadmap de expansao: expiracao apos 6 meses,
        TALENT_BANK_EXPIRATION_DAYS). Usado quando o RH revisa manualmente um
        candidato expirado e decide mante-lo disponivel para matching."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_talent_bank_table(cursor)
            cursor.execute(
                "UPDATE banco_talentos SET data_movimentacao = ? WHERE id_banco = ?",
                (datetime.now().isoformat(), id_banco),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado no banco de talentos.")
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def add_candidate_to_talent_bank(self, data: dict) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_talent_bank_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)

            id_teste = normalize_text(data.get("id_teste"))
            nome_candidato = normalize_text(data.get("nome_candidato"))
            if not id_teste:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ID da prova não informado.")
            if not nome_candidato:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome do candidato não informado.")

            id_processo = normalize_text(data.get("id_processo"))
            id_processo_ref = normalize_text(data.get("id_processo_ref"))
            pontuacao_final = data.get("pontuacao_final", "")
            data_movimentacao = normalize_text(data.get("data_movimentacao")) or datetime.now().isoformat()
            origem = normalize_text(data.get("origem")) or "Processo Unico"
            vaga = normalize_text(data.get("vaga")) or origem or "Processo Unico"
            email = normalize_text(data.get("email"))
            telefone = normalize_text(data.get("telefone"))
            whatsapp = normalize_text(data.get("whatsapp"))
            codigo_acesso = normalize_text(
                data.get("codigo_acesso") or data.get("codigo_cp") or data.get("codigo_prova"),
            )
            indication_type = normalize_indication_type(data.get("tipo_indicacao"))
            is_indication = (
                bool(data.get("eh_indicacao"))
                or bool(indication_type)
            )
            if bool(data.get("eh_indicacao")) and not indication_type:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione o tipo de indicacao.")

            id_banco_existente = self._find_talent_bank_duplicate_id(
                cursor,
                id_teste=id_teste,
                email=email,
                telefone=telefone,
                whatsapp=whatsapp,
                codigo_acesso=codigo_acesso,
                nome_candidato=nome_candidato,
                vaga=vaga,
                origem=origem,
            )
            already_exists = bool(id_banco_existente)

            if id_banco_existente:
                cursor.execute(
                    """
                    UPDATE banco_talentos
                    SET
                        id_processo = ?,
                        id_processo_ref = ?,
                        id_teste = ?,
                        nome_candidato = ?,
                        vaga = ?,
                        pontuacao_final = ?,
                        data_movimentacao = ?,
                        origem = ?,
                        eh_indicacao = CASE WHEN ? = 1 THEN 1 ELSE ISNULL(eh_indicacao, 0) END,
                        tipo_indicacao = CASE WHEN ? <> '' THEN ? ELSE tipo_indicacao END,
                        indicacao_em = CASE WHEN ? = 1 THEN ISNULL(indicacao_em, GETDATE()) ELSE indicacao_em END
                    WHERE id_banco = ?
                    """,
                    (
                        id_processo,
                        id_processo_ref,
                        id_teste,
                        nome_candidato,
                        vaga,
                        pontuacao_final,
                        data_movimentacao,
                        origem,
                        1 if is_indication else 0,
                        indication_type,
                        indication_type,
                        1 if is_indication else 0,
                        id_banco_existente,
                    ),
                )
                id_banco = id_banco_existente
            else:
                id_banco = self._insert_talent_bank_record(
                    cursor,
                    {
                        "id_processo": id_processo,
                        "id_processo_ref": id_processo_ref,
                        "id_teste": id_teste,
                        "nome_candidato": nome_candidato,
                        "vaga": vaga,
                        "pontuacao_final": pontuacao_final,
                        "data_movimentacao": data_movimentacao,
                        "origem": origem,
                        "eh_indicacao": is_indication,
                        "tipo_indicacao": indication_type,
                    },
                )

            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=nome_candidato,
                email=email or None,
                telefone=telefone or None,
                whatsapp=whatsapp or None,
                endereco=normalize_text(data.get("endereco")) or None,
                cidade=normalize_text(data.get("cidade")) or None,
                bairro=normalize_text(data.get("bairro")) or None,
                escolaridade=normalize_text(data.get("escolaridade")) or None,
                possui_experiencia=normalize_text(data.get("possui_experiencia")) or None,
                musica=normalize_text(data.get("musica")) or None,
                prato=normalize_text(data.get("prato")) or None,
                futebol=normalize_text(data.get("futebol")) or None,
                time=normalize_text(data.get("time")) or None,
                rede_social=normalize_text(data.get("rede_social")) or None,
            )
            if id_processo or id_processo_ref:
                cursor.execute(
                    """
                    SELECT
                        id_registro,
                        id_processo,
                        id_processo_ref,
                        id_teste,
                        nome_candidato,
                        vaga,
                        status_candidato,
                        pontuacao_final,
                        data_prova,
                        origem,
                        etapa_pipeline,
                        data_atualizacao_pipeline
                    FROM candidatos_processos
                    WHERE id_teste = ?
                      AND (? = '' OR id_processo = ?)
                      AND (? = '' OR id_processo_ref = ?)
                    """,
                    (
                        id_teste,
                        id_processo,
                        id_processo,
                        id_processo_ref,
                        id_processo_ref,
                    ),
                )
                process_rows = rows_to_dicts(cursor, cursor.fetchall())
                for process_row in process_rows:
                    if canonicalize_candidate_status(process_row.get("status_candidato")) == CANDIDATE_STATUS_TALENT_BANK:
                        continue
                    self._apply_candidate_status_update(
                        cursor,
                        current_row=process_row,
                        new_status=CANDIDATE_STATUS_TALENT_BANK,
                        new_stage="Reprovado",
                        data_movimentacao=data_movimentacao,
                    )
            conn.commit()
            return {
                "success": True,
                "id_banco": id_banco,
                "already_exists": already_exists,
                "message": (
                    "Este candidato já está no Banco de Talentos."
                    if already_exists
                    else "Candidato enviado para o Banco de Talentos."
                ),
            }
        except pyodbc.Error as exc:
            try:
                conn.rollback()
            except pyodbc.Error as rollback_exc:
                self.logger.debug("Falha ao reverter transacao apos erro no Banco de Talentos: %s", rollback_exc)
            self.logger.error(
                "Falha ao enviar candidato para Banco de Talentos: %s",
                describe_database_error(exc),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Não foi possível enviar o candidato para o Banco de Talentos. Verifique os dados do candidato e tente novamente.",
            ) from exc
        finally:
            conn.close()

    def use_talent_bank_candidate(self, id_banco: int, data: dict) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_talent_bank_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            cursor.execute(
                """
                SELECT
                    id_processo,
                    id_processo_ref,
                    id_teste,
                    nome_candidato,
                    vaga,
                    pontuacao_final,
                    origem,
                    data_movimentacao,
                    eh_indicacao,
                    tipo_indicacao
                FROM banco_talentos
                WHERE id_banco = ?
                """,
                (id_banco,),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato do Banco de Talentos não encontrado.")
            row = rows[0]

            id_processo = normalize_text(data.get("id_processo"))
            if not id_processo:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Processo de destino não informado.")
            processo = get_process_row(cursor, data.get("id_processo_ref") or id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo de destino não encontrado.")
            if is_process_closed(processo.get("status")):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_process_closed_message("utilizar o candidato do Banco de Talentos", id_processo),
                )

            data_movimentacao = datetime.now().isoformat()
            origem = normalize_text(data.get("origem")) or "Banco de Talentos"
            vaga = normalize_text(processo.get("vaga")) or row.get("vaga")
            id_teste = normalize_text(row.get("id_teste"))
            indication_type = normalize_indication_type(data.get("tipo_indicacao"))
            is_indication = bool(data.get("eh_indicacao")) or bool(indication_type)
            if bool(data.get("eh_indicacao")) and not indication_type:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione o tipo de indicação.")
            cursor.execute(
                """
                SELECT id_registro, id_processo, id_processo_ref, status_candidato
                FROM candidatos_processos
                WHERE id_teste = ?
                """,
                (id_teste,),
            )
            for linked_candidate in rows_to_dicts(cursor, cursor.fetchall()):
                linked_status = canonicalize_candidate_status(
                    linked_candidate.get("status_candidato"),
                )
                if linked_status != CANDIDATE_STATUS_TALENT_BANK:
                    same_target_process = (
                        normalize_text(linked_candidate.get("id_processo_ref")) == normalize_text(processo.get("id_processo_ref"))
                        or (
                            normalize_text(linked_candidate.get("id_processo")) == normalize_text(processo.get("id_processo"))
                            and not normalize_text(linked_candidate.get("id_processo_ref"))
                        )
                    )
                    if same_target_process:
                        cursor.execute(
                            """
                            UPDATE candidatos_processos
                            SET
                                eh_indicacao = CASE WHEN ? = 1 THEN 1 ELSE ISNULL(eh_indicacao, 0) END,
                                tipo_indicacao = CASE WHEN ? <> '' THEN ? ELSE tipo_indicacao END,
                                indicacao_em = CASE WHEN ? = 1 THEN ISNULL(indicacao_em, GETDATE()) ELSE indicacao_em END
                            WHERE id_registro = ?
                            """,
                            (
                                1 if is_indication else 0,
                                indication_type,
                                indication_type,
                                1 if is_indication else 0,
                                linked_candidate.get("id_registro"),
                            ),
                        )
                        if is_indication:
                            self._record_candidate_movement(
                                cursor,
                                id_teste=id_teste,
                                id_registro=linked_candidate.get("id_registro"),
                                id_processo=processo.get("id_processo", ""),
                                id_processo_ref=processo.get("id_processo_ref", ""),
                                nome_candidato=row.get("nome_candidato"),
                                vaga=vaga,
                                origem_inicial=origem,
                                tipo_movimentacao="Indicação registrada no processo",
                                status_anterior=linked_status,
                                status_novo=linked_status,
                                observacao=f"Indicação: {indication_type}",
                            )
                        cursor.execute("DELETE FROM banco_talentos WHERE id_banco = ?", (id_banco,))
                        conn.commit()
                        return {
                            "success": True,
                            "already_exists": True,
                            "id_registro": linked_candidate.get("id_registro"),
                            "status_candidato": linked_status,
                            "message": "Este candidato já estava vinculado ao processo destino.",
                        }
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "Este candidato já está vinculado a este processo seletivo."
                            if same_target_process
                            else "Este candidato já está vinculado a um processo seletivo."
                        ),
                    )
            profile = self._get_candidate_profile_map(cursor).get(id_teste, {})
            profile_email = normalize_compare_text(profile.get("email"))
            profile_phones = {
                normalize_text(profile.get("telefone")),
                normalize_text(profile.get("whatsapp")),
            }
            profile_phones.discard("")
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
                """,
                (
                    processo.get("id_processo"),
                    processo.get("id_processo_ref", ""),
                ),
            )
            existing_rows = rows_to_dicts(cursor, cursor.fetchall())
            for existing in existing_rows:
                same_candidate = normalize_text(existing.get("id_teste")) == id_teste
                same_email = profile_email and normalize_compare_text(existing.get("email")) == profile_email
                same_phone = bool(profile_phones) and normalize_text(existing.get("telefone")) in profile_phones
                same_whatsapp = bool(profile_phones) and normalize_text(existing.get("whatsapp")) in profile_phones
                if not (same_candidate or same_email or same_phone or same_whatsapp):
                    continue

                existing_status = canonicalize_candidate_status(existing.get("status_candidato"))
                cursor.execute(
                    """
                    UPDATE candidatos_processos
                    SET
                        eh_indicacao = CASE WHEN ? = 1 THEN 1 ELSE ISNULL(eh_indicacao, 0) END,
                        tipo_indicacao = CASE WHEN ? <> '' THEN ? ELSE tipo_indicacao END,
                        indicacao_em = CASE WHEN ? = 1 THEN ISNULL(indicacao_em, GETDATE()) ELSE indicacao_em END
                    WHERE id_registro = ?
                    """,
                    (
                        1 if is_indication else 0,
                        indication_type,
                        indication_type,
                        1 if is_indication else 0,
                        existing.get("id_registro"),
                    ),
                )
                if is_indication:
                    self._record_candidate_movement(
                        cursor,
                        id_teste=existing.get("id_teste") or id_teste,
                        id_registro=existing.get("id_registro"),
                        id_processo=processo.get("id_processo", ""),
                        id_processo_ref=processo.get("id_processo_ref", ""),
                        nome_candidato=existing.get("nome_candidato") or row.get("nome_candidato"),
                        vaga=vaga,
                        origem_inicial=origem,
                        tipo_movimentacao="Indicação registrada no processo",
                        status_anterior=existing_status,
                        status_novo=existing_status,
                        observacao=f"Indicação: {indication_type}",
                    )
                cursor.execute("DELETE FROM banco_talentos WHERE id_banco = ?", (id_banco,))
                conn.commit()
                return {
                    "success": True,
                    "already_exists": True,
                    "id_registro": existing.get("id_registro"),
                    "status_candidato": existing_status,
                    "message": "Este candidato já estava vinculado ao processo destino.",
                }

            id_registro = insert_candidate_process_record(
                cursor,
                processo,
                {
                    "id_teste": id_teste,
                    "nome_candidato": row.get("nome_candidato"),
                    "vaga": vaga,
                    "status_candidato": CANDIDATE_STATUS_ANALYSIS,
                    "pontuacao_final": row.get("pontuacao_final"),
                    "data_prova": data_movimentacao,
                    "origem": origem,
                    "etapa_pipeline": "Triagem",
                    "data_atualizacao_pipeline": datetime.now(),
                    "eh_indicacao": is_indication,
                    "tipo_indicacao": indication_type,
                },
            )

            self._upsert_candidate_profile(
                cursor,
                id_teste=id_teste,
                nome_candidato=row.get("nome_candidato"),
            )
            self._record_candidate_movement(
                cursor,
                id_teste=id_teste,
                id_registro=id_registro,
                id_processo=processo.get("id_processo", ""),
                id_processo_ref=processo.get("id_processo_ref", ""),
                nome_candidato=row.get("nome_candidato"),
                vaga=vaga,
                origem_inicial=origem,
                tipo_movimentacao="Candidato vinculado a processo seletivo",
                status_anterior=CANDIDATE_STATUS_TALENT_BANK,
                status_novo=CANDIDATE_STATUS_ANALYSIS,
                observacao=(
                    f"Origem: {origem}"
                    + (f" | Indicação: {indication_type}" if is_indication else "")
                ),
            )
            cursor.execute("DELETE FROM banco_talentos WHERE id_banco = ?", (id_banco,))
            conn.commit()
            return {
                "success": True,
                "id_registro": id_registro,
                "status_candidato": CANDIDATE_STATUS_ANALYSIS,
                "message": "Candidato vinculado ao processo destino em análise.",
            }
        finally:
            conn.close()

    def get_talent_bank_matches(self, id_processo: str, limit: int = 15) -> dict:
        """Matching automatico entre uma vaga e o Banco de Talentos.

        Cruza palavras-chave da vaga (cargo/vaga, operacao, trilha, requisitos
        e responsabilidades publicadas) com o texto do perfil de cada
        candidato do Banco de Talentos (cargo/vaga anterior, habilidades e
        tags cadastradas). Nao usa IA/embeddings/servico pago: e busca
        textual simples por palavras-chave (comparacao de conjuntos,
        equivalente a varios `LIKE` combinados), conforme o roadmap de
        expansao definiu ("zero custo"). Candidatos ja vinculados ao
        processo destino sao excluidos da sugestao. O motivo do match soma
        as palavras em comum, o scorecard medio (quando existir) e a melhor
        etapa do funil ja alcancada pelo candidato em processos anteriores.
        """
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_talent_bank_table(cursor)
            ensure_pipeline_columns(cursor)
            ensure_process_reference_columns(cursor)
            ensure_scorecards_table(cursor)

            processo = get_process_row(cursor, id_processo)
            if not processo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Processo não encontrado.")

            vaga_keywords: set[str] = set()
            for campo in (
                processo.get("vaga"),
                processo.get("operacao"),
                processo.get("trilha"),
                processo.get("requisitos_publicos"),
                processo.get("responsabilidades_publicas"),
            ):
                vaga_keywords |= _extract_matching_keywords(campo)

            profile_map = self._get_candidate_profile_map(cursor)

            cursor.execute(
                """
                SELECT
                    id_banco,
                    id_teste,
                    nome_candidato,
                    vaga,
                    pontuacao_final,
                    origem,
                    data_movimentacao
                FROM banco_talentos
                """
            )
            candidatos_banco = rows_to_dicts(cursor, cursor.fetchall())

            id_processo_norm = normalize_text(processo.get("id_processo"))
            id_processo_ref_norm = normalize_text(processo.get("id_processo_ref")) or id_processo_norm
            cursor.execute(
                """
                SELECT id_teste, id_processo, id_processo_ref
                FROM candidatos_processos
                WHERE id_processo = ? OR id_processo_ref = ?
                """,
                (id_processo_norm, id_processo_ref_norm),
            )
            ja_vinculados = {
                normalize_text(row.get("id_teste"))
                for row in rows_to_dicts(cursor, cursor.fetchall())
                if normalize_text(row.get("id_teste"))
            }

            # Scorecard medio do candidato considerando todas as avaliacoes
            # registradas em qualquer processo anterior (tabela criada para o
            # Kanban de vagas com scorecard).
            cursor.execute(
                """
                SELECT cp.id_teste AS id_teste, AVG(CAST(s.nota AS FLOAT)) AS media
                FROM scorecards_avaliacao s
                INNER JOIN candidatos_processos cp ON cp.id_registro = s.candidato_processo_id
                WHERE cp.id_teste IS NOT NULL AND cp.id_teste <> ''
                GROUP BY cp.id_teste
                """
            )
            scorecard_medio_map = {
                normalize_text(row.get("id_teste")): round(float(row.get("media") or 0), 1)
                for row in rows_to_dicts(cursor, cursor.fetchall())
            }

            # Melhor etapa do funil ja alcancada pelo candidato (histórico
            # completo, qualquer processo), usada apenas para compor o
            # motivo textual do match.
            cursor.execute(
                """
                SELECT id_teste, vaga, etapa_pipeline
                FROM candidatos_processos
                WHERE id_teste IS NOT NULL AND id_teste <> ''
                """
            )
            etapa_ordem = {"Triagem": 0, "Reprovado": 0, "Prova": 1, "Entrevista": 2, "Aprovado": 3}
            melhor_etapa_map: dict[str, dict] = {}
            for row in rows_to_dicts(cursor, cursor.fetchall()):
                id_teste_hist = normalize_text(row.get("id_teste"))
                if not id_teste_hist:
                    continue
                etapa = normalize_text(row.get("etapa_pipeline")) or "Triagem"
                atual = melhor_etapa_map.get(id_teste_hist)
                if not atual or etapa_ordem.get(etapa, 0) > etapa_ordem.get(atual.get("etapa_pipeline", ""), 0):
                    melhor_etapa_map[id_teste_hist] = {
                        "etapa_pipeline": etapa,
                        "vaga": normalize_text(row.get("vaga")),
                    }

            resultados = []
            for candidato in candidatos_banco:
                id_teste = normalize_text(candidato.get("id_teste"))
                if not id_teste or id_teste in ja_vinculados:
                    continue

                dias_no_banco = _dias_desde(candidato.get("data_movimentacao"))
                if dias_no_banco is not None and dias_no_banco >= TALENT_BANK_EXPIRATION_DAYS:
                    continue

                perfil = profile_map.get(id_teste, {})
                candidato_keywords: set[str] = set()
                candidato_keywords |= _extract_matching_keywords(candidato.get("vaga"))
                for habilidade in perfil.get("habilidades", []) or []:
                    candidato_keywords |= _extract_matching_keywords(habilidade)
                for tag in perfil.get("tags", []) or []:
                    candidato_keywords |= _extract_matching_keywords(tag)
                candidato_keywords |= _extract_matching_keywords(perfil.get("observacao_rh"))

                palavras_em_comum = sorted(vaga_keywords & candidato_keywords)
                if not palavras_em_comum:
                    continue

                scorecard_medio = scorecard_medio_map.get(id_teste)
                melhor_etapa = melhor_etapa_map.get(id_teste, {})

                motivos = ["Palavras em comum com a vaga: " + ", ".join(palavras_em_comum[:5])]
                if scorecard_medio:
                    motivos.append(f"Scorecard médio {scorecard_medio:.1f} em processo anterior")
                if melhor_etapa.get("etapa_pipeline") in {"Entrevista", "Aprovado"}:
                    vaga_similar = melhor_etapa.get("vaga")
                    motivos.append(
                        "Chegou à entrevista em vaga similar"
                        + (f" ({vaga_similar})" if vaga_similar else "")
                    )

                pontuacao_match = round(len(palavras_em_comum) * 10 + (scorecard_medio or 0), 1)
                # Correções.txt item 15: percentual de compatibilidade exibido
                # ao RH — proporção das palavras-chave da vaga que este
                # candidato do Banco de Talentos também tem, sem inventar uma
                # métrica de IA. Cap em 100% (candidato pode ter mais
                # palavras em comum do que o próprio conjunto da vaga, por
                # sinônimos capturados nas tags/habilidades).
                percentual_compatibilidade = (
                    min(100, round((len(palavras_em_comum) / len(vaga_keywords)) * 100))
                    if vaga_keywords
                    else 0
                )

                resultados.append(
                    {
                        "id_banco": candidato.get("id_banco"),
                        "id_teste": id_teste,
                        "nome_candidato": candidato.get("nome_candidato") or "",
                        "vaga_anterior": candidato.get("vaga") or "",
                        "origem": candidato.get("origem") or "",
                        "scorecard_medio": scorecard_medio,
                        "palavras_em_comum": palavras_em_comum,
                        "pontuacao_match": pontuacao_match,
                        "percentual_compatibilidade": percentual_compatibilidade,
                        "motivo": " • ".join(motivos),
                        "habilidades": perfil.get("habilidades", []) or [],
                        "tags": perfil.get("tags", []) or [],
                    }
                )

            resultados.sort(key=lambda item: item["pontuacao_match"], reverse=True)
            safe_limit = self._clamp_limit(limit, default=15, maximum=50)
            return {
                "id_processo": processo.get("id_processo", ""),
                "vaga": processo.get("vaga", ""),
                "palavras_chave_vaga": sorted(vaga_keywords),
                "total_sugestoes": len(resultados),
                "candidatos": resultados[:safe_limit],
            }
        finally:
            conn.close()

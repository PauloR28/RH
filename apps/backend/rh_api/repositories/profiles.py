from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status

from ..services.helpers import normalize_compare_text, normalize_string_list, normalize_text, rows_to_dicts
from ..services.cv import is_valid_email, is_valid_phone
from ..services.process_flow import (
    CANDIDATE_STATUS_APPROVED,
    CANDIDATE_STATUS_ELIMINATED,
    CANDIDATE_STATUS_TALENT_BANK,
    build_approved_candidate_locked_message,
    canonicalize_candidate_status,
)

PROFILE_RECOMMENDATION_LABELS = {
    "indicado": "Indicado",
    "indicado com restricoes": "Indicado com restrições",
    "contraindicado": "Contraindicado",
}


def normalize_profile_recommendation(value) -> str:
    safe_value = normalize_text(value)
    if not safe_value:
        return ""
    return PROFILE_RECOMMENDATION_LABELS.get(normalize_compare_text(safe_value), safe_value)


class CandidateProfileRepositoryMixin:
    def update_standalone_candidate_status(self, id_teste: str, data: dict) -> dict:
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador do candidato não informado.")

        requested_status = canonicalize_candidate_status(data.get("status_candidato"))
        if requested_status not in {
            CANDIDATE_STATUS_APPROVED,
            CANDIDATE_STATUS_ELIMINATED,
            CANDIDATE_STATUS_TALENT_BANK,
        }:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Status avulso permitido apenas para aprovação, eliminação ou banco de talentos.",
            )

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT status_candidato
                FROM candidatos_processos
                WHERE id_teste = ?
                ORDER BY id_registro DESC
                """,
                (safe_id_teste,),
            )
            process_rows = rows_to_dicts(cursor, cursor.fetchall())
            if any(
                canonicalize_candidate_status(row.get("status_candidato")) == CANDIDATE_STATUS_APPROVED
                for row in process_rows
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=build_approved_candidate_locked_message(),
                )

            cursor.execute(
                """
                SELECT TOP 1 id_teste, status
                FROM historico_provas
                WHERE id_teste = ?
                ORDER BY data_iso DESC
                """,
                (safe_id_teste,),
            )
            history_row = cursor.fetchone()
            if history_row:
                current_status = canonicalize_candidate_status(history_row[1])
                if normalize_compare_text(current_status) == normalize_compare_text(CANDIDATE_STATUS_APPROVED):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=build_approved_candidate_locked_message(),
                    )

            # Correções.txt (23/set/2026): um candidato de "prova avulsa" só ganha
            # linha em historico_provas quando a prova é finalizada — enquanto ela
            # está "Em andamento" (ver _get_standalone_generated_exam_candidates em
            # base.py), o candidato já aparece em "Decisões Finais Pendentes" mas
            # esse SELECT acima não encontra nada, e o 404 antigo aqui impedia
            # Eliminar/Enviar para Banco de Talentos de funcionar (Aprovar também
            # seria afetado, mas passa primeiro por um modal, então o clique
            # "parecia" funcionar). provas_geradas é a fonte real desses
            # candidatos — usa ela para confirmar que o candidato existe antes de
            # decidir se atualiza ou insere o histórico.
            cursor.execute(
                """
                SELECT TOP 1 nome_candidato
                FROM (
                    SELECT nome_candidato FROM candidatos_processos WHERE id_teste = ?
                    UNION ALL
                    SELECT nome_candidato FROM banco_talentos WHERE id_teste = ?
                    UNION ALL
                    SELECT nome_candidato FROM historico_provas WHERE id_teste = ?
                    UNION ALL
                    SELECT nome_candidato FROM provas_geradas WHERE id_teste = ?
                ) origem
                """,
                (safe_id_teste, safe_id_teste, safe_id_teste, safe_id_teste),
            )
            candidate_name_row = cursor.fetchone()
            if not history_row and not candidate_name_row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado para atualizar o status.")

            candidate_name = normalize_text(candidate_name_row[0]) if candidate_name_row else ""

            vaga_row = None
            cursor.execute(
                "SELECT TOP 1 vaga, trilha, nivel FROM provas_geradas WHERE id_teste = ? ORDER BY atualizado_em DESC",
                (safe_id_teste,),
            )
            vaga_row = cursor.fetchone()

            cursor.execute(
                """
                UPDATE historico_provas
                SET status = ?
                WHERE id_teste = ?
                """,
                (requested_status, safe_id_teste),
            )
            precisa_inserir_historico = cursor.rowcount < 1
            cursor.execute(
                """
                UPDATE entrevistas_agendadas
                SET status_entrevista = ?, atualizado_em = GETDATE()
                WHERE id_teste = ? AND ISNULL(id_teste, '') <> ''
                """,
                (requested_status, safe_id_teste),
            )
            conn.commit()
            self.logger.info("Status avulso do candidato %s atualizado para '%s'.", safe_id_teste, requested_status)

            if precisa_inserir_historico:
                # Feito com a transação acima já commitada (conexão própria em
                # save_history) para não travar em lock cruzado entre as duas
                # conexões sobre a mesma tabela historico_provas.
                self.save_history({
                    "id_teste": safe_id_teste,
                    "nome_candidato": candidate_name,
                    "vaga": normalize_text(vaga_row[0]) if vaga_row else "",
                    "trilha": normalize_text(vaga_row[1]) if vaga_row else "",
                    "nivel": normalize_text(vaga_row[2]) if vaga_row else "",
                    "data_iso": datetime.now().isoformat(),
                    "status": requested_status,
                })

            if requested_status == CANDIDATE_STATUS_TALENT_BANK and candidate_name:
                self.add_candidate_to_talent_bank({
                    "id_teste": safe_id_teste,
                    "nome_candidato": candidate_name,
                    "origem": "Prova avulsa",
                })

            return {"success": True, "status_candidato": requested_status}
        finally:
            conn.close()

    def upsert_candidate_profile(self, id_teste: str, data: dict) -> dict:
        safe_id_teste = normalize_text(id_teste)
        if not safe_id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identificador do candidato não informado.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT TOP 1 nome_candidato
                FROM (
                    SELECT nome_candidato FROM candidatos_processos WHERE id_teste = ?
                    UNION ALL
                    SELECT nome_candidato FROM banco_talentos WHERE id_teste = ?
                    UNION ALL
                    SELECT nome_candidato FROM historico_provas WHERE id_teste = ?
                ) origem
                """,
                (safe_id_teste, safe_id_teste, safe_id_teste),
            )
            candidate_row = cursor.fetchone()
            if not candidate_row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado para atualizar o perfil.")

            safe_name = normalize_text(data.get("nome_candidato")) or normalize_text(candidate_row[0])
            if not safe_name:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome do candidato.")

            safe_email = normalize_text(data.get("email"))
            if safe_email and not is_valid_email(safe_email):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um e-mail válido.")

            safe_phone = normalize_text(data.get("telefone"))
            safe_whatsapp = normalize_text(data.get("whatsapp"))
            if safe_phone and not is_valid_phone(safe_phone):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um telefone válido.")
            if safe_whatsapp and not is_valid_phone(safe_whatsapp):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe um WhatsApp válido.")

            safe_skills = normalize_string_list(data.get("habilidades", []))
            safe_tags = normalize_string_list(data.get("tags", []))
            safe_recommendation = normalize_profile_recommendation(data.get("classificacao_indicacao"))

            self._upsert_candidate_profile(
                cursor,
                id_teste=safe_id_teste,
                nome_candidato=safe_name,
                habilidades=safe_skills or None,
                tags=safe_tags or None,
                observacao_rh=(
                    data.get("observacao_rh")
                    if "observacao_rh" in data
                    else None
                ),
                classificacao_indicacao=safe_recommendation if "classificacao_indicacao" in data else None,
                justificativa_indicacao=(
                    data.get("justificativa_indicacao")
                    if "justificativa_indicacao" in data
                    else None
                ),
                email=safe_email or None,
                telefone=safe_phone or None,
                whatsapp=safe_whatsapp or None,
                endereco=data.get("endereco") if "endereco" in data else None,
                cidade=data.get("cidade") if normalize_text(data.get("cidade")) else None,
                bairro=data.get("bairro") if normalize_text(data.get("bairro")) else None,
                data_nascimento=data.get("data_nascimento") if "data_nascimento" in data else None,
                escolaridade=data.get("escolaridade") if "escolaridade" in data else None,
                possui_experiencia=data.get("possui_experiencia") if "possui_experiencia" in data else None,
                musica=data.get("musica") if "musica" in data else None,
                prato=data.get("prato") if "prato" in data else None,
                futebol=data.get("futebol") if "futebol" in data else None,
                time=data.get("time") if "time" in data else None,
                rede_social=data.get("rede_social") if "rede_social" in data else None,
            )
            self._sync_candidate_identity_copies(
                cursor,
                id_teste=safe_id_teste,
                nome_candidato=safe_name,
                email=safe_email or None,
                telefone=safe_phone or None,
                whatsapp=safe_whatsapp or None,
            )
            conn.commit()
            cursor.execute(
                """
                SELECT
                    nome_candidato,
                    habilidades_json,
                    tags_json,
                    observacao_rh,
                    classificacao_indicacao,
                    justificativa_indicacao,
                    email,
                    telefone,
                    whatsapp,
                    endereco,
                    cidade,
                    bairro,
                    escolaridade,
                    possui_experiencia,
                    musica,
                    prato,
                    futebol,
                    time,
                    rede_social
                FROM candidatos_metadata
                WHERE id_teste = ?
                """,
                (safe_id_teste,),
            )
            updated = cursor.fetchone()
            self.logger.info("Perfil RH atualizado para o candidato %s.", safe_id_teste)
            return {
                "success": True,
                "candidato": self._serialize_candidate_profile(
                    {
                        "nome_candidato": updated[0] if updated else safe_name,
                        "habilidades_json": updated[1] if updated else "[]",
                        "tags_json": updated[2] if updated else "[]",
                        "observacao_rh": updated[3] if updated else data.get("observacao_rh", ""),
                        "classificacao_indicacao": updated[4] if updated else safe_recommendation,
                        "justificativa_indicacao": updated[5] if updated else data.get("justificativa_indicacao", ""),
                        "email": updated[6] if updated else safe_email,
                        "telefone": updated[7] if updated else safe_phone,
                        "whatsapp": updated[8] if updated else safe_whatsapp,
                        "endereco": updated[9] if updated else data.get("endereco", ""),
                        "cidade": updated[10] if updated else data.get("cidade", ""),
                        "bairro": updated[11] if updated else data.get("bairro", ""),
                        "escolaridade": updated[12] if updated else data.get("escolaridade", ""),
                        "possui_experiencia": updated[13] if updated else data.get("possui_experiencia", ""),
                        "musica": updated[14] if updated else data.get("musica", ""),
                        "prato": updated[15] if updated else data.get("prato", ""),
                        "futebol": updated[16] if updated else data.get("futebol", ""),
                        "time": updated[17] if updated else data.get("time", ""),
                        "rede_social": updated[18] if updated else data.get("rede_social", ""),
                    }
                ),
            }
        finally:
            conn.close()

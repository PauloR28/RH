from __future__ import annotations

import json

from fastapi import HTTPException, status

from ..services.disc_engine import calcular_aderencia_call_center, calcular_perfil_disc
from ..services.helpers import normalize_text, rows_to_dicts, safe_json_loads
from .bootstrap import ensure_disc_tables


class DiscRepositoryMixin:
    """Teste DISC próprio (Conecta Provas), calibrado para o perfil Call Center."""

    # ------------------------------------------------------------------
    # Banco de blocos/frases (administração)
    # ------------------------------------------------------------------
    def list_disc_blocos(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute(
                "SELECT id_bloco, ordem, ativo, criado_em FROM dbo.disc_blocos WHERE ativo = 1 ORDER BY ordem ASC, id_bloco ASC"
            )
            blocos = rows_to_dicts(cursor, cursor.fetchall())
            for bloco in blocos:
                cursor.execute(
                    "SELECT id_frase, bloco_id, dimensao, texto, ordem FROM dbo.disc_frases WHERE bloco_id = ? ORDER BY ordem ASC, id_frase ASC",
                    (int(bloco["id_bloco"]),),
                )
                bloco["frases"] = rows_to_dicts(cursor, cursor.fetchall())
            return blocos
        finally:
            conn.close()

    def create_disc_bloco(self, data: dict) -> dict:
        frases = data.get("frases") or []
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute(
                "INSERT INTO dbo.disc_blocos (ordem, ativo, criado_em) OUTPUT INSERTED.id_bloco VALUES (?, 1, GETDATE())",
                (int(data.get("ordem") or 0),),
            )
            id_bloco = int(cursor.fetchone()[0])
            for frase in frases:
                cursor.execute(
                    "INSERT INTO dbo.disc_frases (bloco_id, dimensao, texto, ordem) VALUES (?, ?, ?, ?)",
                    (id_bloco, frase.get("dimensao"), normalize_text(frase.get("texto")), 0),
                )
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "id_bloco": id_bloco}

    def update_disc_bloco(self, id_bloco: int, data: dict) -> dict:
        """Correções.txt item 7: edição de um bloco já cadastrado (frases e
        ordem) — as 4 frases são casadas por id_frase, então respostas já
        registradas em dbo.disc_respostas continuam válidas (FK intacta)."""
        frases = data.get("frases") or []
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute("SELECT id_bloco FROM dbo.disc_blocos WHERE id_bloco = ? AND ativo = 1", (int(id_bloco),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bloco DISC não encontrado.")

            cursor.execute(
                "UPDATE dbo.disc_blocos SET ordem = ? WHERE id_bloco = ?",
                (int(data.get("ordem") or 0), int(id_bloco)),
            )

            cursor.execute("SELECT id_frase FROM dbo.disc_frases WHERE bloco_id = ? ORDER BY ordem ASC, id_frase ASC", (int(id_bloco),))
            frases_existentes = [int(row[0]) for row in cursor.fetchall()]
            if len(frases_existentes) != len(frases):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="O bloco precisa continuar com exatamente 4 frases.",
                )
            for id_frase, frase in zip(frases_existentes, frases):
                cursor.execute(
                    "UPDATE dbo.disc_frases SET dimensao = ?, texto = ? WHERE id_frase = ? AND bloco_id = ?",
                    (frase.get("dimensao"), normalize_text(frase.get("texto")), id_frase, int(id_bloco)),
                )
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "id_bloco": int(id_bloco)}

    # ------------------------------------------------------------------
    # Aplicação por candidato
    # ------------------------------------------------------------------
    def create_disc_aplicacao(self, data: dict) -> dict:
        id_teste = normalize_text(data.get("id_teste"))
        if not id_teste:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o candidato para a aplicação do teste DISC.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute(
                """
                INSERT INTO dbo.disc_aplicacoes (id_teste, id_processo_ref, status, iniciada_em, criada_em)
                OUTPUT INSERTED.id_aplicacao
                VALUES (?, ?, 'Disponivel', GETDATE(), GETDATE())
                """,
                (id_teste, data.get("id_processo_ref")),
            )
            id_aplicacao = int(cursor.fetchone()[0])
            conn.commit()
        finally:
            conn.close()
        return self.get_disc_aplicacao(id_aplicacao)

    def get_disc_aplicacao(self, id_aplicacao: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute(
                """
                SELECT id_aplicacao, id_teste, id_processo_ref, status, iniciada_em, finalizada_em, resultado_json, criada_em
                FROM dbo.disc_aplicacoes WHERE id_aplicacao = ?
                """,
                (int(id_aplicacao or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aplicação de teste DISC não encontrada.")
            aplicacao = rows[0]
            aplicacao["resultado"] = safe_json_loads(aplicacao.pop("resultado_json", None), None)

            cursor.execute(
                "SELECT id_bloco, ordem FROM dbo.disc_blocos WHERE ativo = 1 ORDER BY ordem ASC, id_bloco ASC"
            )
            blocos = rows_to_dicts(cursor, cursor.fetchall())
            for bloco in blocos:
                cursor.execute(
                    "SELECT id_frase, dimensao, texto FROM dbo.disc_frases WHERE bloco_id = ? ORDER BY ordem ASC, id_frase ASC",
                    (int(bloco["id_bloco"]),),
                )
                # A dimensão não é exposta ao candidato para não influenciar a resposta.
                frases = rows_to_dicts(cursor, cursor.fetchall())
                bloco["frases"] = [{"id_frase": f["id_frase"], "texto": f["texto"]} for f in frases]
            aplicacao["blocos"] = blocos
            return aplicacao
        finally:
            conn.close()

    def finalize_disc_aplicacao(self, id_aplicacao: int, data: dict) -> dict:
        respostas = data.get("respostas") or []

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute("SELECT id_aplicacao FROM dbo.disc_aplicacoes WHERE id_aplicacao = ?", (int(id_aplicacao or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aplicação de teste DISC não encontrada.")

            cursor.execute("SELECT id_frase, dimensao FROM dbo.disc_frases")
            frases_por_id = {int(row[0]): {"dimensao": row[1]} for row in cursor.fetchall()}

            for resposta in respostas:
                cursor.execute(
                    """
                    INSERT INTO dbo.disc_respostas (aplicacao_id, bloco_id, frase_mais_id, frase_menos_id, respondido_em)
                    VALUES (?, ?, ?, ?, GETDATE())
                    """,
                    (
                        int(id_aplicacao),
                        int(resposta.get("bloco_id")),
                        int(resposta.get("frase_mais_id")),
                        int(resposta.get("frase_menos_id")),
                    ),
                )

            perfil = calcular_perfil_disc(
                [
                    {"frase_mais_id": int(r.get("frase_mais_id")), "frase_menos_id": int(r.get("frase_menos_id"))}
                    for r in respostas
                ],
                frases_por_id,
            )
            aderencia = calcular_aderencia_call_center(perfil["percentuais"])
            resultado = {"perfil": perfil, "aderencia_call_center": aderencia}

            cursor.execute(
                """
                UPDATE dbo.disc_aplicacoes
                SET status = 'Finalizada', finalizada_em = GETDATE(), resultado_json = ?
                WHERE id_aplicacao = ?
                """,
                (json.dumps(resultado, ensure_ascii=False), int(id_aplicacao)),
            )
            conn.commit()
        finally:
            conn.close()

        return {"success": True, "id_aplicacao": int(id_aplicacao), "status": "Finalizada", "resultado": resultado}

    def get_disc_resultado_candidato(self, id_teste: str) -> dict:
        id_teste = normalize_text(id_teste)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_disc_tables(cursor)
            cursor.execute(
                """
                SELECT TOP 1 id_aplicacao, status, finalizada_em, resultado_json
                FROM dbo.disc_aplicacoes
                WHERE id_teste = ? AND resultado_json IS NOT NULL
                ORDER BY finalizada_em DESC, id_aplicacao DESC
                """,
                (id_teste,),
            )
            row = cursor.fetchone()
            if not row:
                return {"possui_resultado": False}
            columns = [c[0] for c in cursor.description]
            data = dict(zip(columns, row))
            return {
                "possui_resultado": True,
                "id_aplicacao": data.get("id_aplicacao"),
                "finalizada_em": data.get("finalizada_em"),
                "resultado": safe_json_loads(data.get("resultado_json"), {}),
            }
        finally:
            conn.close()

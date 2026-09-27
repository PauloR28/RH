from __future__ import annotations

import json

from fastapi import HTTPException, status

from ..rbac import get_role_definition
from ..services.helpers import normalize_text
from ..services.tela_inicial import PERFIS_INICIO_POR_SESSOES, catalogo, config_padrao, normalizar_config
from .bootstrap import ensure_home_screen_config_table


class TelaInicialRepositoryMixin:
    """Configuração da tela inicial por perfil (Perfis e Permissões)."""

    def _ler_config_tela_inicial(self, cursor, perfil: str) -> dict:
        cursor.execute("SELECT config_json FROM dbo.perfis_tela_inicial WHERE id_perfil = ?", (perfil,))
        row = cursor.fetchone()
        if not row or not row[0]:
            return config_padrao()
        try:
            return normalizar_config(json.loads(row[0]))
        except (TypeError, ValueError):
            return config_padrao()

    def get_tela_inicial_perfil(self, perfil: str) -> dict:
        perfil_id = get_role_definition(perfil).id
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_home_screen_config_table(cursor)
            config = self._ler_config_tela_inicial(cursor, perfil_id)
        finally:
            conn.close()
        return {
            "perfil": perfil_id,
            "modo": "sessoes" if perfil_id in PERFIS_INICIO_POR_SESSOES else "completa",
            "catalogo": catalogo(),
            **config,
        }

    def list_tela_inicial_perfis(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_home_screen_config_table(cursor)
            cursor.execute("SELECT id_perfil, config_json FROM dbo.perfis_tela_inicial")
            salvos = {normalize_text(row[0]): row[1] for row in cursor.fetchall()}
        finally:
            conn.close()
        perfis = {}
        for perfil_id, bruto in salvos.items():
            try:
                perfis[perfil_id] = normalizar_config(json.loads(bruto))
            except (TypeError, ValueError):
                perfis[perfil_id] = config_padrao()
        return {
            "catalogo": catalogo(),
            "padrao": config_padrao(),
            "perfis_inicio_por_sessoes": sorted(PERFIS_INICIO_POR_SESSOES),
            "perfis": perfis,
        }

    def save_tela_inicial_perfil(self, perfil: str, data: dict, *, actor: str = "") -> dict:
        definicao = get_role_definition(perfil)
        if normalize_text(perfil) and definicao.id != normalize_text(perfil):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil não encontrado.")
        config = normalizar_config(data)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_home_screen_config_table(cursor)
            conteudo = json.dumps({"blocos": config["blocos"]}, ensure_ascii=False)
            cursor.execute(
                """
                MERGE dbo.perfis_tela_inicial WITH (HOLDLOCK) AS alvo
                USING (SELECT ? AS id_perfil) AS origem ON alvo.id_perfil = origem.id_perfil
                WHEN MATCHED THEN UPDATE SET config_json = ?, atualizado_por = ?, atualizado_em = GETDATE()
                WHEN NOT MATCHED THEN INSERT (id_perfil, config_json, atualizado_por, atualizado_em)
                    VALUES (origem.id_perfil, ?, ?, GETDATE());
                """,
                (definicao.id, conteudo, normalize_text(actor), conteudo, normalize_text(actor)),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_tela_inicial_perfil(definicao.id)

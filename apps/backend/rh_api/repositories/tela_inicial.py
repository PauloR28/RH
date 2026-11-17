from __future__ import annotations

import json

from fastapi import HTTPException, status

from ..rbac import get_role_definition
from ..services.helpers import normalize_text
from ..services.tela_inicial import (
    MODULO_RH,
    MODULOS_INICIO,
    PERFIS_INICIO_POR_SESSOES,
    catalogo,
    config_padrao,
    configs_por_modulo,
    gravar_modulo,
    normalizar_config,
)
from .bootstrap import ensure_home_screen_config_table


def _abrir(texto) -> dict:
    try:
        bruto = json.loads(texto) if texto else {}
    except (TypeError, ValueError):
        return {}
    return bruto if isinstance(bruto, dict) else {}


class TelaInicialRepositoryMixin:
    """Início de cada módulo por perfil (Configurações › Início dos módulos, Etapa 8).

    RH continua na raiz do JSON (formato antigo, nada muda para quem já configurou); Operação e Tecnologia ficam em
    ``modulos``. A resposta mantém os campos antigos (``blocos``, ``atalhos_ocultos`` = RH) e acrescenta ``modulos``.
    """

    def _ler_bruto_tela_inicial(self, cursor, perfil: str) -> dict:
        cursor.execute("SELECT config_json FROM dbo.perfis_tela_inicial WHERE id_perfil = ?", (perfil,))
        row = cursor.fetchone()
        return _abrir(row[0]) if row else {}

    @staticmethod
    def _resposta_tela_inicial(bruto: dict) -> dict:
        por_modulo = configs_por_modulo(bruto)
        return {**por_modulo[MODULO_RH], "modulos": por_modulo}

    def get_tela_inicial_perfil(self, perfil: str) -> dict:
        perfil_id = get_role_definition(perfil).id
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_home_screen_config_table(cursor)
            bruto = self._ler_bruto_tela_inicial(cursor, perfil_id)
        finally:
            conn.close()
        return {
            "perfil": perfil_id,
            "modo": "sessoes" if perfil_id in PERFIS_INICIO_POR_SESSOES else "completa",
            "catalogo": catalogo(),
            **self._resposta_tela_inicial(bruto),
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
        return {
            "catalogo": catalogo(),
            "padrao": config_padrao(),
            "catalogos": {modulo: catalogo(modulo) for modulo in MODULOS_INICIO},
            "padroes": {modulo: config_padrao(modulo) for modulo in MODULOS_INICIO},
            "perfis_inicio_por_sessoes": sorted(PERFIS_INICIO_POR_SESSOES),
            "perfis": {perfil_id: self._resposta_tela_inicial(_abrir(bruto)) for perfil_id, bruto in salvos.items()},
        }

    def save_tela_inicial_perfil(self, perfil: str, data: dict, *, actor: str = "", modulo: str = MODULO_RH) -> dict:
        definicao = get_role_definition(perfil)
        if normalize_text(perfil) and definicao.id != normalize_text(perfil):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil não encontrado.")
        if modulo not in MODULOS_INICIO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Módulo inválido.")
        config = normalizar_config(data, modulo)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_home_screen_config_table(cursor)
            bruto = gravar_modulo(self._ler_bruto_tela_inicial(cursor, definicao.id), modulo, config)
            conteudo = json.dumps(bruto, ensure_ascii=False)
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

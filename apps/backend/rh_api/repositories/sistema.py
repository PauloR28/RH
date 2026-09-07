from __future__ import annotations

import os

from fastapi import HTTPException, status

from ..auth import AuthenticatedUser
from ..rbac import ROLE_ADMIN, SETTINGS_CATALOGS
from ..services.helpers import normalize_text, rows_to_dicts
from .bootstrap import RESET_FLAG_KEY, ensure_parametros_sistema_table


RESET_CONFIRMATION_PHRASE = "LIMPAR CONECTA"

# Tabelas com dado operacional/transacional a zerar em "Limpar o Conecta",
# na ordem (filhas antes das tabelas-mãe) — não há FK entre elas hoje
# (achado DB-004), mas a ordem evita lixo referencial mesmo assim.
_RESET_TABLE_ORDER: tuple[str, ...] = (
    "analise_excel_detalhes",
    "analise_texto_detalhes",
    "analise_metricas_respostas",
    "analise_sessoes_etapas",
    "analise_jobs_provas",
    "resultados_analiticos_categorias",
    "historico_resultados_analiticos",
    "mapeamentos_categorias_analiticas",
    "perfis_ideais_analiticos",
    "pesos_analiticos_processos",
    "configuracoes_analiticas_processos",
    "categorias_analiticas",
    "resultados_analiticos_processos",
    "historico_correcoes_manuais_provas",
    "respostas_provas",
    "resultados_provas",
    "disc_respostas",
    "disc_aplicacoes",
    "disc_frases",
    "disc_blocos",
    "fit_cultural_respostas",
    "valores_empresa_frases",
    "valores_empresa",
    "raciocinio_respostas",
    "raciocinio_aplicacoes",
    "raciocinio_perguntas",
    "onboarding_candidatos_itens",
    "onboarding_candidatos",
    "trilhas_onboarding_anexos",
    "trilhas_onboarding_itens",
    "trilhas_onboarding",
    "processos_treinamentos",
    "notificacoes",
    "solicitacoes_alteracao_email",
    "candidatos_movimentacoes",
    "candidatos_anexos",
    "candidatos_metadata",
    "processos_dossie_anotacoes",
    "scorecards_avaliacao",
    "cv_pre_analises",
    "analises_curriculo_ia",
    "entrevistas_agendadas",
    "entrevista_slots",
    "decisoes_rh",
    "email_inbox_items",
    "banco_talentos",
    "scores_conecta",
    "provas_geradas",
    "gabaritos",
    "historico_provas",
    "candidatos_processos",
    "candidatos",
    "processos_seletivos",
    "processos_alertas_inatividade",
    "configuracoes_notificacoes_automaticas",
    "datas_comemorativas",
    "politicas_confirmacoes",
    "politicas",
    "templates_documentos",
    "usuarios_operacoes",
    "operacoes",
)


def _mask_tail(value: str | None, keep: int = 4) -> str:
    texto = normalize_text(value)
    if not texto:
        return ""
    if len(texto) <= keep:
        return "•" * len(texto)
    return "•" * (len(texto) - keep) + texto[-keep:]


def _nome_ator(actor: AuthenticatedUser | dict | None) -> str:
    if isinstance(actor, AuthenticatedUser):
        return normalize_text(actor.nome or actor.username)
    if isinstance(actor, dict):
        return normalize_text(actor.get("nome") or actor.get("username") or actor.get("login"))
    return ""


class SistemaRepositoryMixin:
    def list_parametros_sistema(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_parametros_sistema_table(cursor)
            cursor.execute(
                """
                SELECT id_parametro, chave, valor, categoria, descricao, mascarado, atualizado_por, atualizado_em
                FROM dbo.parametros_sistema
                WHERE categoria <> 'sistema_interno'
                ORDER BY categoria, chave
                """
            )
            itens = []
            for row in rows_to_dicts(cursor, cursor.fetchall()):
                item = dict(row)
                item["mascarado"] = bool(item.get("mascarado"))
                itens.append(item)
            return {"itens": itens}
        finally:
            conn.close()

    def upsert_parametro_sistema(
        self,
        chave: str,
        data: dict,
        *,
        actor: AuthenticatedUser | dict | None = None,
    ) -> dict:
        chave_normalizada = normalize_text(chave)
        if not chave_normalizada:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chave do parâmetro é obrigatória.")

        valor = data.get("valor") if data.get("valor") is not None else ""
        categoria = normalize_text(data.get("categoria")) or "geral"
        if categoria == "sistema_interno":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoria reservada ao sistema.")
        descricao = normalize_text(data.get("descricao"))
        mascarado = 1 if data.get("mascarado") else 0
        nome_ator = _nome_ator(actor)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_parametros_sistema_table(cursor)
            cursor.execute("SELECT id_parametro FROM dbo.parametros_sistema WHERE chave = ?", (chave_normalizada,))
            existente = cursor.fetchone()
            if existente:
                cursor.execute(
                    """
                    UPDATE dbo.parametros_sistema
                    SET valor = ?, categoria = ?, descricao = ?, mascarado = ?,
                        atualizado_por = ?, atualizado_em = GETDATE()
                    WHERE chave = ?
                    """,
                    (valor, categoria, descricao, mascarado, nome_ator, chave_normalizada),
                )
                acao = "editar_parametro_sistema"
            else:
                cursor.execute(
                    """
                    INSERT INTO dbo.parametros_sistema
                        (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
                    VALUES (?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                    """,
                    (chave_normalizada, valor, categoria, descricao, mascarado, nome_ator),
                )
                acao = "criar_parametro_sistema"

            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Configurações",
                acao=acao,
                entidade="parametros_sistema",
                entidade_id=chave_normalizada,
                valor_anterior=None,
                valor_novo={"categoria": categoria, "mascarado": bool(mascarado)},
                justificativa=normalize_text(data.get("justificativa")),
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "chave": chave_normalizada}
        finally:
            conn.close()

    def describe_infraestrutura_credenciais(self) -> dict:
        settings = self.settings
        senha_smtp_configurada = bool(
            settings.email_smtp_password_env and os.getenv(settings.email_smtp_password_env)
        )
        return {
            "sharepoint": {
                "tenant_id": _mask_tail(settings.sharepoint_tenant_id),
                "client_id": _mask_tail(settings.sharepoint_client_id),
                "client_secret_configurado": bool(settings.sharepoint_client_secret),
                "scope": settings.sharepoint_scope,
                "graph_base_url": settings.sharepoint_graph_base_url,
            },
            "email_smtp": {
                "habilitado": bool(settings.email_smtp_enabled),
                "host": settings.email_smtp_host,
                "porta": settings.email_smtp_port,
                "usuario": _mask_tail(settings.email_smtp_username, keep=3),
                "senha_configurada": senha_smtp_configurada,
                "remetente": settings.email_smtp_from,
            },
        }

    def resetar_dados_conecta(
        self,
        *,
        actor: AuthenticatedUser,
        confirmacao: str,
    ) -> dict:
        if normalize_text(confirmacao).strip().upper() != RESET_CONFIRMATION_PHRASE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f'Confirmação inválida. Digite exatamente "{RESET_CONFIRMATION_PHRASE}" para prosseguir.',
            )

        tabelas_catalogo = {definition["table"] for definition in SETTINGS_CATALOGS.values()}
        tabelas = list(_RESET_TABLE_ORDER) + [
            tabela for tabela in sorted(tabelas_catalogo) if tabela not in _RESET_TABLE_ORDER
        ]

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_parametros_sistema_table(cursor)

            for tabela in tabelas:
                cursor.execute(f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL DELETE FROM dbo.{tabela}")

            cursor.execute("DELETE FROM dbo.usuarios WHERE perfil_id <> ?", (ROLE_ADMIN,))

            nome_ator = _nome_ator(actor)
            cursor.execute("SELECT id_parametro FROM dbo.parametros_sistema WHERE chave = ?", (RESET_FLAG_KEY,))
            if cursor.fetchone():
                cursor.execute(
                    """
                    UPDATE dbo.parametros_sistema
                    SET valor = CONVERT(NVARCHAR(40), GETDATE(), 126), atualizado_por = ?, atualizado_em = GETDATE()
                    WHERE chave = ?
                    """,
                    (nome_ator, RESET_FLAG_KEY),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO dbo.parametros_sistema
                        (chave, valor, categoria, descricao, mascarado, atualizado_por, criado_em, atualizado_em)
                    VALUES (?, CONVERT(NVARCHAR(40), GETDATE(), 126), 'sistema_interno', ?, 0, ?, GETDATE(), GETDATE())
                    """,
                    (
                        RESET_FLAG_KEY,
                        "Marca que os dados operacionais do Conecta foram zerados pelo Administrador.",
                        nome_ator,
                    ),
                )

            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Administração",
                acao="resetar_dados_conecta",
                entidade="sistema",
                entidade_id="reset_geral",
                valor_anterior=None,
                valor_novo={"tabelas_afetadas": len(tabelas)},
                justificativa="Limpeza total dos dados operacionais do Conecta solicitada pelo Administrador.",
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "tabelas_limpas": len(tabelas)}
        finally:
            conn.close()

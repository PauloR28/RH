from __future__ import annotations

import os
from urllib.parse import urlsplit

from fastapi import HTTPException, status

from ..auth import AuthenticatedUser
from ..rbac import ROLE_ADMIN, SETTINGS_CATALOGS
from ..services.graph_client import GraphClient, GraphClientError
from ..services.helpers import normalize_text, rows_to_dicts
from .bootstrap import (
    RESET_FLAG_KEY,
    ensure_ambientes_sharepoint_table,
    ensure_parametros_sistema_table,
)


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
    "ambientes_sharepoint",
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
        secret_inbox_configurado = bool(
            settings.email_inbox_client_secret_env and os.getenv(settings.email_inbox_client_secret_env)
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
                "usa_tls": bool(settings.email_smtp_use_tls),
                "usa_ssl": bool(settings.email_smtp_use_ssl),
            },
            "email_inbox": {
                "habilitado": bool(settings.email_inbox_enabled),
                "protocolo": settings.email_inbox_protocol,
                "provedor": settings.email_inbox_provider,
                "endereco": _mask_tail(settings.email_inbox_address, keep=6),
                "caixa": settings.email_inbox_mailbox,
                "tenant_id": _mask_tail(settings.email_inbox_tenant_id),
                "client_id": _mask_tail(settings.email_inbox_client_id),
                "client_secret_configurado": secret_inbox_configurado,
            },
        }

    def list_ambientes_sharepoint(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_ambientes_sharepoint_table(cursor)
            cursor.execute(
                """
                SELECT a.id_ambiente, a.nome, a.operacao_id, o.nome AS operacao_nome,
                       a.site_url, a.hostname, a.site_path, a.site_id, a.biblioteca_destino,
                       a.status, a.ultima_mensagem_teste, a.testado_em,
                       a.criado_por, a.criado_em, a.atualizado_por, a.atualizado_em
                FROM dbo.ambientes_sharepoint a
                LEFT JOIN dbo.operacoes o ON o.id_item = a.operacao_id
                WHERE a.ativo = 1
                ORDER BY a.criado_em DESC
                """
            )
            return {"itens": rows_to_dicts(cursor, cursor.fetchall())}
        finally:
            conn.close()

    def _parse_sharepoint_site_url(self, site_url: str) -> tuple[str, str]:
        partes = urlsplit(site_url if "://" in site_url else f"https://{site_url}")
        hostname = normalize_text(partes.netloc)
        caminho = normalize_text(partes.path).rstrip("/")
        if not hostname or not caminho:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Informe a URL completa do site do SharePoint, ex.: https://suaempresa.sharepoint.com/sites/NomeDoSite.",
            )
        return hostname, caminho

    def criar_ambiente_sharepoint(
        self,
        data: dict,
        *,
        actor: AuthenticatedUser | dict | None = None,
    ) -> dict:
        nome = normalize_text(data.get("nome"))
        site_url = normalize_text(data.get("site_url"))
        if not nome or not site_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Informe o nome do ambiente e a URL do site do SharePoint.",
            )
        hostname, site_path = self._parse_sharepoint_site_url(site_url)
        operacao_id = data.get("operacao_id") or None
        biblioteca_destino = normalize_text(data.get("biblioteca_destino"))
        nome_ator = _nome_ator(actor)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_ambientes_sharepoint_table(cursor)
            cursor.execute(
                """
                INSERT INTO dbo.ambientes_sharepoint
                    (nome, operacao_id, site_url, hostname, site_path, biblioteca_destino,
                     status, criado_por, atualizado_por, criado_em, atualizado_em)
                OUTPUT INSERTED.id_ambiente
                VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?, GETDATE(), GETDATE())
                """,
                (nome, operacao_id, site_url, hostname, site_path, biblioteca_destino, nome_ator, nome_ator),
            )
            id_ambiente = int(cursor.fetchone()[0])
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Administração",
                acao="criar_ambiente_sharepoint",
                entidade="ambientes_sharepoint",
                entidade_id=str(id_ambiente),
                valor_anterior=None,
                valor_novo={"nome": nome, "site_url": site_url, "operacao_id": operacao_id},
                sucesso=True,
            )
            conn.commit()
            return {"success": True, "id_ambiente": id_ambiente}
        finally:
            conn.close()

    def testar_ambiente_sharepoint(
        self,
        id_ambiente: int,
        *,
        actor: AuthenticatedUser | dict | None = None,
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_ambientes_sharepoint_table(cursor)
            cursor.execute(
                "SELECT hostname, site_path FROM dbo.ambientes_sharepoint WHERE id_ambiente = ? AND ativo = 1",
                (id_ambiente,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ambiente não encontrado.")
            hostname, site_path = row[0], row[1]

            settings = self.settings
            client = GraphClient(
                tenant_id=settings.sharepoint_tenant_id,
                client_id=settings.sharepoint_client_id,
                client_secret=settings.sharepoint_client_secret,
                scope=settings.sharepoint_scope,
                base_url=settings.sharepoint_graph_base_url,
                unconfigured_message=(
                    "As credenciais do aplicativo Microsoft (tenant/client/secret) ainda não "
                    "foram configuradas no servidor — fale com o time de tecnologia antes de "
                    "adicionar ambientes."
                ),
            )

            status_novo = "erro"
            mensagem = ""
            site_id = None
            try:
                resultado = client.get_json(f"sites/{hostname}:{site_path}")
                site_id = normalize_text(resultado.get("id"))
                if site_id:
                    status_novo = "conectado"
                    mensagem = "Conexão validada com sucesso."
                else:
                    mensagem = "O Microsoft Graph respondeu, mas não retornou o identificador do site."
            except GraphClientError as exc:
                mensagem = normalize_text(exc.detail) or "Não foi possível validar a conexão com este site."

            nome_ator = _nome_ator(actor)
            cursor.execute(
                """
                UPDATE dbo.ambientes_sharepoint
                SET status = ?, site_id = ?, ultima_mensagem_teste = ?, testado_em = GETDATE(),
                    atualizado_por = ?, atualizado_em = GETDATE()
                WHERE id_ambiente = ?
                """,
                (status_novo, site_id, mensagem, nome_ator, id_ambiente),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Administração",
                acao="testar_ambiente_sharepoint",
                entidade="ambientes_sharepoint",
                entidade_id=str(id_ambiente),
                valor_anterior=None,
                valor_novo={"status": status_novo},
                sucesso=status_novo == "conectado",
            )
            conn.commit()
            return {"success": status_novo == "conectado", "status": status_novo, "mensagem": mensagem}
        finally:
            conn.close()

    def excluir_ambiente_sharepoint(
        self,
        id_ambiente: int,
        *,
        actor: AuthenticatedUser | dict | None = None,
        justificativa: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_ambientes_sharepoint_table(cursor)
            cursor.execute(
                "UPDATE dbo.ambientes_sharepoint SET ativo = 0, atualizado_em = GETDATE() WHERE id_ambiente = ?",
                (id_ambiente,),
            )
            self._insert_audit_log(
                cursor,
                user=actor,
                modulo="Administração",
                acao="remover_ambiente_sharepoint",
                entidade="ambientes_sharepoint",
                entidade_id=str(id_ambiente),
                justificativa=normalize_text(justificativa),
                sucesso=True,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

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

from __future__ import annotations

import base64
import re
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, status

from ..services.graph_client import GraphClient
from ..services.helpers import normalize_text, rows_to_dicts
from .bootstrap import (
    ensure_ambientes_sharepoint_table,
    ensure_mural_publicacao_ambientes_table,
    ensure_mural_publicacao_imagens_table,
    ensure_mural_publicacoes_table,
)

_COLUNAS_PUBLICACAO = """
    id_publicacao,
    titulo,
    resumo,
    conteudo_html,
    categoria,
    status,
    fixado,
    publicado_em,
    criado_por,
    atualizado_por,
    criado_em,
    atualizado_em
"""


def _slugify(titulo: str) -> str:
    base = normalize_text(titulo).lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return base[:80] or "publicacao"


# Prompt.txt (23/set/2026): um emoji fixo por categoria, sempre antes do
# texto do tipo de postagem — mesma lista usada no feed do Mural dentro do
# Conecta (ver EMOJI_CATEGORIA_MURAL em features/mural/index.js).
_EMOJI_CATEGORIA_MURAL = {
    "aviso": "⚠️",
    "comunicado": "📢",
    "evento": "🗓️",
    "campanha": "👍",
    "institucional": "📜",
}


def _titulo_mural_com_categoria(publicacao: dict) -> str:
    """Correções.txt (rodada 16/set/2026): título+imagem chegavam separados
    no SharePoint. O RH continua preenchendo só o título normal — aqui a
    categoria vira prefixo em maiúsculo (facilita filtrar no SharePoint),
    só no item publicado lá fora; o título salvo no Conecta não muda."""
    titulo = normalize_text(publicacao.get("titulo"))
    categoria = normalize_text(publicacao.get("categoria"))
    if not categoria:
        return titulo
    emoji = _EMOJI_CATEGORIA_MURAL.get(categoria.lower())
    prefixo = f"{emoji} {categoria.upper()}" if emoji else categoria.upper()
    return f"{prefixo} - {titulo}"


class MuralRepositoryMixin:
    """Mural: feed de avisos/comunicados do RH (texto rico + imagens), com
    publicação simultânea em uma ou mais intranets (dbo.ambientes_sharepoint)."""

    # ------------------------------------------------------------------
    # Leitura
    # ------------------------------------------------------------------

    def _carregar_imagens_publicacao(self, cursor, id_publicacao: int) -> list[dict]:
        cursor.execute(
            """
            SELECT id_imagem, id_publicacao, url, nome_arquivo_original, ordem, criado_em
            FROM dbo.mural_publicacao_imagens
            WHERE id_publicacao = ?
            ORDER BY ordem ASC, id_imagem ASC
            """,
            (int(id_publicacao),),
        )
        return rows_to_dicts(cursor, cursor.fetchall())

    def _carregar_ambientes_publicacao(self, cursor, id_publicacao: int) -> list[dict]:
        cursor.execute(
            """
            SELECT pa.id_publicacao, pa.id_ambiente, a.nome AS ambiente_nome,
                   pa.status_envio, pa.enviado_em, pa.mensagem_erro, pa.sharepoint_web_url,
                   pa.sharepoint_list_item_id
            FROM dbo.mural_publicacao_ambientes pa
            LEFT JOIN dbo.ambientes_sharepoint a ON a.id_ambiente = pa.id_ambiente
            WHERE pa.id_publicacao = ?
            ORDER BY a.nome ASC
            """,
            (int(id_publicacao),),
        )
        return rows_to_dicts(cursor, cursor.fetchall())

    def list_mural_publicacoes(self, status_filtro: str = "") -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            ensure_mural_publicacao_imagens_table(cursor)
            ensure_mural_publicacao_ambientes_table(cursor)
            safe_status = normalize_text(status_filtro)
            if safe_status:
                cursor.execute(
                    f"""
                    SELECT {_COLUNAS_PUBLICACAO} FROM dbo.mural_publicacoes
                    WHERE status = ?
                    ORDER BY fixado DESC, COALESCE(publicado_em, criado_em) DESC
                    """,
                    (safe_status,),
                )
            else:
                cursor.execute(
                    f"""
                    SELECT {_COLUNAS_PUBLICACAO} FROM dbo.mural_publicacoes
                    WHERE status <> 'arquivado'
                    ORDER BY fixado DESC, COALESCE(publicado_em, criado_em) DESC
                    """
                )
            publicacoes = rows_to_dicts(cursor, cursor.fetchall())
            for publicacao in publicacoes:
                id_publicacao = int(publicacao["id_publicacao"])
                publicacao["imagens"] = self._carregar_imagens_publicacao(cursor, id_publicacao)
                publicacao["ambientes"] = self._carregar_ambientes_publicacao(cursor, id_publicacao)
            return publicacoes
        finally:
            conn.close()

    def get_mural_publicacao(self, id_publicacao: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            ensure_mural_publicacao_imagens_table(cursor)
            ensure_mural_publicacao_ambientes_table(cursor)
            cursor.execute(
                f"SELECT {_COLUNAS_PUBLICACAO} FROM dbo.mural_publicacoes WHERE id_publicacao = ?",
                (int(id_publicacao or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicação não encontrada.")
            publicacao = rows[0]
            publicacao["imagens"] = self._carregar_imagens_publicacao(cursor, id_publicacao)
            publicacao["ambientes"] = self._carregar_ambientes_publicacao(cursor, id_publicacao)
            return publicacao
        finally:
            conn.close()

    def list_mural_ambientes_disponiveis(self) -> list[dict]:
        """Intranets já testadas/conectadas (dbo.ambientes_sharepoint) — só
        essas podem ser escolhidas como alvo de uma publicação."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_ambientes_sharepoint_table(cursor)
            cursor.execute(
                """
                SELECT a.id_ambiente, a.nome, a.operacao_id, o.nome AS operacao_nome, a.status
                FROM dbo.ambientes_sharepoint a
                LEFT JOIN dbo.operacoes o ON o.id_item = a.operacao_id
                WHERE a.ativo = 1 AND a.status = 'conectado'
                ORDER BY a.nome ASC
                """
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Escrita
    # ------------------------------------------------------------------

    @staticmethod
    def _validar_publicacao_input(data: dict) -> tuple[str, str, str, str, bool]:
        titulo = normalize_text(data.get("titulo"))
        if not titulo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o título da publicação.")
        resumo = normalize_text(data.get("resumo"))
        conteudo_html = str(data.get("conteudo_html") or "").strip()
        if not conteudo_html:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Escreva o conteúdo da publicação.")
        categoria = normalize_text(data.get("categoria"))
        if not categoria:
            # Correções.txt (rodada 16/set/2026): categoria passa a ser
            # obrigatória — vira prefixo automático do título ao publicar
            # no SharePoint (ver _publicar_item_lista_mural).
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione a categoria da publicação.")
        fixado = bool(data.get("fixado", False))
        return titulo, resumo, conteudo_html, categoria, fixado

    def _gravar_imagens_e_ambientes(self, cursor, id_publicacao: int, data: dict) -> None:
        cursor.execute("DELETE FROM dbo.mural_publicacao_imagens WHERE id_publicacao = ?", (id_publicacao,))
        imagens = data.get("imagens") or []
        for ordem, url in enumerate(imagens):
            url_segura = str(url or "").strip()
            if not url_segura:
                continue
            cursor.execute(
                """
                INSERT INTO dbo.mural_publicacao_imagens (id_publicacao, url, ordem, criado_em)
                VALUES (?, ?, ?, GETDATE())
                """,
                (id_publicacao, url_segura, ordem),
            )

        ambientes_existentes = {
            int(row[0])
            for row in cursor.execute(
                "SELECT id_ambiente FROM dbo.mural_publicacao_ambientes WHERE id_publicacao = ?",
                (id_publicacao,),
            ).fetchall()
        }
        ambientes_desejados = {int(id_ambiente) for id_ambiente in (data.get("ambientes") or [])}
        for id_ambiente in ambientes_desejados - ambientes_existentes:
            cursor.execute(
                """
                INSERT INTO dbo.mural_publicacao_ambientes (id_publicacao, id_ambiente, status_envio)
                VALUES (?, ?, 'pendente')
                """,
                (id_publicacao, id_ambiente),
            )
        for id_ambiente in ambientes_existentes - ambientes_desejados:
            cursor.execute(
                "DELETE FROM dbo.mural_publicacao_ambientes WHERE id_publicacao = ? AND id_ambiente = ?",
                (id_publicacao, id_ambiente),
            )

    def create_mural_publicacao(self, data: dict, *, actor: str = "") -> dict:
        titulo, resumo, conteudo_html, categoria, fixado = self._validar_publicacao_input(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            ensure_mural_publicacao_imagens_table(cursor)
            ensure_mural_publicacao_ambientes_table(cursor)
            cursor.execute(
                """
                INSERT INTO dbo.mural_publicacoes
                (titulo, resumo, conteudo_html, categoria, status, fixado, criado_por, atualizado_por, criado_em, atualizado_em)
                OUTPUT INSERTED.id_publicacao
                VALUES (?, ?, ?, ?, 'rascunho', ?, ?, ?, GETDATE(), GETDATE())
                """,
                (titulo, resumo or None, conteudo_html, categoria or None, 1 if fixado else 0, actor or None, actor or None),
            )
            id_publicacao = int(cursor.fetchone()[0])
            self._gravar_imagens_e_ambientes(cursor, id_publicacao, data)
            conn.commit()
        finally:
            conn.close()

        return self.get_mural_publicacao(id_publicacao)

    def update_mural_publicacao(self, id_publicacao: int, data: dict, *, actor: str = "") -> dict:
        titulo, resumo, conteudo_html, categoria, fixado = self._validar_publicacao_input(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            ensure_mural_publicacao_imagens_table(cursor)
            ensure_mural_publicacao_ambientes_table(cursor)
            cursor.execute("SELECT id_publicacao FROM dbo.mural_publicacoes WHERE id_publicacao = ?", (int(id_publicacao or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicação não encontrada.")

            cursor.execute(
                """
                UPDATE dbo.mural_publicacoes
                SET titulo = ?, resumo = ?, conteudo_html = ?, categoria = ?, fixado = ?,
                    atualizado_por = ?, atualizado_em = GETDATE()
                WHERE id_publicacao = ?
                """,
                (titulo, resumo or None, conteudo_html, categoria or None, 1 if fixado else 0, actor or None, int(id_publicacao)),
            )
            self._gravar_imagens_e_ambientes(cursor, int(id_publicacao), data)
            conn.commit()
        finally:
            conn.close()

        return self.get_mural_publicacao(id_publicacao)

    def set_mural_publicacao_status(self, id_publicacao: int, novo_status: str, *, actor: str = "") -> dict:
        status_permitido = {"rascunho", "publicado", "arquivado"}
        if novo_status not in status_permitido:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status inválido.")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            cursor.execute("SELECT id_publicacao FROM dbo.mural_publicacoes WHERE id_publicacao = ?", (int(id_publicacao or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicação não encontrada.")
            cursor.execute(
                """
                UPDATE dbo.mural_publicacoes
                SET status = ?, atualizado_por = ?, atualizado_em = GETDATE()
                WHERE id_publicacao = ?
                """,
                (novo_status, actor or None, int(id_publicacao)),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_mural_publicacao(id_publicacao)

    def delete_mural_publicacao(self, id_publicacao: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            ensure_mural_publicacao_imagens_table(cursor)
            ensure_mural_publicacao_ambientes_table(cursor)
            cursor.execute("SELECT id_publicacao FROM dbo.mural_publicacoes WHERE id_publicacao = ?", (int(id_publicacao or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicação não encontrada.")
            cursor.execute("DELETE FROM dbo.mural_publicacao_imagens WHERE id_publicacao = ?", (int(id_publicacao),))
            cursor.execute("DELETE FROM dbo.mural_publicacao_ambientes WHERE id_publicacao = ?", (int(id_publicacao),))
            cursor.execute("DELETE FROM dbo.mural_publicacoes WHERE id_publicacao = ?", (int(id_publicacao),))
            conn.commit()
        finally:
            conn.close()

        return {"success": True}

    # ------------------------------------------------------------------
    # Publicação nas intranets (SharePoint)
    # ------------------------------------------------------------------

    def _montar_html_publicacao(self, publicacao: dict, upload_dir: str) -> str:
        """HTML autocontido (imagens em base64) para publicar como arquivo
        na biblioteca do SharePoint — não depende de nenhum outro arquivo
        nem de o Conecta estar no ar para ser lido depois."""
        blocos_imagem = []
        for imagem in publicacao.get("imagens") or []:
            url = str(imagem.get("url") or "")
            nome_arquivo = url.rsplit("/", 1)[-1]
            caminho_local = Path(upload_dir) / "mural-imagens" / nome_arquivo
            if not caminho_local.is_file():
                continue
            extensao = caminho_local.suffix.lower().lstrip(".")
            mime = "image/png" if extensao == "png" else "image/jpeg"
            conteudo_b64 = base64.b64encode(caminho_local.read_bytes()).decode("ascii")
            blocos_imagem.append(
                f'<img src="data:{mime};base64,{conteudo_b64}" alt="" style="max-width:100%;margin:12px 0;border-radius:8px;" />'
            )

        # Correções.txt (17/set/2026): o <title>/<h1> do arquivo publicado
        # ficava com o título "cru", sem o prefixo de categoria — só o item
        # da lista "Mural Publicacoes" (_publicar_item_lista_mural) recebia o
        # prefixo. Usa a mesma função aqui para os dois ficarem iguais.
        titulo = _titulo_mural_com_categoria(publicacao)
        conteudo_html = str(publicacao.get("conteudo_html") or "")
        publicado_em = normalize_text(publicacao.get("publicado_em"))
        return f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8" /><title>{titulo}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#14181f;">
<p style="color:#5b6472;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin:0 0 4px;">Mural &middot; Conecta RH</p>
<h1 style="font-size:24px;margin:0 0 8px;">{titulo}</h1>
<p style="color:#8b93a1;font-size:13px;margin:0 0 20px;">Publicado em {publicado_em}</p>
<div>{conteudo_html}</div>
{''.join(blocos_imagem)}
</body></html>"""

    def _enviar_imagens_sharepoint(
        self,
        client: GraphClient,
        drive_root: str,
        pasta: str,
        slug: str,
        id_publicacao: int,
        publicacao: dict,
        upload_dir: str,
    ) -> str | None:
        """Além do HTML autocontido (imagens em base64, ver _montar_html_publicacao),
        sobe cada imagem também como arquivo separado na mesma pasta. O HTML embutido
        garante que a publicação sempre abra corretamente sozinha; o arquivo de imagem
        separado é o que dá uma miniatura de verdade quando alguém aponta um web part
        do SharePoint (Conteúdo em destaque / Biblioteca de documentos) para essa pasta
        — o SharePoint não gera preview a partir de <img> embutido dentro de um .html.
        Retorna a URL (webUrl) da primeira imagem enviada com sucesso — usada como capa
        do item da lista "Mural Publicacoes" (ver _publicar_item_lista_mural), para o
        texto e a imagem aparecerem juntos num único card de web part."""
        url_capa: str | None = None
        for indice, imagem in enumerate(publicacao.get("imagens") or [], start=1):
            url = str(imagem.get("url") or "")
            nome_arquivo = url.rsplit("/", 1)[-1]
            caminho_local = Path(upload_dir) / "mural-imagens" / nome_arquivo
            if not caminho_local.is_file():
                continue
            extensao = caminho_local.suffix.lower().lstrip(".") or "png"
            mime = "image/png" if extensao == "png" else "image/jpeg"
            caminho_remoto = f"{pasta}/{slug}-{id_publicacao}-imagem-{indice}.{extensao}"
            segmento = f"root:/{quote(caminho_remoto, safe='/')}:"
            try:
                resposta = client.request(
                    "PUT",
                    f"{drive_root}/{segmento}/content",
                    content=caminho_local.read_bytes(),
                    content_type=mime,
                )
                if url_capa is None:
                    url_capa = normalize_text(resposta.json().get("webUrl")) or None
            except HTTPException:
                continue
        return url_capa

    def _texto_plano_resumo(self, publicacao: dict, limite: int = 300) -> str:
        resumo = normalize_text(publicacao.get("resumo"))
        if resumo:
            return resumo[:limite]
        bruto = re.sub(r"<[^>]+>", " ", str(publicacao.get("conteudo_html") or ""))
        texto = normalize_text(re.sub(r"\s+", " ", bruto))
        return texto[:limite]

    def _garantir_lista_mural_sharepoint(self, client: GraphClient, site_id: str) -> str:
        """Cria (se não existir) a lista 'Mural Publicacoes' no site — cada
        publicação vira UM item nela (título + resumo + imagem + link), para
        que um web part de Lista/Conteúdo em destaque apontado pra essa lista
        mostre texto e imagem juntos num único card. Idempotente: procura por
        nome antes de criar.

        Imagem/LinkPublicacao são colunas de TEXTO simples (guardam a URL),
        não o tipo "hyperlinkOrPicture" do SharePoint — o Graph API v1.0
        rejeita a criação desse tipo de coluna (testado ao vivo: erro 400
        "Invalid request" tanto para isPicture=true quanto false, mesmo numa
        coluna nova isolada). A miniatura de verdade na visualização da lista
        vem de "formatação de coluna" (JSON) aplicada uma vez na coluna
        Imagem, direto na interface do SharePoint — ver docs/MURAL_GUIA_SHAREPOINT.md."""
        nome_lista = "Mural Publicacoes"
        site_prefix = f"/sites/{quote(site_id, safe=',')}"
        resposta = client.get_json(f"{site_prefix}/lists", params={"$filter": f"displayName eq '{nome_lista}'"})
        itens = resposta.get("value") or []
        if itens:
            return str(itens[0]["id"])

        corpo = {
            "displayName": nome_lista,
            "list": {"template": "genericList"},
            # maxLength > 255 numa coluna de linha única faz o Graph API rejeitar
            # a criação da lista inteira com um erro genérico ("One of the
            # provided arguments is not acceptable") — achado ao investigar o
            # mesmo bug em celebratory_dates.py (Correções.txt 17/set/2026).
            # Não deu erro nesta lista porque ela já existia desde 15/set, antes
            # deste limite ter sido excedido — mas quebraria a criação em
            # qualquer ambiente SharePoint novo.
            "columns": [
                {"name": "Resumo", "text": {"allowMultipleLines": True, "maxLength": 500}},
                {"name": "Imagem", "text": {"maxLength": 255}},
                {"name": "LinkPublicacao", "text": {"maxLength": 255}},
            ],
        }
        resposta = client.request("POST", f"{site_prefix}/lists", json_body=corpo)
        return str(resposta.json()["id"])

    def _publicar_item_lista_mural(
        self,
        client: GraphClient,
        site_id: str,
        lista_id: str,
        *,
        titulo: str,
        resumo: str,
        imagem_url: str | None,
        link_url: str | None,
        item_id_existente: str | None,
    ) -> str | None:
        site_prefix = f"/sites/{quote(site_id, safe=',')}"
        campos: dict = {"Title": titulo, "Resumo": resumo}
        if imagem_url:
            campos["Imagem"] = imagem_url
        if link_url:
            campos["LinkPublicacao"] = link_url

        if item_id_existente:
            try:
                client.request(
                    "PATCH",
                    f"{site_prefix}/lists/{lista_id}/items/{item_id_existente}/fields",
                    json_body=campos,
                )
                return item_id_existente
            except HTTPException:
                pass  # item pode ter sido apagado manualmente no SharePoint — recria abaixo

        resposta = client.request("POST", f"{site_prefix}/lists/{lista_id}/items", json_body={"fields": campos})
        item_id = resposta.json().get("id")
        return str(item_id) if item_id else None

    def publicar_mural_publicacao(self, id_publicacao: int, ambiente_ids: list[int], *, actor: str = "") -> dict:
        settings = self.settings
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_mural_publicacoes_table(cursor)
            ensure_mural_publicacao_ambientes_table(cursor)
            ensure_ambientes_sharepoint_table(cursor)

            cursor.execute(
                "SELECT id_publicacao FROM dbo.mural_publicacoes WHERE id_publicacao = ?",
                (int(id_publicacao or 0),),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicação não encontrada.")

            ids_alvo = {int(x) for x in (ambiente_ids or [])}
            if ids_alvo:
                placeholders = ",".join("?" for _ in ids_alvo)
                cursor.execute(
                    f"""
                    INSERT INTO dbo.mural_publicacao_ambientes (id_publicacao, id_ambiente, status_envio)
                    SELECT ?, a.id_ambiente, 'pendente'
                    FROM dbo.ambientes_sharepoint a
                    WHERE a.id_ambiente IN ({placeholders})
                      AND NOT EXISTS (
                          SELECT 1 FROM dbo.mural_publicacao_ambientes pa
                          WHERE pa.id_publicacao = ? AND pa.id_ambiente = a.id_ambiente
                      )
                    """,
                    (int(id_publicacao), *ids_alvo, int(id_publicacao)),
                )

            cursor.execute(
                """
                UPDATE dbo.mural_publicacoes
                SET status = 'publicado',
                    publicado_em = COALESCE(publicado_em, GETDATE()),
                    atualizado_por = ?, atualizado_em = GETDATE()
                WHERE id_publicacao = ?
                """,
                (actor or None, int(id_publicacao)),
            )
            conn.commit()
        finally:
            conn.close()

        publicacao = self.get_mural_publicacao(id_publicacao)
        client = GraphClient(
            tenant_id=settings.sharepoint_tenant_id,
            client_id=settings.sharepoint_client_id,
            client_secret=settings.sharepoint_client_secret,
            scope=settings.sharepoint_scope,
            base_url=settings.sharepoint_graph_base_url,
            unconfigured_message=(
                "As credenciais do aplicativo Microsoft (tenant/client/secret) ainda não "
                "foram configuradas no servidor — fale com o time de tecnologia."
            ),
        )
        html_publicacao = self._montar_html_publicacao(publicacao, settings.training_upload_dir)
        slug = _slugify(publicacao.get("titulo") or "")

        conn = self._connect()
        try:
            cursor = conn.cursor()
            for ambiente in publicacao.get("ambientes") or []:
                id_ambiente = int(ambiente["id_ambiente"])
                cursor.execute(
                    "SELECT site_id, biblioteca_destino, status FROM dbo.ambientes_sharepoint WHERE id_ambiente = ?",
                    (id_ambiente,),
                )
                row = cursor.fetchone()
                cursor.execute(
                    """
                    SELECT sharepoint_list_item_id FROM dbo.mural_publicacao_ambientes
                    WHERE id_publicacao = ? AND id_ambiente = ?
                    """,
                    (int(id_publicacao), id_ambiente),
                )
                item_existente_row = cursor.fetchone()
                item_id_existente = normalize_text(item_existente_row[0]) if item_existente_row and item_existente_row[0] else None
                if not row or not row[0] or row[2] != "conectado":
                    cursor.execute(
                        """
                        UPDATE dbo.mural_publicacao_ambientes
                        SET status_envio = 'erro', mensagem_erro = ?
                        WHERE id_publicacao = ? AND id_ambiente = ?
                        """,
                        ("Ambiente não testado/conectado — refaça o teste em Administração > Parâmetros.", int(id_publicacao), id_ambiente),
                    )
                    continue

                site_id, biblioteca_destino = row[0], row[1]
                pasta = f"{biblioteca_destino}/Mural" if biblioteca_destino else "Mural"
                caminho = f"{pasta}/{slug}-{id_publicacao}.html"
                segmento = f"root:/{quote(caminho, safe='/')}:"
                drive_root = f"/sites/{quote(site_id, safe=',')}/drive"

                try:
                    resposta = client.request(
                        "PUT",
                        f"{drive_root}/{segmento}/content",
                        content=html_publicacao.encode("utf-8"),
                        content_type="text/html; charset=utf-8",
                    )
                    item = resposta.json()
                    web_url = normalize_text(item.get("webUrl"))
                    url_capa = self._enviar_imagens_sharepoint(
                        client, drive_root, pasta, slug, id_publicacao, publicacao, settings.training_upload_dir
                    )

                    item_id_lista = item_id_existente
                    try:
                        lista_id = self._garantir_lista_mural_sharepoint(client, site_id)
                        item_id_lista = self._publicar_item_lista_mural(
                            client,
                            site_id,
                            lista_id,
                            titulo=_titulo_mural_com_categoria(publicacao),
                            resumo=self._texto_plano_resumo(publicacao),
                            imagem_url=url_capa,
                            link_url=web_url or None,
                            item_id_existente=item_id_existente,
                        )
                    except HTTPException:
                        # Best-effort: a publicação já está segura (arquivo .html gravado
                        # e link exposto no Conecta) mesmo que o item da lista falhe — não
                        # derruba o status "enviado" por causa disso.
                        pass

                    cursor.execute(
                        """
                        UPDATE dbo.mural_publicacao_ambientes
                        SET status_envio = 'enviado', enviado_em = GETDATE(),
                            mensagem_erro = NULL, sharepoint_web_url = ?, sharepoint_list_item_id = ?
                        WHERE id_publicacao = ? AND id_ambiente = ?
                        """,
                        (web_url or None, item_id_lista, int(id_publicacao), id_ambiente),
                    )
                except HTTPException as exc:
                    cursor.execute(
                        """
                        UPDATE dbo.mural_publicacao_ambientes
                        SET status_envio = 'erro', mensagem_erro = ?
                        WHERE id_publicacao = ? AND id_ambiente = ?
                        """,
                        (str(exc.detail)[:500], int(id_publicacao), id_ambiente),
                    )
            conn.commit()
        finally:
            conn.close()

        return self.get_mural_publicacao(id_publicacao)

from __future__ import annotations

from datetime import date, datetime
from urllib.parse import quote

from fastapi import HTTPException, status

from ..cache import get_cache_client
from ..services.graph_client import GraphClient
from ..services.helpers import normalize_text, rows_to_dicts, safe_json_loads
from .bootstrap import ensure_celebratory_dates_table
from .interviews import OCCUPYING_INTERVIEW_STATUSES

# Cache de queries (roadmap de expansão, respostas.txt): listagem de datas
# comemorativas muda raramente (o RH cadastra poucas vezes por ano) e é lida
# com frequência (tela de dashboard/lembretes). TTL de 5 minutos: baixo risco
# de dado desatualizado (também invalidado ativamente em toda escrita abaixo).
_CELEBRATORY_DATES_CACHE_KEY = "conecta:cache:celebratory_dates:list"
_CELEBRATORY_DATES_CACHE_TTL_SECONDS = 300

# Correções.txt item 10: categorias fixas do formulário de evento.
CATEGORIAS_EVENTO = ("Reunião", "Feriado", "Aniversário", "Evento", "Confraternização", "Data especial")

_DATE_COLUMNS = """
    id_data,
    titulo,
    dia,
    mes,
    descricao,
    data_inicio,
    data_fim,
    dia_inteiro,
    local,
    link,
    categoria,
    imagem_url,
    id_ambiente,
    status_sincronizacao,
    mensagem_sincronizacao,
    sharepoint_web_url,
    sharepoint_item_id,
    criado_por,
    criado_em,
    atualizado_em
"""


def _days_until_next_occurrence(dia: int, mes: int, *, today: date | None = None) -> int:
    """Calcula quantos dias faltam para a próxima ocorrência anual de dia/mes."""
    hoje = today or date.today()
    try:
        proxima = date(hoje.year, mes, dia)
    except ValueError:
        # 29/02 em ano não bissexto: usa 28/02 como aproximação segura.
        proxima = date(hoje.year, mes, min(dia, 28))
    if proxima < hoje:
        try:
            proxima = date(hoje.year + 1, mes, dia)
        except ValueError:
            proxima = date(hoje.year + 1, mes, min(dia, 28))
    return (proxima - hoje).days


def _parse_datetime(valor) -> datetime | None:
    texto = normalize_text(valor)
    if not texto:
        return None
    try:
        return datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data inválida. Use o seletor de data/hora.")


class CelebratoryDateRepositoryMixin:
    """Datas comemorativas de RH + eventos com publicação automática no
    calendário da Intranet (SharePoint), reaproveitando dbo.ambientes_sharepoint
    (mesma infraestrutura de conexão já usada pelo Mural)."""

    def list_celebratory_dates(self) -> list[dict]:
        cache = get_cache_client()
        cached_rows = cache.get(_CELEBRATORY_DATES_CACHE_KEY)
        if cached_rows is not None:
            return cached_rows

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_celebratory_dates_table(cursor)
            cursor.execute(
                f"""
                SELECT {_DATE_COLUMNS}
                FROM datas_comemorativas
                ORDER BY mes, dia, titulo
                """
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

        for item in rows:
            try:
                dias_restantes = _days_until_next_occurrence(int(item.get("dia") or 1), int(item.get("mes") or 1))
            except Exception:
                dias_restantes = 9999
            item["dias_para_proxima_ocorrencia"] = dias_restantes
            item["dia_inteiro"] = bool(item.get("dia_inteiro", True) if item.get("dia_inteiro") is not None else True)

        rows.sort(key=lambda item: item.get("dias_para_proxima_ocorrencia", 9999))
        cache.set(_CELEBRATORY_DATES_CACHE_KEY, rows, ttl_seconds=_CELEBRATORY_DATES_CACHE_TTL_SECONDS)
        return rows

    def list_calendar_events(self, *, include_interviews: bool = False) -> list[dict]:
        """Combina datas comemorativas com entrevistas agendadas ativas, lendo ao vivo das
        duas fontes já existentes (sem duplicar dados em uma tabela própria de eventos)."""
        events: list[dict] = [
            {
                "id": f"data-{item.get('id_data')}",
                "tipo": "data_comemorativa",
                "titulo": item.get("titulo"),
                "dia": item.get("dia"),
                "mes": item.get("mes"),
                "descricao": item.get("descricao"),
                "categoria": item.get("categoria"),
                "local": item.get("local"),
                "dias_para_proxima_ocorrencia": item.get("dias_para_proxima_ocorrencia"),
            }
            for item in self.list_celebratory_dates()
        ]

        if include_interviews:
            for item in self.list_interviews():
                if not item.get("data_entrevista"):
                    continue
                if item.get("status_entrevista") not in OCCUPYING_INTERVIEW_STATUSES:
                    continue
                events.append(
                    {
                        "id": f"entrevista-{item.get('id_entrevista')}",
                        "tipo": "entrevista",
                        "titulo": f"Entrevista — {item.get('nome_candidato') or 'Candidato'}",
                        "data": item.get("data_entrevista"),
                        "vaga": item.get("vaga"),
                        "status": item.get("status_entrevista"),
                    }
                )

        return events

    def get_endereco_empresa_formatado(self) -> str:
        """Endereço principal da empresa (Configurações > Operações),
        reaproveitado como sugestão de preenchimento do campo "Local" do
        evento (Correções.txt item 10 — resposta do RH: "Reaproveite o
        endereço cadastrado na tela de Operações"). Consulta direto a
        configuracoes_sistema em vez de list_configuration_catalog() para não
        exigir a permissão configuracoes.visualizar de quem só tem acesso ao
        Calendário."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT payload_json FROM dbo.configuracoes_sistema WHERE chave = ? AND categoria = 'geral'",
                ("ENDERECO_PRINCIPAL_EMPRESA",),
            )
            row = cursor.fetchone()
        finally:
            conn.close()

        if not row or not row[0]:
            return ""
        payload = safe_json_loads(row[0], {})
        partes = [
            f"{payload.get('rua', '')}, {payload.get('numero', '')}".strip(", "),
            payload.get("complemento"),
            payload.get("bairro"),
            payload.get("cidade") and payload.get("uf") and f"{payload.get('cidade')}/{payload.get('uf')}",
            payload.get("cep"),
        ]
        return ", ".join(normalize_text(parte) for parte in partes if normalize_text(parte))

    def get_celebratory_date(self, id_data: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_celebratory_dates_table(cursor)
            cursor.execute(
                f"""
                SELECT {_DATE_COLUMNS}
                FROM datas_comemorativas
                WHERE id_data = ?
                """,
                (int(id_data or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data comemorativa não encontrada.")
            return rows[0]
        finally:
            conn.close()

    @staticmethod
    def _validate_day_month(dia, mes) -> tuple[int, int]:
        try:
            safe_dia = int(dia)
            safe_mes = int(mes)
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe dia e mês válidos.")
        if safe_mes < 1 or safe_mes > 12 or safe_dia < 1 or safe_dia > 31:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe dia e mês válidos.")
        return safe_dia, safe_mes

    def _resolver_dados_evento(self, data: dict) -> dict:
        """Normaliza o payload do formulário (item 10 do Correções.txt): a
        data/hora exata de início é a fonte da verdade; dia/mes continuam
        sendo derivados dela para não quebrar o cálculo de recorrência anual
        já usado pelo widget de calendário."""
        titulo = normalize_text(data.get("titulo"))
        if not titulo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o título do evento.")

        data_inicio = _parse_datetime(data.get("data_inicio"))
        if data_inicio is None:
            # Compatibilidade: formulários antigos que só mandam dia/mes.
            dia, mes = self._validate_day_month(data.get("dia"), data.get("mes"))
            data_inicio = None
        else:
            dia, mes = data_inicio.day, data_inicio.month

        data_fim = _parse_datetime(data.get("data_fim")) or data_inicio

        categoria = normalize_text(data.get("categoria"))
        if categoria and categoria not in CATEGORIAS_EVENTO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoria de evento inválida.")

        id_ambiente = data.get("id_ambiente")
        try:
            id_ambiente = int(id_ambiente) if id_ambiente else None
        except (TypeError, ValueError):
            id_ambiente = None

        return {
            "titulo": titulo,
            "dia": dia,
            "mes": mes,
            "descricao": normalize_text(data.get("descricao")),
            "data_inicio": data_inicio,
            "data_fim": data_fim,
            "dia_inteiro": bool(data.get("dia_inteiro", True)),
            "local": normalize_text(data.get("local")),
            "link": normalize_text(data.get("link")),
            "categoria": categoria,
            "imagem_url": normalize_text(data.get("imagem_url")),
            "id_ambiente": id_ambiente,
        }

    def create_celebratory_date(self, data: dict, *, actor: str = "") -> dict:
        evento = self._resolver_dados_evento(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_celebratory_dates_table(cursor)
            cursor.execute(
                """
                INSERT INTO datas_comemorativas
                (titulo, dia, mes, descricao, data_inicio, data_fim, dia_inteiro, local, link,
                 categoria, imagem_url, id_ambiente, status_sincronizacao, criado_por, criado_em, atualizado_em)
                OUTPUT INSERTED.id_data
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                """,
                (
                    evento["titulo"],
                    evento["dia"],
                    evento["mes"],
                    evento["descricao"],
                    evento["data_inicio"],
                    evento["data_fim"],
                    1 if evento["dia_inteiro"] else 0,
                    evento["local"],
                    evento["link"],
                    evento["categoria"],
                    evento["imagem_url"],
                    evento["id_ambiente"],
                    "pendente" if evento["id_ambiente"] else None,
                    normalize_text(actor),
                ),
            )
            inserted = cursor.fetchone()
            id_data = int(inserted[0] or 0)
            conn.commit()
        finally:
            conn.close()

        get_cache_client().invalidate(_CELEBRATORY_DATES_CACHE_KEY)
        if evento["id_ambiente"]:
            self._sincronizar_evento_sharepoint(id_data)
        return self.get_celebratory_date(id_data)

    def update_celebratory_date(self, id_data: int, data: dict, *, actor: str = "") -> dict:
        evento = self._resolver_dados_evento(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_celebratory_dates_table(cursor)

            cursor.execute("SELECT id_data FROM datas_comemorativas WHERE id_data = ?", (int(id_data or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data comemorativa não encontrada.")

            cursor.execute(
                """
                UPDATE datas_comemorativas
                SET
                    titulo = ?,
                    dia = ?,
                    mes = ?,
                    descricao = ?,
                    data_inicio = ?,
                    data_fim = ?,
                    dia_inteiro = ?,
                    local = ?,
                    link = ?,
                    categoria = ?,
                    imagem_url = ?,
                    id_ambiente = ?,
                    status_sincronizacao = CASE WHEN ? IS NOT NULL THEN 'pendente' ELSE NULL END,
                    atualizado_em = GETDATE()
                WHERE id_data = ?
                """,
                (
                    evento["titulo"],
                    evento["dia"],
                    evento["mes"],
                    evento["descricao"],
                    evento["data_inicio"],
                    evento["data_fim"],
                    1 if evento["dia_inteiro"] else 0,
                    evento["local"],
                    evento["link"],
                    evento["categoria"],
                    evento["imagem_url"],
                    evento["id_ambiente"],
                    evento["id_ambiente"],
                    int(id_data or 0),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        get_cache_client().invalidate(_CELEBRATORY_DATES_CACHE_KEY)
        if evento["id_ambiente"]:
            self._sincronizar_evento_sharepoint(int(id_data))
        return self.get_celebratory_date(id_data)

    def delete_celebratory_date(self, id_data: int, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_celebratory_dates_table(cursor)

            cursor.execute("SELECT id_data FROM datas_comemorativas WHERE id_data = ?", (int(id_data or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data comemorativa não encontrada.")

            cursor.execute("DELETE FROM datas_comemorativas WHERE id_data = ?", (int(id_data or 0),))
            conn.commit()
        finally:
            conn.close()

        get_cache_client().invalidate(_CELEBRATORY_DATES_CACHE_KEY)
        return {"success": True}

    # ------------------------------------------------------------------
    # Publicação no calendário da Intranet (SharePoint)
    # ------------------------------------------------------------------

    def _garantir_lista_eventos_sharepoint(self, client: GraphClient, site_id: str) -> str:
        """Cria (se não existir) a lista de eventos nativa do SharePoint
        (template "events") no site — permite que um web part de Calendário
        aponte direto para ela. CategoriaConecta/LinkConecta/ImagemConecta são
        colunas de TEXTO simples (não usa o tipo "hyperlinkOrPicture": o Graph
        API v1.0 rejeita a criação desse tipo — mesmo achado do Mural, ver
        docs/MURAL_GUIA_SHAREPOINT.md)."""
        nome_lista = "Eventos Conecta"
        site_prefix = f"/sites/{quote(site_id, safe=',')}"
        resposta = client.get_json(f"{site_prefix}/lists", params={"$filter": f"displayName eq '{nome_lista}'"})
        itens = resposta.get("value") or []
        if itens:
            return str(itens[0]["id"])

        corpo = {
            "displayName": nome_lista,
            "list": {"template": "events"},
            "columns": [
                {"name": "CategoriaConecta", "text": {"maxLength": 60}},
                {"name": "LinkConecta", "text": {"maxLength": 400}},
                {"name": "ImagemConecta", "text": {"maxLength": 400}},
            ],
        }
        resposta = client.request("POST", f"{site_prefix}/lists", json_body=corpo)
        return str(resposta.json()["id"])

    def _publicar_item_lista_eventos(
        self,
        client: GraphClient,
        site_id: str,
        lista_id: str,
        *,
        evento: dict,
        item_id_existente: str | None,
    ) -> str | None:
        site_prefix = f"/sites/{quote(site_id, safe=',')}"
        # Correções.txt (rodada 16/set/2026): "Falha ao publicar" no
        # Calendário. evento["data_inicio"/"data_fim"] são datetime *naive*
        # (sem timezone) — .isoformat() sozinho gera "2026-09-20T09:00:00",
        # sem designador de fuso. Colunas DateTime de lista do SharePoint via
        # Graph API rejeitam esse formato (exigem um "Z"/offset explícito);
        # é essa rejeição que o RH via como falha genérica de publicação.
        campos: dict = {
            "Title": evento["titulo"],
            "EventDate": f"{evento['data_inicio'].isoformat()}Z" if evento.get("data_inicio") else None,
            "EndDate": f"{evento['data_fim'].isoformat()}Z" if evento.get("data_fim") else None,
            "fAllDayEvent": bool(evento.get("dia_inteiro")),
        }
        if evento.get("local"):
            campos["Location"] = evento["local"]
        if evento.get("descricao"):
            campos["Description"] = evento["descricao"]
        if evento.get("categoria"):
            campos["CategoriaConecta"] = evento["categoria"]
        if evento.get("link"):
            campos["LinkConecta"] = evento["link"]
        if evento.get("imagem_url"):
            campos["ImagemConecta"] = evento["imagem_url"]
        campos = {chave: valor for chave, valor in campos.items() if valor is not None}

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

    def _sincronizar_evento_sharepoint(self, id_data: int) -> dict:
        """Publica (best-effort) o evento no calendário da Intranet escolhida.
        Nunca derruba o cadastro do evento no Conecta por causa de uma falha
        aqui — o status fica registrado em status_sincronizacao/mensagem_sincronizacao
        para o RH ver e, se quiser, tentar de novo salvando o evento outra vez."""
        settings = self.settings
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT {_DATE_COLUMNS} FROM datas_comemorativas WHERE id_data = ?",
                (int(id_data),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                return {"success": False}
            evento = rows[0]

            if not evento.get("id_ambiente"):
                return {"success": False}

            cursor.execute(
                "SELECT site_id, status FROM dbo.ambientes_sharepoint WHERE id_ambiente = ?",
                (int(evento["id_ambiente"]),),
            )
            ambiente_row = cursor.fetchone()
            if not ambiente_row or not ambiente_row[0] or ambiente_row[1] != "conectado":
                cursor.execute(
                    """
                    UPDATE datas_comemorativas
                    SET status_sincronizacao = 'erro',
                        mensagem_sincronizacao = ?
                    WHERE id_data = ?
                    """,
                    ("Ambiente não testado/conectado — refaça o teste em Administração > Parâmetros.", int(id_data)),
                )
                conn.commit()
                return {"success": False}
            site_id = ambiente_row[0]
        finally:
            conn.close()

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

        conn = self._connect()
        try:
            cursor = conn.cursor()
            try:
                lista_id = self._garantir_lista_eventos_sharepoint(client, site_id)
                item_id = self._publicar_item_lista_eventos(
                    client,
                    site_id,
                    lista_id,
                    evento=evento,
                    item_id_existente=normalize_text(evento.get("sharepoint_item_id")) or None,
                )
                web_url = None
                try:
                    site_info = client.get_json(f"/sites/{quote(site_id, safe=',')}")
                    site_web_url = normalize_text(site_info.get("webUrl"))
                    if site_web_url:
                        web_url = f"{site_web_url}/Lists/Eventos%20Conecta/AllItems.aspx"
                except HTTPException:
                    pass  # link "ver na intranet" é só conveniência — a sincronização já é sucesso sem ele
                cursor.execute(
                    """
                    UPDATE datas_comemorativas
                    SET status_sincronizacao = 'enviado',
                        mensagem_sincronizacao = NULL,
                        sharepoint_item_id = ?,
                        sharepoint_web_url = ?
                    WHERE id_data = ?
                    """,
                    (item_id, web_url, int(id_data)),
                )
            except HTTPException as exc:
                cursor.execute(
                    """
                    UPDATE datas_comemorativas
                    SET status_sincronizacao = 'erro',
                        mensagem_sincronizacao = ?
                    WHERE id_data = ?
                    """,
                    (str(exc.detail)[:500], int(id_data)),
                )
            conn.commit()
        finally:
            conn.close()

        get_cache_client().invalidate(_CELEBRATORY_DATES_CACHE_KEY)
        return {"success": True}

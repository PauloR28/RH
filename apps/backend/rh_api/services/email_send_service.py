"""Envio de e-mail via Microsoft Graph (sendMail), como aplicação.

Reaproveita a mesma caixa e o mesmo app registration já usados hoje para
leitura de e-mail (RH_EMAIL_GRAPH_*), mantendo consistência arquitetural: o
Conecta sempre envia como a caixa oficial (ex.: recrutamento@central.com),
nunca em nome do usuário individual logado. Quem disparou o envio fica
registrado apenas na auditoria do próprio Conecta (logs_auditoria).
"""

from __future__ import annotations

import html
import re
from urllib.parse import quote

from fastapi import HTTPException, status

from .graph_client import GraphClient
from .helpers import normalize_text

UNCONFIGURED_MESSAGE = (
    "Envio de e-mail via Microsoft Graph ainda não configurado. Informe "
    "RH_EMAIL_GRAPH_TENANT_ID, RH_EMAIL_GRAPH_CLIENT_ID, RH_EMAIL_GRAPH_MAILBOX "
    "e a variável definida em RH_EMAIL_SEND_CLIENT_SECRET_ENV."
)

_VARIABLE_PATTERN = re.compile(r"{\s*([a-zA-Z0-9_]+)\s*}")


def render_template(text: str, variables: dict, *, escape_html: bool = False) -> str:
    """Substitui {variavel} pelo valor informado (sintaxe de chave simples,
    ex.: {nome_candidato} — ver Correções.txt item 5).

    ``escape_html`` deve ser True ao renderizar dentro do corpo HTML do
    e-mail, para que o valor de uma variável (preenchido livremente por
    qualquer usuário com permissão de enviar e-mail) não seja interpretado
    como marcação/script pelo cliente de e-mail do destinatário.
    """
    safe_variables = {
        str(key): (html.escape(normalize_text(value)) if escape_html else normalize_text(value))
        for key, value in (variables or {}).items()
    }

    def _replace(match: re.Match) -> str:
        key = match.group(1)
        return safe_variables.get(key, match.group(0))

    return _VARIABLE_PATTERN.sub(_replace, text or "")


class EmailSendService:
    def __init__(self, settings) -> None:
        self.settings = settings
        self._client: GraphClient | None = None

    @property
    def configured(self) -> bool:
        return bool(
            normalize_text(getattr(self.settings, "email_graph_tenant_id", ""))
            and normalize_text(getattr(self.settings, "email_graph_client_id", ""))
            and normalize_text(getattr(self.settings, "email_send_client_secret", ""))
            and normalize_text(getattr(self.settings, "email_graph_mailbox", ""))
        )

    def _client_or_raise(self) -> GraphClient:
        if not self.configured:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNCONFIGURED_MESSAGE)
        if self._client is None:
            self._client = GraphClient(
                tenant_id=getattr(self.settings, "email_graph_tenant_id", ""),
                client_id=getattr(self.settings, "email_graph_client_id", ""),
                client_secret=getattr(self.settings, "email_send_client_secret", ""),
                scope=getattr(self.settings, "email_graph_scope", "") or "https://graph.microsoft.com/.default",
                base_url=getattr(self.settings, "email_graph_base_url", "") or "https://graph.microsoft.com/v1.0",
                unconfigured_message=UNCONFIGURED_MESSAGE,
            )
        return self._client

    def send_mail(
        self,
        *,
        destinatarios: list[str],
        assunto: str,
        corpo_html: str,
        copia: list[str] | None = None,
        anexos: list[dict] | None = None,
    ) -> dict:
        client = self._client_or_raise()
        mailbox = normalize_text(getattr(self.settings, "email_graph_mailbox", ""))

        safe_destinatarios = [normalize_text(item) for item in destinatarios if normalize_text(item)]
        if not safe_destinatarios:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe ao menos um destinatário.")

        message: dict = {
            "subject": normalize_text(assunto) or "(sem assunto)",
            "body": {"contentType": "HTML", "content": corpo_html or ""},
            "toRecipients": [{"emailAddress": {"address": item}} for item in safe_destinatarios],
        }
        safe_copia = [normalize_text(item) for item in (copia or []) if normalize_text(item)]
        if safe_copia:
            message["ccRecipients"] = [{"emailAddress": {"address": item}} for item in safe_copia]

        if anexos:
            message["attachments"] = [
                {
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": anexo["nome"],
                    "contentType": anexo.get("mime_type") or "application/octet-stream",
                    "contentBytes": anexo["conteudo_base64"],
                }
                for anexo in anexos
            ]

        client.request(
            "POST",
            f"/users/{quote(mailbox, safe='')}/sendMail",
            json_body={"message": message, "saveToSentItems": True},
        )
        return {"success": True}

"""Cliente HTTP genérico para o Microsoft Graph (client credentials).

Implementação única (achado S-27): usado pelos serviços de arquivos
(SharePoint/OneDrive), de envio de e-mail, e por `repositories/communications.py`
(leitura de e-mail via Graph) — os três consumidores compartilham a mesma
lógica de obtenção de token e tratamento de erro, evitando divergência entre
implementações paralelas.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from .helpers import normalize_text


class GraphClientError(HTTPException):
    pass


class GraphClient:
    def __init__(
        self,
        *,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        scope: str = "https://graph.microsoft.com/.default",
        base_url: str = "https://graph.microsoft.com/v1.0",
        unconfigured_message: str = "Integração com o Microsoft Graph ainda não configurada.",
        forbidden_message: str | None = None,
    ) -> None:
        self.tenant_id = normalize_text(tenant_id)
        self.client_id = normalize_text(client_id)
        self.client_secret = normalize_text(client_secret)
        self.scope = normalize_text(scope) or "https://graph.microsoft.com/.default"
        self.base_url = (normalize_text(base_url) or "https://graph.microsoft.com/v1.0").rstrip("/")
        self.unconfigured_message = unconfigured_message
        self.forbidden_message = forbidden_message or (
            "Microsoft Graph recusou a autorização. Verifique as permissões concedidas e o admin consent no Azure."
        )

    @property
    def configured(self) -> bool:
        return bool(self.tenant_id and self.client_id and self.client_secret)

    def _require_configured(self) -> None:
        if not self.configured:
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=self.unconfigured_message,
            )

    def get_token(self) -> str:
        """Ponto de entrada público para obter um token isoladamente — usado
        por chamadores que precisam reaproveitar o mesmo token em várias
        chamadas subsequentes (ex.: listar um e-mail e depois seus anexos)
        sem pagar uma requisição nova ao Azure AD a cada chamada."""
        return self._get_token()

    def _get_token(self) -> str:
        self._require_configured()
        token_url = f"https://login.microsoftonline.com/{quote(self.tenant_id, safe='')}/oauth2/v2.0/token"
        try:
            with httpx.Client(timeout=20) as client:
                response = client.post(
                    token_url,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "scope": self.scope,
                        "grant_type": "client_credentials",
                    },
                )
        except httpx.HTTPError as exc:
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível obter token do Microsoft Graph. Verifique conectividade e tenant.",
            ) from exc

        if response.status_code >= 400:
            payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            detail = normalize_text(payload.get("error_description") or payload.get("error"))
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=detail or "Microsoft Graph recusou a autenticação da aplicação.",
            )

        token = normalize_text(response.json().get("access_token"))
        if not token:
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Microsoft Graph não retornou token de acesso.",
            )
        return token

    def _handle_error_response(self, response: httpx.Response) -> None:
        if response.status_code in {401, 403}:
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=self.forbidden_message,
            )
        if response.status_code >= 400:
            payload = {}
            if response.headers.get("content-type", "").startswith("application/json"):
                try:
                    payload = response.json()
                except ValueError:
                    payload = {}
            error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
            message = normalize_text(error.get("message") or payload.get("error_description"))
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=message or f"Microsoft Graph retornou erro {response.status_code}.",
            )

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: dict | None = None,
        content: bytes | None = None,
        content_type: str | None = None,
        extra_headers: dict | None = None,
        timeout: float = 30,
        token: str | None = None,
    ) -> httpx.Response:
        token = token or self._get_token()
        url = path if path.startswith("http") else f"{self.base_url}/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {token}"}
        if content_type:
            headers["Content-Type"] = content_type
        elif json_body is not None:
            # Correções.txt (23/set/2026): sem "charset=utf-8" explícito aqui, o
            # httpx manda só "Content-Type: application/json" nas chamadas com
            # json_body (ex.: criar/atualizar item da lista "Mural Publicacoes")
            # — o backend da SharePoint REST por trás do Graph, sem o charset
            # explícito, decodifica o corpo como Latin-1/cp1252 em vez de UTF-8,
            # trocando qualquer caractere acentuado por mojibake (ex.: "ção" virava
            # "Ã§Ã£o"). Título/Resumo já iam em UTF-8 de verdade — só faltava dizer
            # isso explicitamente no header.
            headers["Content-Type"] = "application/json; charset=utf-8"
        if extra_headers:
            headers.update(extra_headers)

        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.request(
                    method,
                    url,
                    params=params or {},
                    json=json_body,
                    content=content,
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            raise GraphClientError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível se comunicar com o Microsoft Graph.",
            ) from exc

        self._handle_error_response(response)
        return response

    def get_json(self, path: str, *, params: dict | None = None, token: str | None = None) -> dict:
        response = self.request("GET", path, params=params, token=token)
        return response.json() if response.content else {}

    def post_json(self, path: str, *, json_body: dict | None = None, params: dict | None = None) -> dict:
        response = self.request("POST", path, json_body=json_body, params=params)
        return response.json() if response.content else {}

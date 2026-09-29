"""Repositório de arquivos do Conecta sobre o Drive do site SharePoint do RH.

Não há cópia local: toda listagem, upload, download e exclusão fala
diretamente com o Microsoft Graph (drive do site configurado). Segue a regra
de ouro da integração M365 do Conecta — o Conecta não duplica armazenamento.
"""

from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from .graph_client import GraphClient
from .helpers import normalize_text

# Drive-Conecta guarda documentos de RH de qualquer tipo (PDF, planilha, imagem,
# contrato, etc.) — por isso a defesa aqui é uma lista de bloqueio de extensões
# executáveis/script, não uma lista de permissão estrita como a de currículo
# (public_candidacy.py), que quebraria uploads legítimos de documento do RH.
BLOCKED_UPLOAD_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".com", ".msi", ".msp", ".scr",
    ".ps1", ".ps1xml", ".psc1", ".psm1",
    ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
    ".jar", ".app", ".apk", ".dll", ".sys", ".drv", ".cpl",
    ".gadget", ".hta", ".reg", ".lnk", ".inf", ".sh", ".bash",
}

UNCONFIGURED_MESSAGE = (
    "Repositório de arquivos (OneDrive/SharePoint) ainda não configurado. "
    "Defina RH_SHAREPOINT_SITE_ID e as credenciais do aplicativo Microsoft."
)

# Upload simples via PUT só é suportado pelo Graph até 4MB; acima disso é
# necessário usar upload session (createUploadSession) em pedaços.
MAX_SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024
# Limite de segurança para o repositório de documentos do Conecta (250MB).
# O Graph em si suporta arquivos bem maiores; este teto é uma decisão de produto.
MAX_UPLOAD_BYTES = 250 * 1024 * 1024
# Recomendação do Graph: pedaços múltiplos de 320 KiB. Usamos ~10MB por pedaço.
UPLOAD_CHUNK_SIZE = 320 * 1024 * 32


def _sanitize_path(path: str) -> str:
    safe = normalize_text(path).strip("/")
    parts = [part for part in safe.split("/") if part not in ("", ".", "..")]
    return "/".join(parts)


class OneDriveService:
    def __init__(self, settings) -> None:
        self.settings = settings
        self._client: GraphClient | None = None

    @property
    def configured(self) -> bool:
        return bool(
            normalize_text(getattr(self.settings, "sharepoint_site_id", ""))
            and normalize_text(getattr(self.settings, "sharepoint_client_id", ""))
            and normalize_text(getattr(self.settings, "sharepoint_tenant_id", ""))
        )

    def _client_or_raise(self) -> GraphClient:
        if not self.configured:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNCONFIGURED_MESSAGE)
        if self._client is None:
            self._client = GraphClient(
                tenant_id=getattr(self.settings, "sharepoint_tenant_id", ""),
                client_id=getattr(self.settings, "sharepoint_client_id", ""),
                client_secret=getattr(self.settings, "sharepoint_client_secret", ""),
                scope=getattr(self.settings, "sharepoint_scope", "") or "https://graph.microsoft.com/.default",
                base_url=getattr(self.settings, "sharepoint_graph_base_url", "") or "https://graph.microsoft.com/v1.0",
                unconfigured_message=UNCONFIGURED_MESSAGE,
            )
        return self._client

    def _drive_root(self) -> str:
        site_id = normalize_text(getattr(self.settings, "sharepoint_site_id", ""))
        drive_id = normalize_text(getattr(self.settings, "sharepoint_drive_id", ""))
        if drive_id:
            return f"/drives/{quote(drive_id, safe='')}"
        # O site-id composto do Graph (hostname,site-guid,web-guid) usa vírgula
        # como separador; mantemos a vírgula literal em vez de %2C.
        return f"/sites/{quote(site_id, safe=',')}/drive"

    def _item_path_segment(self, path: str) -> str:
        safe_path = _sanitize_path(path)
        return f"root:/{quote(safe_path, safe='/')}:" if safe_path else "root"

    def _serialize_item(self, item: dict) -> dict:
        folder = item.get("folder")
        return {
            "id": normalize_text(item.get("id")),
            "nome": normalize_text(item.get("name")),
            "tipo": "pasta" if isinstance(folder, dict) else "arquivo",
            "tamanho_bytes": int(item.get("size") or 0),
            "criado_em": normalize_text(item.get("createdDateTime")),
            "modificado_em": normalize_text(item.get("lastModifiedDateTime")),
            "modificado_por": normalize_text(
                ((item.get("lastModifiedBy") or {}).get("user") or {}).get("displayName")
            ),
            "criado_por": normalize_text(
                ((item.get("createdBy") or {}).get("user") or {}).get("displayName")
            ),
            "web_url": normalize_text(item.get("webUrl")),
            "itens_na_pasta": int(folder.get("childCount") or 0) if isinstance(folder, dict) else None,
            "mime_type": normalize_text((item.get("file") or {}).get("mimeType")) if item.get("file") else "",
        }

    def list_items(self, path: str = "") -> dict:
        client = self._client_or_raise()
        segment = self._item_path_segment(path)
        endpoint = f"{self._drive_root()}/{segment}/children"
        payload = client.get_json(
            endpoint,
            params={
                "$select": "id,name,size,folder,file,createdDateTime,lastModifiedDateTime,lastModifiedBy,createdBy,webUrl"
            },
        )
        items = [self._serialize_item(item) for item in payload.get("value", [])]
        items.sort(key=lambda item: (item["tipo"] != "pasta", item["nome"].lower()))
        return {"success": True, "path": _sanitize_path(path), "items": items}

    def create_folder(self, path: str, folder_name: str) -> dict:
        client = self._client_or_raise()
        safe_name = normalize_text(folder_name)
        if not safe_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome da pasta é obrigatório.")
        segment = self._item_path_segment(path)
        endpoint = f"{self._drive_root()}/{segment}/children"
        item = client.post_json(
            endpoint,
            json_body={
                "name": safe_name,
                "folder": {},
                "@microsoft.graph.conflictBehavior": "rename",
            },
        )
        return {"success": True, "item": self._serialize_item(item)}

    def upload_file(self, path: str, filename: str, content: bytes, content_type: str = "") -> dict:
        safe_filename = normalize_text(filename)
        if not safe_filename:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome do arquivo é obrigatório.")
        extension = Path(safe_filename).suffix.lower()
        if extension in BLOCKED_UPLOAD_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este tipo de arquivo não pode ser enviado ao repositório de documentos.",
            )
        client = self._client_or_raise()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Arquivo maior que {MAX_UPLOAD_BYTES // (1024 * 1024)}MB. Não é possível enviar ao repositório de documentos.",
            )
        full_path = _sanitize_path(f"{path}/{safe_filename}")
        if len(content) > MAX_SIMPLE_UPLOAD_BYTES:
            item = self._upload_large_file(full_path, content)
        else:
            segment = self._item_path_segment(full_path)
            endpoint = f"{self._drive_root()}/{segment}/content"
            # "rename": arquivo com o mesmo nome na pasta vira "nome 1.ext" em vez de
            # sobrescrever o anterior (o padrão do Graph no PUT simples é "replace").
            response = client.request(
                "PUT",
                endpoint,
                params={"@microsoft.graph.conflictBehavior": "rename"},
                content=content,
                content_type=content_type or "application/octet-stream",
            )
            item = response.json()
        return {"success": True, "item": self._serialize_item(item)}

    def _upload_large_file(self, full_path: str, content: bytes) -> dict:
        client = self._client_or_raise()
        segment = self._item_path_segment(full_path)
        session = client.post_json(
            f"{self._drive_root()}/{segment}/createUploadSession",
            json_body={"item": {"@microsoft.graph.conflictBehavior": "rename"}},
        )
        upload_url = normalize_text(session.get("uploadUrl"))
        if not upload_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Microsoft Graph não retornou uma sessão de upload válida.",
            )

        total_size = len(content)
        item_payload: dict = {}
        try:
            with httpx.Client(timeout=120) as http_client:
                for start in range(0, total_size, UPLOAD_CHUNK_SIZE):
                    end = min(start + UPLOAD_CHUNK_SIZE, total_size)
                    chunk = content[start:end]
                    response = http_client.put(
                        upload_url,
                        content=chunk,
                        headers={
                            "Content-Length": str(len(chunk)),
                            "Content-Range": f"bytes {start}-{end - 1}/{total_size}",
                        },
                    )
                    if response.status_code >= 400:
                        raise HTTPException(
                            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=f"Falha ao enviar arquivo ao Microsoft Graph (pedaço {start}-{end}).",
                        )
                    if response.status_code in (200, 201):
                        item_payload = response.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível concluir o envio do arquivo ao Microsoft Graph.",
            ) from exc

        return item_payload

    def download_file(self, path: str) -> tuple[bytes, str, str]:
        client = self._client_or_raise()
        segment = self._item_path_segment(path)
        metadata = client.get_json(f"{self._drive_root()}/{segment}", params={"$select": "id,name,file"})
        if not metadata.get("file"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="O item informado não é um arquivo.")
        response = client.request("GET", f"{self._drive_root()}/{segment}/content", timeout=60)
        filename = normalize_text(metadata.get("name")) or _sanitize_path(path).rsplit("/", 1)[-1]
        mime_type = normalize_text((metadata.get("file") or {}).get("mimeType")) or "application/octet-stream"
        return response.content, filename, mime_type

    def download_file_base64(self, path: str) -> tuple[str, str, str]:
        content, filename, mime_type = self.download_file(path)
        return base64.b64encode(content).decode("ascii"), filename, mime_type

    def get_preview_url(self, path: str) -> dict:
        """URL de visualização embutida (Office Online) para doc/docx/xls/ppt.

        Usa a ação nativa ``preview`` do Microsoft Graph sobre o mesmo item —
        não envolve nenhum serviço externo pago, é parte da licença M365 já
        configurada para o repositório de arquivos.
        """
        client = self._client_or_raise()
        segment = self._item_path_segment(path)
        payload = client.post_json(f"{self._drive_root()}/{segment}/preview", json_body={})
        get_url = normalize_text(payload.get("getUrl"))
        if not get_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Microsoft Graph não retornou uma URL de visualização para este arquivo.",
            )
        return {"success": True, "url": get_url}

    def delete_item(self, path: str) -> dict:
        client = self._client_or_raise()
        segment = self._item_path_segment(path)
        client.request("DELETE", f"{self._drive_root()}/{segment}")
        return {"success": True}

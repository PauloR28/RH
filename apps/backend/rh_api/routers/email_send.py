from __future__ import annotations

from conecta.infrastructure.security.rate_limit import InMemoryRateLimiter
from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import AuthenticatedUser
from ..config import get_settings
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.email_send import EmailSendRequest
from ..services.email_send_service import EmailSendService, render_template
from ..services.onedrive_service import OneDriveService

router = APIRouter(prefix="/emails", tags=["email-send"], dependencies=[Depends(get_current_user)])
email_send_limiter = InMemoryRateLimiter()


def get_email_send_service() -> EmailSendService:
    return EmailSendService(get_settings())


def get_onedrive_service() -> OneDriveService:
    return OneDriveService(get_settings())


def _resolve_template(repository: DatabaseRepository, id_modelo: int) -> dict:
    catalog = repository.list_configuration_catalog()
    for section in catalog.get("sections", []):
        if section.get("tipo") != "modelos_email":
            continue
        for item in section.get("items", []):
            if int(item.get("id_item") or 0) == int(id_modelo):
                if not item.get("ativo"):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este modelo de e-mail está inativo.")
                return item
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modelo de e-mail não encontrado.")


@router.get("/modelos", dependencies=[Depends(require_permissions("emails.enviar_modelo"))])
def list_email_templates(repository: DatabaseRepository = Depends(get_repository)):
    catalog = repository.list_configuration_catalog()
    modelos = []
    for section in catalog.get("sections", []):
        if section.get("tipo") != "modelos_email":
            continue
        for item in section.get("items", []):
            if not item.get("ativo"):
                continue
            payload = item.get("payload") or {}
            modelos.append(
                {
                    "id_item": item.get("id_item"),
                    "nome": item.get("nome"),
                    "descricao": item.get("descricao"),
                    "assunto": payload.get("assunto") or "",
                    "corpo_html": payload.get("corpo_html") or "",
                }
            )
    return {"success": True, "items": modelos}


@router.post("/enviar")
def send_email(
    payload: EmailSendRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    email_service: EmailSendService = Depends(get_email_send_service),
    onedrive_service: OneDriveService = Depends(get_onedrive_service),
):
    if payload.id_modelo:
        required_permission = "emails.enviar_modelo"
    else:
        required_permission = "emails.enviar_livre"
    if not user.has_permission(required_permission):
        from ..dependencies import ensure_user_permission

        ensure_user_permission(user, required_permission, repository=repository)

    settings = get_settings()
    limiter_key = user.username or str(user.id_usuario or "")
    if not email_send_limiter.allow(
        limiter_key,
        limit=settings.email_send_rate_limit,
        window_seconds=settings.email_send_rate_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitos envios de e-mail em pouco tempo. Aguarde e tente novamente.",
        )

    assunto = payload.assunto
    corpo_html = payload.corpo_html
    if payload.id_modelo:
        template = _resolve_template(repository, payload.id_modelo)
        template_payload = template.get("payload") or {}
        assunto = render_template(template_payload.get("assunto") or template.get("nome") or "", payload.variaveis)
        corpo_html = render_template(
            template_payload.get("corpo_html") or "", payload.variaveis, escape_html=True
        )

    if not corpo_html:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Corpo do e-mail não pode ser vazio.")

    anexos = []
    for caminho in payload.anexos_onedrive:
        conteudo_base64, nome, mime_type = onedrive_service.download_file_base64(caminho)
        anexos.append({"nome": nome, "mime_type": mime_type, "conteudo_base64": conteudo_base64})

    result = email_service.send_mail(
        destinatarios=payload.destinatarios,
        assunto=assunto,
        corpo_html=corpo_html,
        copia=payload.copia,
        anexos=anexos,
    )

    audit_action(
        repository,
        user,
        modulo="E-mails",
        acao="enviar_email",
        entidade="email_enviado",
        entidade_id=str(payload.id_modelo or ""),
        valor_novo={
            "destinatarios": payload.destinatarios,
            "assunto": assunto,
            "id_modelo": payload.id_modelo,
            "anexos_onedrive": payload.anexos_onedrive,
        },
    )
    return result

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.auth import DecideEmailChangeRequest
from ..schemas.common import SuccessResponse
from ..schemas.security import (
    ConfigurationItemRequest,
    LgpdRequestCreate,
    NotificationAutomationSettingsRequest,
    RolePermissionsUpdateRequest,
    QuickTrainingUserCreateRequest,
    UserCreateRequest,
    UserPasswordRequest,
    UserStatusRequest,
    UserUpdateRequest,
)


router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/security/roles", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def get_roles(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_roles()


@router.get("/security/permissions", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def get_permissions(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_permissions()


@router.put(
    "/security/roles/{id_perfil}/permissions",
    dependencies=[Depends(require_permissions("configuracoes.editar"))],
)
def update_role_permissions(
    id_perfil: str,
    payload: RolePermissionsUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.update_role_permissions(id_perfil, payload.model_dump(), actor=user)


@router.get("/users", dependencies=[Depends(require_permissions("usuarios.visualizar"))])
def get_users(
    search: str = Query(default=""),
    perfil: str = Query(default=""),
    status_usuario: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_system_users(search=search, perfil=perfil, status_usuario=status_usuario)


@router.post("/users", dependencies=[Depends(require_permissions("usuarios.criar"))])
def create_user(
    payload: UserCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.create_system_user(payload.model_dump(), actor=user)


@router.post("/users/quick", dependencies=[Depends(require_permissions("usuarios.criar"))])
def create_quick_training_user(
    payload: QuickTrainingUserCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.create_quick_training_user(payload.model_dump(), actor=user)


@router.put("/users/{id_usuario}", dependencies=[Depends(require_permissions("usuarios.editar"))])
def update_user(
    id_usuario: int,
    payload: UserUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.update_system_user(id_usuario, payload.model_dump(), actor=user)


@router.post("/users/{id_usuario}/password", dependencies=[Depends(require_permissions("usuarios.redefinir_senha"))])
def reset_user_password(
    id_usuario: int,
    payload: UserPasswordRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.reset_system_user_password(id_usuario, payload.model_dump(), actor=user)


@router.post(
    "/users/{id_usuario}/mfa/reset",
    dependencies=[Depends(require_permissions("usuarios.redefinir_senha"))],
)
def reset_user_mfa(
    id_usuario: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.reset_user_mfa(
        id_usuario,
        actor=user,
        reason=justificativa,
    )


@router.post("/users/{id_usuario}/status")
def set_user_status(
    id_usuario: int,
    payload: UserStatusRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    action = (payload.acao or "").strip().lower()
    required_permission = {
        "ativar": "usuarios.ativar",
        "desativar": "usuarios.desativar",
        "bloquear": "usuarios.bloquear",
        "desbloquear": "usuarios.desbloquear",
    }.get(action, "usuarios.editar")
    if not user.has_permission(required_permission):
        from ..dependencies import ensure_user_permission

        ensure_user_permission(user, required_permission, repository=repository)
    return repository.set_system_user_status(id_usuario, payload.model_dump(), actor=user)


@router.delete("/users/{id_usuario}", dependencies=[Depends(require_permissions("usuarios.excluir"))])
def delete_user(
    id_usuario: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.deactivate_system_user(id_usuario, actor=user, justificativa=justificativa)


@router.get(
    "/users/email-change-requests",
    dependencies=[Depends(require_permissions("usuarios.alterar_email"))],
)
def list_email_change_requests(repository: DatabaseRepository = Depends(get_repository)):
    return {"solicitacoes": repository.list_pending_email_change_requests()}


@router.post(
    "/users/email-change-requests/{id_solicitacao}/approve",
    dependencies=[Depends(require_permissions("usuarios.alterar_email"))],
)
def approve_email_change_request(
    id_solicitacao: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.approve_email_change_request(id_solicitacao, decidido_por=user.username)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="aprovar_alteracao_email",
        entidade="solicitacao_alteracao_email",
        entidade_id=str(id_solicitacao),
    )
    return result


@router.post(
    "/users/email-change-requests/{id_solicitacao}/reject",
    dependencies=[Depends(require_permissions("usuarios.alterar_email"))],
)
def reject_email_change_request(
    id_solicitacao: int,
    payload: DecideEmailChangeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.reject_email_change_request(
        id_solicitacao, decidido_por=user.username, motivo=payload.motivo
    )
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="rejeitar_alteracao_email",
        entidade="solicitacao_alteracao_email",
        entidade_id=str(id_solicitacao),
        valor_novo={"motivo": payload.motivo},
    )
    return result


@router.get("/audit-logs", dependencies=[Depends(require_permissions("logs.visualizar"))])
def get_audit_logs(
    limit: int = Query(default=100),
    modulo: str = Query(default=""),
    acao: str = Query(default=""),
    usuario: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_audit_logs(limit=limit, modulo=modulo, acao=acao, usuario=usuario)


@router.get("/audit-logs/export", dependencies=[Depends(require_permissions("logs.exportar"))])
def export_audit_logs(repository: DatabaseRepository = Depends(get_repository)):
    filename, content = repository.export_audit_logs_csv()
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/catalog", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def get_settings_catalog(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_configuration_catalog()


@router.post("/catalog/{tipo}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def create_settings_item(
    tipo: str,
    payload: ConfigurationItemRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.upsert_configuration_item(tipo, payload.model_dump(), actor=user)


@router.put("/catalog/{tipo}/{id_item}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def update_settings_item(
    tipo: str,
    id_item: int,
    payload: ConfigurationItemRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.upsert_configuration_item(tipo, payload.model_dump(), id_item=id_item, actor=user)


@router.delete("/catalog/{tipo}/{id_item}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def deactivate_settings_item(
    tipo: str,
    id_item: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.deactivate_configuration_item(tipo, id_item, actor=user, justificativa=justificativa)


@router.delete("/catalog/{tipo}/{id_item}/permanente", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def delete_settings_item_permanently(
    tipo: str,
    id_item: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.delete_configuration_item(tipo, id_item, actor=user, justificativa=justificativa)


@router.post("/lgpd/requests", dependencies=[Depends(require_permissions("lgpd.registrar_solicitacao"))])
def register_lgpd_request(
    payload: LgpdRequestCreate,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.register_lgpd_request(payload.model_dump(), actor=user)


@router.get(
    "/automacao-notificacoes",
    dependencies=[Depends(require_permissions("notificacoes.configurar"))],
)
def get_notification_automation_settings(repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_notification_automation_settings()


@router.put(
    "/automacao-notificacoes",
    dependencies=[Depends(require_permissions("notificacoes.configurar"))],
)
def update_notification_automation_settings(
    payload: NotificationAutomationSettingsRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_notification_automation_settings(
        payload.model_dump(),
        actor=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="atualizar_automacao_notificacoes",
        entidade="configuracoes_notificacoes_automaticas",
        valor_novo=payload.model_dump(),
    )
    return result


@router.get("/health", response_model=SuccessResponse)
def settings_health() -> SuccessResponse:
    return SuccessResponse(message="Modulo de configuracoes ativo.")

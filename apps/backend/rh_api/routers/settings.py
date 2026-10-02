from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..rbac import ACCESS_DENIED_MESSAGE
from ..repositories import DatabaseRepository
from ..services.http_cache import aplicar_cache_http
from ..schemas.auth import DecideEmailChangeRequest
from ..schemas.common import SuccessResponse
from ..schemas.security import (
    ConfigurationItemRequest,
    LgpdRequestCreate,
    LgpdRetencaoConfigRequest,
    LgpdRetencaoExecutarRequest,
    NotificationAutomationSettingsRequest,
    RolePermissionsUpdateRequest,
    TelaInicialConfigRequest,
    QuickTrainingUserCreateRequest,
    UserCreateRequest,
    UserPasswordRequest,
    UserStatusRequest,
    UserUpdateRequest,
)


def _require_catalog_write_access(tipo: str, user: AuthenticatedUser) -> None:
    """Correções.txt (24/set/2026, item 11): `operacoes.editar` só libera escrita
    no catálogo "operacoes" — as demais gavetas (etapas, motivos_eliminacao etc.)
    continuam exigindo a permissão ampla `configuracoes.editar`, senão um perfil
    com acesso só a Operações poderia editar qualquer catálogo pela mesma rota
    genérica /catalog/{tipo}."""
    if user.has_permission("configuracoes.editar"):
        return
    if tipo == "operacoes" and user.has_permission("operacoes.editar"):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCESS_DENIED_MESSAGE)


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


@router.get("/tela-inicial", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def list_tela_inicial_perfis(repository: DatabaseRepository = Depends(get_repository)):
    """Configuração dos blocos da tela inicial de todos os perfis."""
    return repository.list_tela_inicial_perfis()


@router.get("/tela-inicial/minha")
def get_minha_tela_inicial(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    """Blocos da tela inicial do perfil do usuário logado (o front ainda aplica
    a permissão de cada bloco)."""
    return repository.get_tela_inicial_perfil(user.perfil)


@router.put("/tela-inicial/{id_perfil}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def save_tela_inicial_perfil(
    id_perfil: str,
    payload: TelaInicialConfigRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.save_tela_inicial_perfil(id_perfil, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Configurações",
        acao="configurar_tela_inicial_perfil",
        entidade="perfil",
        entidade_id=id_perfil,
        valor_novo={"blocos": result.get("blocos")},
    )
    return result


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


@router.get("/users/bulk/template", dependencies=[Depends(require_permissions("usuarios.criar"))])
def baixar_modelo_usuarios_em_massa(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return Response(
        content=repository.usuarios_massa_modelo(user),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="modelo-cadastro-usuarios.xlsx"'},
    )


@router.post("/users/bulk", dependencies=[Depends(require_permissions("usuarios.criar"))])
async def cadastrar_usuarios_em_massa(
    request: Request,
    arquivo: UploadFile = File(...),
    confirmar: bool = Form(default=False),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    """Prévia (confirmar=false) ou criação (confirmar=true) dos usuários de uma planilha; linhas incompletas são ignoradas."""
    conteudo = await arquivo.read(2 * 1024 * 1024 + 1)
    return repository.usuarios_massa_processar(user, conteudo, confirmar=confirmar, ip=request.client.host if request.client else "")


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
    return repository.delete_system_user(id_usuario, actor=user, justificativa=justificativa)


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
def get_settings_catalog(
    request: Request,
    response: Response,
    repository: DatabaseRepository = Depends(get_repository),
):
    dados = repository.list_configuration_catalog()
    if aplicar_cache_http(request, response, dados):
        return Response(status_code=304, headers=dict(response.headers))
    return dados


@router.post("/catalog/{tipo}", dependencies=[Depends(require_permissions("configuracoes.editar", "operacoes.editar"))])
def create_settings_item(
    tipo: str,
    payload: ConfigurationItemRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    _require_catalog_write_access(tipo, user)
    return repository.upsert_configuration_item(tipo, payload.model_dump(), actor=user)


@router.put("/catalog/{tipo}/{id_item}", dependencies=[Depends(require_permissions("configuracoes.editar", "operacoes.editar"))])
def update_settings_item(
    tipo: str,
    id_item: int,
    payload: ConfigurationItemRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    _require_catalog_write_access(tipo, user)
    return repository.upsert_configuration_item(tipo, payload.model_dump(), id_item=id_item, actor=user)


@router.delete("/catalog/{tipo}/{id_item}", dependencies=[Depends(require_permissions("configuracoes.editar", "operacoes.editar"))])
def deactivate_settings_item(
    tipo: str,
    id_item: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    _require_catalog_write_access(tipo, user)
    return repository.deactivate_configuration_item(tipo, id_item, actor=user, justificativa=justificativa)


@router.delete("/catalog/{tipo}/{id_item}/permanente", dependencies=[Depends(require_permissions("configuracoes.editar", "operacoes.editar"))])
def delete_settings_item_permanently(
    tipo: str,
    id_item: int,
    justificativa: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    _require_catalog_write_access(tipo, user)
    return repository.delete_configuration_item(tipo, id_item, actor=user, justificativa=justificativa)


def _sem_internos(dados: dict) -> dict:
    return {chave: valor for chave, valor in dados.items() if not chave.startswith("_")}


@router.get("/lgpd/retencao", dependencies=[Depends(require_permissions("lgpd.visualizar"))])
def get_lgpd_retencao(repository: DatabaseRepository = Depends(get_repository)):
    """Configuração e último resultado da retenção automática de candidatos."""
    return repository.get_lgpd_retencao_config()


@router.put("/lgpd/retencao", dependencies=[Depends(require_permissions("lgpd.configurar"))])
def save_lgpd_retencao(
    payload: LgpdRetencaoConfigRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    anterior = repository.get_lgpd_retencao_config()
    result = repository.save_lgpd_retencao_config(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="LGPD",
        acao="configurar_retencao_lgpd",
        entidade="lgpd_retencao_config",
        entidade_id="1",
        valor_anterior={k: anterior.get(k) for k in payload.model_dump()},
        valor_novo=payload.model_dump(),
    )
    return result


@router.get("/lgpd/retencao/simulacao", dependencies=[Depends(require_permissions("lgpd.visualizar"))])
def simular_lgpd_retencao(repository: DatabaseRepository = Depends(get_repository)):
    """Prévia (nada é apagado): quem seria avisado e quem seria excluído hoje."""
    return _sem_internos(repository.simular_lgpd_retencao())


@router.post("/lgpd/retencao/executar", dependencies=[Depends(require_permissions("lgpd.configurar", "lgpd.anonimizar"))])
def executar_lgpd_retencao(
    payload: LgpdRetencaoExecutarRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    """Executa agora (mesmas regras do job diário). Exige digitar EXCLUIR."""
    if payload.confirmacao.strip().upper() != "EXCLUIR":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='Digite EXCLUIR para confirmar.')
    return repository.executar_lgpd_retencao(forcar=True, actor=user)


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

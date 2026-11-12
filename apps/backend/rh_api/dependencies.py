from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import replace

from conecta.domain.permissoes import AuthorizationPolicy
from conecta.infrastructure.observability.context import user_id_var
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .auth import AuthenticatedUser, validate_access_token
from .config import get_settings
from .rbac import ACCESS_DENIED_MESSAGE, is_critical_permission
from .repositories import DatabaseRepository
from .services import acesso as acesso_modulos
from .services import acesso_cache, acesso_decisao
from .services.monitoria_scope import escopo_global

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)


def get_repository() -> DatabaseRepository:
    return DatabaseRepository(get_settings())


def _refresh_monitoria_scope(user: AuthenticatedUser, request: Request | None) -> AuthenticatedUser:
    """Nas rotas /monitoria, Supervisor/Qualidade (e demais perfis restritos) usam as
    operações vinculadas ATUAIS do banco, não as gravadas no token no login — assim
    trocar o vínculo de um usuário vale na próxima requisição, sem novo login.
    Falha na leitura = nenhuma operação (DENY por padrão)."""
    if request is None or not user.id_usuario:
        return user
    caminho = request.url.path
    if caminho.startswith("/wfm"):
        # WFM: só Administrador e Gestor são globais; Control Desk e demais usam os vínculos ATUAIS.
        from .services.wfm_scope import PERFIS_GLOBAIS as _globais_wfm

        if user.perfil in _globais_wfm:
            return user
    elif not caminho.startswith("/monitoria") or escopo_global(user.perfil):
        return user
    try:
        conn = get_repository()._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (int(user.id_usuario),)
            )
            operacoes = frozenset(str(row[0]).strip() for row in cursor.fetchall() if row[0])
        finally:
            conn.close()
    except Exception:
        logger.exception("Falha ao reler o escopo de operações do usuário %s; acesso negado.", user.id_usuario)
        operacoes = frozenset()
    return replace(user, operacoes=operacoes)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    request: Request = None,
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação obrigatória.",
        )

    user = validate_access_token(credentials.credentials)
    user = _refresh_monitoria_scope(user, request)
    # Central de Acessos, Etapa 2: permissões atuais do perfil (cache em memória), não as congeladas no token.
    # Mudou o perfil em Perfis e Permissões, vale no próximo pedido, sem sair e entrar. Sem cache = token, como antes.
    if user.id_usuario:
        # Etapa 5: troca de PERFIL também vale sem relogin (perfil vigente no banco, via cache).
        perfil_vigente = acesso_cache.perfil_atual(user.id_usuario)
        if perfil_vigente and perfil_vigente != user.perfil:
            from .rbac import get_role_definition

            definicao = get_role_definition(perfil_vigente)
            user = replace(user, perfil=definicao.id, perfil_nome=definicao.name, nivel=definicao.level)
        atuais = acesso_cache.permissoes_atuais(user.perfil)
        if atuais is not None and atuais != user.permissions:
            user = replace(user, permissions=atuais)
    # Módulo desativado: as permissões dele deixam de valer já neste pedido (sem relogin). Com todos ativos, não muda nada.
    permissoes_efetivas = acesso_modulos.filtrar_permissoes(user.permissions)
    # Etapa 5: com a chave ligada, a regra única decide o conjunto final (função por unidade e exceções incluídas).
    if acesso_decisao.regra_unica_manda() and user.id_usuario:
        try:
            permissoes_efetivas = acesso_decisao.permissoes_efetivas(
                permissoes_efetivas, perfil=user.perfil, id_usuario=user.id_usuario, unidades_do_usuario=user.operacoes,
            )
        except Exception:  # noqa: BLE001 - falha na regra nova = regra de hoje, nunca derruba o pedido
            logger.exception("Regra única de acesso falhou para o usuário %s; usando a regra de hoje.", user.id_usuario)
    if permissoes_efetivas != user.permissions:
        user = replace(user, permissions=permissoes_efetivas)
    user_id_var.set(str(user.id_usuario or user.username))
    if request is not None:
        # Dependências síncronas rodam em outra thread: o contextvar não volta ao
        # middleware, então o log de acesso lê o usuário de request.state.
        request.state.log_user_id = str(user.id_usuario or user.username)
    # Primeiro acesso: só as rotas de autenticação (trocar a senha, sessão,
    # logout) ficam liberadas até a senha inicial ser trocada.
    if user.deve_trocar_senha and request is not None and not request.url.path.startswith("/auth/"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="TROCA_SENHA_OBRIGATORIA: altere a senha inicial para continuar.",
        )
    return user


def _request_origin(request: Request | None) -> str:
    if request is None:
        return ""
    if request.client and request.client.host:
        return request.client.host
    return request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()


def _log_permission_denied(
    *,
    repository: DatabaseRepository,
    user: AuthenticatedUser,
    request: Request | None,
    permissions: tuple[str, ...],
) -> None:
    try:
        repository.record_audit_log(
            user=user,
            modulo="Segurança",
            acao="acesso_negado",
            entidade="rota",
            entidade_id=f"{request.method} {request.url.path}" if request else "",
            valor_novo={"permissoes_requeridas": list(permissions)},
            origem=_request_origin(request),
            sucesso=False,
        )
    except Exception:
        return


def require_permissions(
    *permissions: str,
    require_all: bool = False,
) -> Callable:
    required_permissions = tuple(permission for permission in permissions if permission)

    def dependency(
        request: Request,
        user: AuthenticatedUser = Depends(get_current_user),
        repository: DatabaseRepository = Depends(get_repository),
    ) -> AuthenticatedUser:
        if not required_permissions:
            return user

        has_access = AuthorizationPolicy(user.permissions).allows(
            *required_permissions,
            require_all=require_all,
        )
        # Central de Acessos, Etapa 1: a regra única roda ao lado e só registra divergência. Não muda a resposta.
        acesso_decisao.comparar_em_sombra(
            user.permissions,
            required_permissions,
            exigir_todas=require_all,
            resposta_atual=has_access,
            rota=f"{request.method} {request.url.path}" if request is not None else "",
            usuario=str(user.id_usuario or user.username),
            unidades_do_usuario=user.operacoes,
        )
        if has_access:
            return user

        _log_permission_denied(
            repository=repository,
            user=user,
            request=request,
            permissions=required_permissions,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ACCESS_DENIED_MESSAGE,
        )

    return dependency


def ensure_user_permission(
    user: AuthenticatedUser,
    permission: str,
    *,
    repository: DatabaseRepository | None = None,
    request: Request | None = None,
) -> None:
    if user.has_permission(permission):
        return

    if repository is not None:
        _log_permission_denied(
            repository=repository,
            user=user,
            request=request,
            permissions=(permission,),
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=ACCESS_DENIED_MESSAGE,
    )


def ensure_resource_scope(
    user: AuthenticatedUser,
    operacao: str | None,
    *,
    repository: DatabaseRepository | None = None,
    request: Request | None = None,
) -> None:
    """Achado SEC-002: valida que o usuário tem acesso à operação do recurso
    pedido, não só a permissão de módulo. Aditivo — usuários sem escopo
    atribuído (`user.operacoes` vazio, o caso de hoje) não são afetados."""
    if user.allows_operacao(operacao):
        return

    if repository is not None:
        try:
            repository.record_audit_log(
                user=user,
                modulo="Segurança",
                acao="acesso_negado_escopo",
                entidade="rota",
                entidade_id=f"{request.method} {request.url.path}" if request else "",
                valor_novo={"operacao_recurso": operacao},
                origem=_request_origin(request),
                sucesso=False,
            )
        except Exception as exc:
            logger.debug("Falha ao registrar log de auditoria de acesso negado por escopo: %s", exc)

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Este recurso pertence a uma operação fora do seu escopo de acesso.",
    )


def audit_action(
    repository: DatabaseRepository,
    user: AuthenticatedUser | None,
    *,
    modulo: str,
    acao: str,
    entidade: str = "",
    entidade_id: str = "",
    valor_anterior=None,
    valor_novo=None,
    justificativa: str = "",
    request: Request | None = None,
    sucesso: bool = True,
) -> None:
    if not isinstance(user, AuthenticatedUser):
        return
    if not hasattr(repository, "record_audit_log"):
        return
    try:
        repository.record_audit_log(
            user=user,
            modulo=modulo,
            acao=acao,
            entidade=entidade,
            entidade_id=entidade_id,
            valor_anterior=valor_anterior,
            valor_novo=valor_novo,
            justificativa=justificativa,
            origem=_request_origin(request),
            sucesso=sucesso,
        )
    except Exception:
        return


def is_permission_critical(permission: str) -> bool:
    return is_critical_permission(permission)


def exigir_relatorio_hub(user: AuthenticatedUser, chave: str) -> None:
    """Relatórios e Históricos: o relatório precisa estar ligado ao perfil (`relhub.*`), além da permissão de base da rota."""
    if not user.has_permission(chave):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCESS_DENIED_MESSAGE)

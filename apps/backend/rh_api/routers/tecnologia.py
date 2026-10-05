from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.modulos import ModuloAtivoRequest, ModulosAcessoRequest, PermissaoModuloRequest, WfmParticipantesRequest
from ..services import acesso, modulos_admin

router = APIRouter(prefix="/tecnologia", tags=["tecnologia"], dependencies=[Depends(get_current_user)])


@router.get("/modulos", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def listar_modulos() -> list[dict]:
    return modulos_admin.listar_modulos()


@router.get("/resumo", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def resumo_inicio() -> dict:
    """Indicadores da tela inicial da Tecnologia (contagens), sem baixar a lista de usuários."""
    return modulos_admin.resumo_inicio()


@router.get("/modulos/acesso", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def listar_acessos() -> dict:
    """Módulos por perfil (o que as permissões já abrem + o liberado à parte) e usuários com liberação individual."""
    return modulos_admin.listar_acessos()


@router.put("/modulos/acesso/perfil/{id_perfil}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_acesso_perfil(id_perfil: str, payload: ModulosAcessoRequest, request: Request,
                          user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)) -> dict:
    resultado = modulos_admin.definir_acesso_perfil(id_perfil, payload.modulos, autor=user.username)
    audit_action(repository, user, modulo="Sistema", acao="modulo_acesso_perfil_alterado", entidade="perfil", entidade_id=id_perfil,
                 valor_anterior={"modulos": resultado["anteriores"]}, valor_novo={"modulos": resultado["modulos"]},
                 justificativa=payload.justificativa, request=request)
    return resultado


@router.put("/modulos/acesso/usuario/{id_usuario}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_acesso_usuario(id_usuario: int, payload: ModulosAcessoRequest, request: Request,
                           user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)) -> dict:
    resultado = modulos_admin.definir_acesso_usuario(id_usuario, payload.modulos, autor=user.username)
    audit_action(repository, user, modulo="Sistema", acao="modulo_acesso_usuario_alterado", entidade="usuario", entidade_id=str(id_usuario),
                 valor_anterior={"modulos": resultado["anteriores"]}, valor_novo={"modulos": resultado["modulos"]},
                 justificativa=payload.justificativa, request=request)
    return resultado


@router.put("/modulos/{chave}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_modulo_ativo(
    chave: str,
    payload: ModuloAtivoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> dict:
    resultado = modulos_admin.definir_ativo(chave, payload.ativo, autor=user.username)
    audit_action(
        repository,
        user,
        modulo="Sistema",
        acao="modulo_ativacao_alterada",
        entidade="modulo",
        entidade_id=chave,
        valor_anterior={"ativo": resultado["ativo_anterior"]},
        valor_novo={"ativo": resultado["ativo"]},
        justificativa=payload.justificativa,
        request=request,
    )
    return resultado


@router.put("/permissoes/{chave}/modulo", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_modulo_da_permissao(
    chave: str,
    payload: PermissaoModuloRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> dict:
    resultado = modulos_admin.definir_modulo_da_permissao(chave, payload.modulo, payload.abre_modulo, autor=user.username)
    audit_action(
        repository,
        user,
        modulo="Sistema",
        acao="modulo_dono_permissao_alterado",
        entidade="permissao",
        entidade_id=chave,
        valor_anterior={"modulo": resultado["modulo_anterior"]},
        valor_novo={"modulo": resultado["modulo"], "abre_modulo": resultado["abre_modulo"]},
        justificativa=payload.justificativa,
        request=request,
    )
    return resultado


@router.get("/parametros/wfm-participantes", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def situacao_wfm_participantes() -> dict:
    """Liberação do WFM para Operador, Técnico de TI e Qualidade: valor efetivo, origem (ambiente/banco) e se pode alterar."""
    return acesso.situacao_wfm_participantes()


@router.put("/parametros/wfm-participantes", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_wfm_participantes(
    payload: WfmParticipantesRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> dict:
    """O botão de Tecnologia. Exige confirmação explícita e grava auditoria (quem, quando, de que valor para que valor)."""
    if not payload.confirmar:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Confirme a alteração para continuar.")
    resultado = acesso.definir_wfm_participantes(payload.valor, autor=user.username)
    audit_action(
        repository,
        user,
        modulo="Sistema",
        acao="wfm_participantes_alterado",
        entidade="parametro",
        entidade_id=acesso.PARAM_WFM_PARTICIPANTES,
        valor_anterior={"liberado": resultado["valor_anterior"]},
        valor_novo={"liberado": resultado["valor"]},
        justificativa=payload.justificativa,
        request=request,
    )
    return {**acesso.situacao_wfm_participantes(), "valor_anterior": resultado["valor_anterior"]}

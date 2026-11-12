from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.modulos import (
    FuncaoModuloRequest,
    LoteAcessosRequest,
    LoteModulosRequest,
    ModuloAtivoRequest,
    ModulosAcessoRequest,
    PadronizarAcessosRequest,
    PermissaoModuloRequest,
    WfmParticipantesRequest,
)
from ..services import acesso, acesso_cache, central_acessos, modulos_admin

router = APIRouter(prefix="/tecnologia", tags=["tecnologia"], dependencies=[Depends(get_current_user)])


@router.get("/modulos", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def listar_modulos() -> list[dict]:
    return modulos_admin.listar_modulos()


@router.get("/unidades", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def listar_unidades(modulo: str | None = None) -> list[dict]:
    """Operações e setores (Central de Acessos, Etapa 3). Com `modulo`, só as unidades daquele módulo."""
    foto = acesso_cache.foto()
    lista = acesso_cache.unidades_do_modulo(modulo, so_ativas=False) if modulo else sorted(foto.unidades.values(), key=lambda u: (u.modulo, u.tipo, u.nome.lower()))
    return [{"chave": u.chave, "nome": u.nome, "tipo": u.tipo, "modulo": u.modulo, "ativo": u.ativo} for u in lista]


@router.get("/acessos", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def ler_acessos(modulo: str, escopo: str = "padrao") -> dict:
    """Central de Acessos (Etapa 6): funções do catálogo, ações e o que cada perfil pode, no escopo pedido."""
    return central_acessos.matriz(modulo, escopo)


@router.get("/acessos/escopos", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def ler_escopos_acessos(modulo: str) -> dict:
    """Opções do "Vale para": unidades do módulo e as pessoas ligadas a elas."""
    return central_acessos.escopos(modulo)


@router.put("/acessos/lote", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def salvar_acessos(payload: LoteAcessosRequest, request: Request,
                   user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)) -> dict:
    """Salvar da Central de Acessos: tudo ou nada, uma linha de auditoria por mudança."""
    resultado = central_acessos.salvar_lote(payload.modulo, payload.escopo, [m.model_dump() for m in payload.mudancas], autor=user.username)
    for m in resultado["aplicadas"]:
        entidade_id = f"{payload.modulo}|{payload.escopo}|" + (m["funcao"] if m["tipo"] == "funcao" else f"{m['perfil']}|{m['chave']}")
        audit_action(repository, user, modulo="Sistema", acao="central_acessos_alterada", entidade=m["tipo"], entidade_id=entidade_id,
                     valor_novo=m, justificativa=payload.justificativa, request=request)
    return resultado


@router.post("/acessos/padronizar", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def padronizar_acessos(payload: PadronizarAcessosRequest, request: Request,
                       user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)) -> dict:
    resultado = central_acessos.padronizar(payload.modulo, payload.escopo, autor=user.username)
    audit_action(repository, user, modulo="Sistema", acao="central_acessos_padronizada", entidade="escopo",
                 entidade_id=f"{payload.modulo}|{payload.escopo}", valor_novo=resultado, justificativa=payload.justificativa, request=request)
    return resultado


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
    acesso_cache.invalidar()
    audit_action(repository, user, modulo="Sistema", acao="modulo_acesso_perfil_alterado", entidade="perfil", entidade_id=id_perfil,
                 valor_anterior={"modulos": resultado["anteriores"]}, valor_novo={"modulos": resultado["modulos"]},
                 justificativa=payload.justificativa, request=request)
    return resultado


@router.put("/modulos/acesso/usuario/{id_usuario}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_acesso_usuario(id_usuario: int, payload: ModulosAcessoRequest, request: Request,
                           user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)) -> dict:
    resultado = modulos_admin.definir_acesso_usuario(id_usuario, payload.modulos, autor=user.username)
    acesso_cache.invalidar()
    audit_action(repository, user, modulo="Sistema", acao="modulo_acesso_usuario_alterado", entidade="usuario", entidade_id=str(id_usuario),
                 valor_anterior={"modulos": resultado["anteriores"]}, valor_novo={"modulos": resultado["modulos"]},
                 justificativa=payload.justificativa, request=request)
    return resultado


_ACAO_LOTE = {"modulo": ("modulo_ativacao_alterada", "modulo"), "funcao": ("modulo_funcao_alterada", "modulo_funcao"),
              "wfm_participantes": ("wfm_participantes_alterado", "parametro")}


@router.put("/modulos/lote", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def aplicar_lote_modulos(
    payload: LoteModulosRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> dict:
    """Salvar em lote da tela Módulos: atômico (tudo ou nada). Uma linha de auditoria por mudança, todas com o mesmo `id_lote`."""
    resultado = modulos_admin.aplicar_lote([a.model_dump() for a in payload.alteracoes], autor=user.username)
    for p in resultado["aplicadas"]:
        acao, entidade = _ACAO_LOTE[p["tipo"]]
        entidade_id = {"modulo": p["modulo"], "funcao": f"{p['modulo']}:{p['funcao']}"}.get(p["tipo"], acesso.PARAM_WFM_PARTICIPANTES)
        audit_action(
            repository, user, modulo="Sistema", acao=acao, entidade=entidade, entidade_id=entidade_id,
            valor_anterior={"ativo": p["ativo_anterior"], "id_lote": resultado["id_lote"]},
            valor_novo={"ativo": p["ativo"], "id_lote": resultado["id_lote"]},
            justificativa=payload.justificativa, request=request,
        )
    return {**resultado, "funcoes": modulos_admin.listar_funcoes(), "wfm": acesso.situacao_wfm_participantes()}


@router.get("/modulos/funcoes", dependencies=[Depends(require_permissions("configuracoes.visualizar"))])
def listar_funcoes() -> list[dict]:
    """Funções (grupos do menu) que cada módulo exibe e quais estão ligadas."""
    return modulos_admin.listar_funcoes()


@router.put("/modulos/{modulo}/funcoes/{funcao}", dependencies=[Depends(require_permissions("configuracoes.editar"))])
def definir_funcao_modulo(
    modulo: str,
    funcao: str,
    payload: FuncaoModuloRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
) -> dict:
    resultado = modulos_admin.definir_funcao(modulo, funcao, payload.ativo, autor=user.username)
    audit_action(
        repository, user, modulo="Sistema", acao="modulo_funcao_alterada", entidade="modulo_funcao", entidade_id=f"{modulo}:{funcao}",
        valor_anterior={"ativo": resultado["ativo_anterior"]}, valor_novo={"ativo": resultado["ativo"]},
        justificativa=payload.justificativa, request=request,
    )
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

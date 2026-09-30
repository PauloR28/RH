"""WFM — Turnos e Plantões (Fase 1): rotas.

Toda rota passa por permissão de módulo E por escopo de operação/equipe/perfil
no repositório (services/wfm_scope.py). Fora do escopo desta fase: trocas,
notificações, aderência e sugestão automática de escala."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.wfm import (
    AtestadoRequest,
    ContratoOperadorRequest,
    ContratoRequest,
    EventoRequest,
    FecharRequest,
    PresencaRequest,
    PublicarRequest,
    SalvarItensRequest,
    SkillRequest,
    SkillsOperadorRequest,
    TurnoRequest,
)

router = APIRouter(prefix="/wfm", tags=["wfm"], dependencies=[Depends(get_current_user)])

_LER_ESCALA = ("wfm.escala.visualizar", "wfm.escala.propria")


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


@router.get("/contexto", dependencies=[Depends(require_permissions("sessao.wfm.acessar"))])
def contexto(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_contexto(user)


# ---- Cadastros ---------------------------------------------------------
@router.get("/contratos", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar"))])
def listar_contratos(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_contratos(user, operacao)}


@router.post("/contratos", dependencies=[Depends(require_permissions("wfm.contratos.editar"))])
def criar_contrato(payload: ContratoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_contrato(user, payload.model_dump(), ip=client_ip(request))


@router.put("/contratos/{id_contrato}", dependencies=[Depends(require_permissions("wfm.contratos.editar"))])
def atualizar_contrato(id_contrato: int, payload: ContratoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_contrato(user, payload.model_dump(), id_contrato, ip=client_ip(request))


@router.get("/turnos", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar"))])
def listar_turnos(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_turnos(user, operacao)}


@router.post("/turnos", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def criar_turno(payload: TurnoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_turno(user, payload.model_dump(), ip=client_ip(request))


@router.put("/turnos/{id_turno}", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def atualizar_turno(id_turno: int, payload: TurnoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_turno(user, payload.model_dump(), id_turno, ip=client_ip(request))


@router.get("/skills", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar"))])
def listar_skills(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_skills(user, operacao)}


@router.post("/skills", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def criar_skill(payload: SkillRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_skill(user, payload.model_dump(), ip=client_ip(request))


@router.put("/skills/{id_skill}", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def atualizar_skill(id_skill: int, payload: SkillRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_skill(user, payload.model_dump(), id_skill, ip=client_ip(request))


@router.put("/operadores/{id_operador}/skills", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def definir_skills_operador(id_operador: int, payload: SkillsOperadorRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_set_skills_operador(user, payload.operacao, id_operador, payload.ids_skill, ip=client_ip(request))


@router.put("/operadores/{id_operador}/contrato", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def vincular_contrato_operador(id_operador: int, payload: ContratoOperadorRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_set_contrato_operador(user, payload.operacao, id_operador, payload.id_contrato, payload.vigencia_ini, ip=client_ip(request))


@router.get("/calendario", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar", *_LER_ESCALA))])
def listar_calendario(operacao: str, ano_mes: str = "", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_calendario(user, operacao, ano_mes)}


@router.post("/calendario", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def criar_evento(payload: EventoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_evento(user, payload.model_dump(), ip=client_ip(request))


@router.put("/calendario/{id_item}", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def atualizar_evento(id_item: int, payload: EventoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_evento(user, payload.model_dump(), id_item, ip=client_ip(request))


# ---- Escala ------------------------------------------------------------
@router.get("/escala", dependencies=[Depends(require_permissions(*_LER_ESCALA))])
def obter_escala(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_get_escala(user, operacao, ano_mes)


@router.put("/escala/itens", dependencies=[Depends(require_permissions("wfm.escala.editar"))])
def salvar_itens(payload: SalvarItensRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_salvar_itens(
        user, payload.operacao, payload.ano_mes, [i.model_dump() for i in payload.itens],
        justificativa=payload.justificativa, ip=client_ip(request),
    )


@router.get("/escala/validar", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def validar_escala(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_validar(user, operacao, ano_mes)


@router.post("/escala/publicar", dependencies=[Depends(require_permissions("wfm.escala.publicar"))])
def publicar(payload: PublicarRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_publicar(user, payload.operacao, payload.ano_mes, justificativa=payload.justificativa, ip=client_ip(request))


@router.post("/escala/fechar", dependencies=[Depends(require_permissions("wfm.escala.fechar"))])
def fechar(payload: FecharRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_fechar_periodo(user, payload.operacao, payload.ano_mes, ip=client_ip(request))


@router.get("/escala/versoes", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def listar_versoes(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_versoes(user, operacao, ano_mes)}


@router.get("/escala/versoes/{versao}", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def obter_versao(versao: int, operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_get_versao(user, operacao, ano_mes, versao)


# ---- Presença ----------------------------------------------------------
@router.get("/presencas", dependencies=[Depends(require_permissions(*_LER_ESCALA))])
def listar_presencas(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_presencas(user, operacao, ano_mes)}


@router.put("/presencas", dependencies=[Depends(require_permissions("wfm.presenca.lancar"))])
def lancar_presenca(payload: PresencaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_lancar_presenca(
        user, payload.operacao, payload.id_operador, payload.data, payload.status, payload.observacao, ip=client_ip(request)
    )


@router.get("/atestados", dependencies=[Depends(require_permissions("wfm.presenca.lancar"))])
def listar_atestados(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_atestados(user, operacao, ano_mes)}


@router.post("/atestados", dependencies=[Depends(require_permissions("wfm.presenca.lancar"))])
def registrar_atestado(payload: AtestadoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_registrar_atestado(
        user, payload.operacao, payload.id_operador, payload.data_ini, payload.data_fim, payload.tipo, ip=client_ip(request)
    )


# ---- Auditoria (Gestor/RH e Adm) ---------------------------------------
@router.get("/auditoria", dependencies=[Depends(require_permissions("wfm.auditoria"))])
def auditoria(
    operacao: str = "",
    entidade: str = "",
    acao: str = "",
    limite: int = 200,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return {"itens": repository.wfm_list_auditoria(user, operacao, limite, entidade, acao)}

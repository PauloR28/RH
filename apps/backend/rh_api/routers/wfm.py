"""WFM — Turnos e Plantões (Fase 1): rotas.

Toda rota passa por permissão de módulo E por escopo de operação/equipe/perfil
no repositório (services/wfm_scope.py). Fora do escopo desta fase: trocas,
notificações, aderência e sugestão automática de escala."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.wfm import (
    AtestadoRequest,
    CapacidadePausasRequest,
    ConfigEscalaRequest,
    CriarEscalaRequest,
    DuplicarEscalaRequest,
    DeclinarRequest,
    DistribuirPausasRequest,
    PersonalizacaoTurnoRequest,
    PresencaLoteRequest,
    SalvarPausasRequest,
    ContratoOperadorRequest,
    ContratoRequest,
    EventoRequest,
    FecharRequest,
    HoraExtraRequest,
    PresencaRequest,
    PublicarRequest,
    ReplicarPausasRequest,
    SalvarItensRequest,
    SkillRequest,
    SkillsOperadorRequest,
    TrocaDecidirRequest,
    TrocaDesfazerRequest,
    TrocaResponderRequest,
    TrocaSolicitarRequest,
    TipoEscalaRequest,
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


@router.delete("/contratos/{id_contrato}", dependencies=[Depends(require_permissions("wfm.contratos.editar"))])
def excluir_contrato(id_contrato: int, operacao: str, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_excluir_contrato(user, operacao, id_contrato, ip=client_ip(request))


@router.get("/contratos/{id_contrato}/operadores", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar"))])
def operadores_do_contrato(id_contrato: int, operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_operadores_do_contrato(user, operacao, id_contrato)}


@router.delete("/contratos/{id_contrato}/operadores/{id_operador}", dependencies=[Depends(require_permissions("wfm.contratos.editar"))])
def desvincular_operador_do_contrato(id_contrato: int, id_operador: int, operacao: str, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_desvincular_operador_contrato(user, operacao, id_contrato, id_operador, ip=client_ip(request))


@router.get("/supervisores", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar", *_LER_ESCALA))])
def listar_supervisores(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_supervisores(user, operacao)}


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
def obter_escala(operacao: str, ano_mes: str, propria: bool = False, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_get_escala(user, operacao, ano_mes, propria=propria)


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


@router.get("/escala/exportar", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def exportar_escala(operacao: str, ano_mes: str, request: Request, formato: str = "xlsx", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    conteudo, nome, mime = repository.wfm_exportar_escala(user, operacao, ano_mes, formato, ip=client_ip(request))
    return Response(content=conteudo, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@router.get("/relatorios", dependencies=[Depends(require_permissions("wfm.relatorios"))])
def relatorio(operacao: str, data_ini: str, data_fim: str, tipo: str = "resumo", id_operador: int | None = None, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_relatorio(user, operacao, tipo, data_ini, data_fim, id_operador)


@router.get("/relatorios/exportar", dependencies=[Depends(require_permissions("wfm.relatorios"))])
def exportar_relatorio(operacao: str, data_ini: str, data_fim: str, tipo: str = "resumo", id_operador: int | None = None, formato: str = "xlsx", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    conteudo, nome, mime = repository.wfm_relatorio_exportar(user, operacao, tipo, data_ini, data_fim, id_operador, formato)
    return Response(content=conteudo, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{nome}"'})


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


# ---- Trocas de plantão ---------------------------------------------------
@router.get("/trocas", dependencies=[Depends(require_permissions("wfm.troca.visualizar"))])
def listar_trocas(operacao: str, estado: str = "", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_trocas(user, operacao, estado)}


@router.get("/trocas/colegas", dependencies=[Depends(require_permissions("wfm.troca.solicitar"))])
def listar_colegas_troca(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_colegas_troca(user, operacao)}


@router.post("/trocas", dependencies=[Depends(require_permissions("wfm.troca.solicitar"))])
def solicitar_troca(payload: TrocaSolicitarRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_solicitar_troca(user, payload.operacao, payload.id_alvo, payload.data_a, payload.data_b, payload.motivo, ip=client_ip(request))


@router.post("/trocas/{id_troca}/responder", dependencies=[Depends(require_permissions("wfm.troca.solicitar"))])
def responder_troca(id_troca: int, payload: TrocaResponderRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_responder_troca(user, id_troca, payload.aceitar, ip=client_ip(request))


@router.post("/trocas/{id_troca}/cancelar", dependencies=[Depends(require_permissions("wfm.troca.solicitar"))])
def cancelar_troca(id_troca: int, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_cancelar_troca(user, id_troca, ip=client_ip(request))


@router.post("/trocas/{id_troca}/decidir", dependencies=[Depends(require_permissions("wfm.troca.aprovar"))])
def decidir_troca(id_troca: int, payload: TrocaDecidirRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_decidir_troca(user, id_troca, payload.aprovar, payload.justificativa, ip=client_ip(request))


@router.post("/trocas/{id_troca}/desfazer", dependencies=[Depends(require_permissions("wfm.troca.desfazer"))])
def desfazer_troca(id_troca: int, payload: TrocaDesfazerRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_desfazer_troca(user, id_troca, payload.justificativa, ip=client_ip(request))


# ---- Turnos: excluir; contrato do operador (leitura) ---------------------
@router.get("/turnos/{id_turno}/personalizacoes", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar"))])
def listar_personalizacoes(id_turno: int, operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_listar_personalizacoes(user, operacao, id_turno)}


@router.put("/turnos/{id_turno}/personalizacoes/{id_operador}", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def salvar_personalizacao(id_turno: int, id_operador: int, payload: PersonalizacaoTurnoRequest, request: Request,
                          user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_salvar_personalizacao(user, {**payload.model_dump(), "id_turno": id_turno, "id_operador": id_operador}, ip=client_ip(request))


@router.delete("/turnos/{id_turno}/personalizacoes/{id_operador}", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def remover_personalizacao(id_turno: int, id_operador: int, operacao: str, request: Request, remover_lancados: bool = False,
                           user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_remover_personalizacao(user, operacao, id_turno, id_operador, remover_lancados=remover_lancados, ip=client_ip(request))


@router.delete("/turnos/{id_turno}", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def excluir_turno(id_turno: int, operacao: str, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_excluir_turno(user, operacao, id_turno, ip=client_ip(request))


@router.get("/operadores/{id_operador}/contrato", dependencies=[Depends(require_permissions("wfm.cadastros.visualizar"))])
def contrato_do_operador(id_operador: int, operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_get_contrato_operador(user, operacao, id_operador)


# ---- Hora extra ----------------------------------------------------------------
@router.get("/horas-extras", dependencies=[Depends(require_permissions(*_LER_ESCALA))])
def listar_horas_extras(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_horas_extras(user, operacao, ano_mes)}


@router.put("/horas-extras", dependencies=[Depends(require_permissions("wfm.presenca.lancar"))])
def lancar_hora_extra(payload: HoraExtraRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_lancar_hora_extra(user, payload.operacao, payload.id_operador, payload.data, payload.minutos, payload.observacao, ip=client_ip(request))


# ---- Presença em lote ------------------------------------------------------
@router.put("/presencas/lote", dependencies=[Depends(require_permissions("wfm.presenca.lancar"))])
def lancar_presenca_lote(payload: PresencaLoteRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_lancar_presenca_lote(user, payload.operacao, payload.data, payload.status, payload.excecoes, ip=client_ip(request))


# ---- Escala de pausas --------------------------------------------------------
@router.get("/pausas", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def pausas_do_dia(operacao: str, data: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_get_pausas_dia(user, operacao, data)


@router.put("/pausas", dependencies=[Depends(require_permissions("wfm.escala.editar"))])
def salvar_pausas(payload: SalvarPausasRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_salvar_pausas(user, payload.operacao, payload.data, [i.model_dump() for i in payload.itens], ip=client_ip(request))


@router.post("/pausas/distribuir", dependencies=[Depends(require_permissions("wfm.escala.editar"))])
def distribuir_pausas(payload: DistribuirPausasRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    if payload.data_fim:
        return repository.wfm_distribuir_pausas_periodo(
            user, payload.operacao, payload.data, payload.data_fim, payload.ids, sobrescrever=payload.sobrescrever,
            dias_semana=payload.dias_semana, ip=client_ip(request),
        )
    return repository.wfm_distribuir_pausas(user, payload.operacao, payload.data, payload.ids, sobrescrever=payload.sobrescrever, ip=client_ip(request))


@router.post("/pausas/replicar", dependencies=[Depends(require_permissions("wfm.escala.editar"))])
def replicar_pausas(payload: ReplicarPausasRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_replicar_pausas(
        user, payload.operacao, payload.data_origem, payload.data_ini, payload.data_fim, payload.ids,
        dias_semana=payload.dias_semana, sobrescrever=payload.sobrescrever, ip=client_ip(request),
    )


@router.put("/pausas/capacidade", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def capacidade_pausas(payload: CapacidadePausasRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_set_capacidade_pausas(user, payload.operacao, payload.pausas_simultaneas, ip=client_ip(request))


# ---- Aprovação da escala (antes da publicação) -----------------------------------
@router.post("/escala/enviar-aprovacao", dependencies=[Depends(require_permissions("wfm.escala.editar"))])
def enviar_aprovacao(payload: FecharRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_enviar_aprovacao(user, payload.operacao, payload.ano_mes, ip=client_ip(request))


@router.post("/escala/aprovar", dependencies=[Depends(require_permissions("wfm.escala.aprovar"))])
def aprovar_escala(payload: FecharRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_aprovar_escala(user, payload.operacao, payload.ano_mes, ip=client_ip(request))


@router.post("/escala/declinar", dependencies=[Depends(require_permissions("wfm.escala.aprovar"))])
def declinar_escala(payload: DeclinarRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_declinar_escala(user, payload.operacao, payload.ano_mes, payload.justificativa, ip=client_ip(request))


@router.post("/escala/cancelar-envio", dependencies=[Depends(require_permissions("wfm.escala.editar", "wfm.escala.aprovar"))])
def cancelar_envio(payload: FecharRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_cancelar_envio(user, payload.operacao, payload.ano_mes, ip=client_ip(request))


# ---- Tipos de escala do setor de TI (Analista de TI) -----------------------------
@router.get("/tipos-escala", dependencies=[Depends(require_permissions("wfm.tipos_escala.editar"))])
def listar_tipos_escala(operacao_base: str = "TI", user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_list_tipos_escala(user, operacao_base)}


@router.post("/tipos-escala", dependencies=[Depends(require_permissions("wfm.tipos_escala.editar"))])
def criar_tipo_escala(payload: TipoEscalaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_tipo_escala(user, payload.model_dump(), ip=client_ip(request))


@router.put("/tipos-escala/{id_tipo}", dependencies=[Depends(require_permissions("wfm.tipos_escala.editar"))])
def atualizar_tipo_escala(id_tipo: int, payload: TipoEscalaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_tipo_escala(user, payload.model_dump(), id_tipo, ip=client_ip(request))


@router.delete("/tipos-escala/{id_tipo}", dependencies=[Depends(require_permissions("wfm.tipos_escala.editar"))])
def excluir_tipo_escala(id_tipo: int, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_excluir_tipo_escala(user, id_tipo, ip=client_ip(request))


# ---- Configuração da escala (nome e aprovadores) e resumo das escalas ----------------
@router.get("/escala/config", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def obter_config_escala(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_get_config_escala(user, operacao)


@router.put("/escala/config", dependencies=[Depends(require_permissions("wfm.cadastros.editar"))])
def salvar_config_escala(payload: ConfigEscalaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_save_config_escala(user, payload.operacao, payload.nome_escala, payload.perfis, payload.usuarios, ip=client_ip(request),
                                                  ativa=payload.ativa, id_contrato=payload.id_contrato, alterar_contrato=payload.alterar_jornada, troca_antecedencia_dias=payload.troca_antecedencia_dias)


@router.get("/escalas/gestao", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def gestao_escalas(ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_gestao_escalas(user, ano_mes)


@router.post("/escalas", dependencies=[Depends(require_permissions("wfm.escala.criar"))])
def criar_escala(payload: CriarEscalaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_criar_escala(user, payload.operacao_base, payload.nome, ip=client_ip(request))


@router.post("/escalas/duplicar", dependencies=[Depends(require_permissions("wfm.escala.criar"))])
def duplicar_escala(payload: DuplicarEscalaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_duplicar_escala(user, payload.operacao, payload.operacao_destino, payload.nome, ip=client_ip(request))


@router.delete("/escalas", dependencies=[Depends(require_permissions("wfm.escala.criar"))])
def excluir_escala(operacao: str, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.wfm_excluir_escala(user, operacao, ip=client_ip(request))


@router.get("/escalas/resumo", dependencies=[Depends(require_permissions("wfm.escala.visualizar"))])
def resumo_escalas(ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.wfm_resumo_escalas(user, ano_mes)}

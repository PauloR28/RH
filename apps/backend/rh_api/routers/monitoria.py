"""Central de Monitoria — rotas (promt.txt, rodada 20/set/2026).

Toda rota passa por permissão de módulo E por escopo de operação/equipe/perfil
(services/monitoria_scope.py). Fluxo, matriz, dashboards e relatórios são
acrescentados nas fases seguintes (C2–C4) neste mesmo router."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response

from ..auth import AuthenticatedUser
from ..dependencies import get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.monitoria import (
    CatalogoRequest,
    ContestacaoRequest,
    EquipeRequest,
    FeedbackRequest,
    MatrizConfigRequest,
    MonitoriaCriarRequest,
    PlanoAcaoRequest,
    PlanoAcaoRevisaoRequest,
    CompartilharRequest,
    ConfigMonitoriaRequest,
    GuiaRequest,
    IdentidadeOperacaoRequest,
    RascunhoRequest,
    ReanaliseRequest,
    RiscoRequest,
    ReplicaRequest,
    TemaRequest,
    TransferirSupervisaoRequest,
    UsuarioMonitoriaRequest,
)

router = APIRouter(prefix="/monitoria", tags=["monitoria"], dependencies=[Depends(get_current_user)])

# Logo por operação: uma tag <img> não envia o Bearer (o token fica em sessionStorage),
# então a rota é pública. O nome do arquivo é um token aleatório, sem enumeração possível.
public_router = APIRouter(prefix="/monitoria", tags=["monitoria-logos-publicas"])


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


# ---------------------------------------------------------------------------
# Contexto / organização
# ---------------------------------------------------------------------------
@router.get("/contexto", dependencies=[Depends(require_permissions("sessao.monitoria.acessar", "monitoria.visualizar"))])
def get_contexto(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_contexto(user)


@router.put("/tema")
def escolher_tema(
    payload: TemaRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_set_tema(user, payload.operacao, ip=client_ip(request))


@router.get("/equipes", dependencies=[Depends(require_permissions("monitoria.equipes", "monitoria.visualizar"))])
def listar_equipes(
    operacao: str = "",
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return {"itens": repository.mon_list_equipes(user, operacao)}


@router.post("/equipes", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def criar_equipe(
    payload: EquipeRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_equipe(user, payload.model_dump(), ip=client_ip(request))


@router.put("/equipes/{id_equipe}", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def atualizar_equipe(
    id_equipe: int,
    payload: EquipeRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_equipe(user, payload.model_dump(), id_equipe, ip=client_ip(request))


@router.get("/catalogo", dependencies=[Depends(require_permissions("sessao.monitoria.acessar", "monitoria.visualizar"))])
def listar_catalogo(
    tipo: str,
    operacao: str = "",
    incluir_inativos: bool = False,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    from ..services.monitoria_scope import pode_ver_operacao

    if operacao and not pode_ver_operacao(user.perfil, user.operacoes, operacao):
        return {"itens": []}
    return {"itens": repository.mon_list_catalogo(tipo, operacao, incluir_inativos=incluir_inativos)}


@router.post("/catalogo", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def criar_item_catalogo(
    payload: CatalogoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_catalogo(user, payload.model_dump(), ip=client_ip(request))


@router.put("/catalogo/{id_item}", dependencies=[Depends(require_permissions("monitoria.equipes"))])
def atualizar_item_catalogo(
    id_item: int,
    payload: CatalogoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_catalogo(user, payload.model_dump(), id_item, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Usuários (hierarquia da Monitoria) e supervisão
# ---------------------------------------------------------------------------
@router.get("/usuarios", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def listar_usuarios(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_list_usuarios(user)}


@router.post("/usuarios", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def criar_usuario(
    payload: UsuarioMonitoriaRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_create_usuario(user, payload.model_dump(), ip=client_ip(request))


@router.put("/usuarios/{id_usuario}", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def atualizar_usuario(
    id_usuario: int,
    payload: UsuarioMonitoriaRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_update_usuario(user, id_usuario, payload.model_dump(exclude_unset=True), ip=client_ip(request))


@router.post("/supervisao/transferir", dependencies=[Depends(require_permissions("monitoria.usuarios"))])
def transferir_supervisao(
    payload: TransferirSupervisaoRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_transferir_supervisao(
        user,
        operacao=payload.operacao,
        id_de=payload.id_de,
        id_para=payload.id_para,
        justificativa=payload.justificativa,
        ip=client_ip(request),
    )


@router.post("/usuarios/{id_usuario}/liberar-design", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def liberar_troca_design(
    id_usuario: int,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_liberar_tema(user, id_usuario, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Matriz de qualidade versionada
# ---------------------------------------------------------------------------
_LER_MATRIZ = require_permissions("monitoria.criar", "monitoria.matriz")


@router.get("/matriz", dependencies=[Depends(_LER_MATRIZ)])
def obter_matriz(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_get_matriz(user, operacao)


@router.get("/matriz/versoes", dependencies=[Depends(_LER_MATRIZ)])
def listar_versoes(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_list_versoes(user, operacao)}


@router.get("/matriz/versoes/{id_versao}", dependencies=[Depends(_LER_MATRIZ)])
def obter_versao(id_versao: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_get_versao(user, id_versao)


@router.put("/matriz", dependencies=[Depends(require_permissions("monitoria.matriz"))])
def salvar_matriz(
    operacao: str,
    payload: MatrizConfigRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_save_versao(user, operacao, payload.config, payload.observacao, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Realização e consulta de monitorias
# ---------------------------------------------------------------------------
@router.get("/operadores", dependencies=[Depends(require_permissions("monitoria.criar"))])
def listar_operadores(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_operadores_elegiveis(user, operacao)}


@router.get("/rascunhos", dependencies=[Depends(require_permissions("monitoria.criar"))])
def listar_rascunhos(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_rascunho_listar(user)}


@router.post("/rascunhos", dependencies=[Depends(require_permissions("monitoria.criar"))])
def criar_rascunho(payload: RascunhoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_rascunho_salvar(user, payload.operacao, payload.payload)


@router.put("/rascunhos/{id_rascunho}", dependencies=[Depends(require_permissions("monitoria.criar"))])
def atualizar_rascunho(
    id_rascunho: int,
    payload: RascunhoRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_rascunho_salvar(user, payload.operacao, payload.payload, id_rascunho)


@router.delete("/rascunhos/{id_rascunho}", dependencies=[Depends(require_permissions("monitoria.criar"))])
def descartar_rascunho(id_rascunho: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_rascunho_descartar(user, id_rascunho)


@router.post("/monitorias", dependencies=[Depends(require_permissions("monitoria.criar"))])
def realizar_monitoria(
    payload: MonitoriaCriarRequest,
    request: Request,
    id_rascunho: int = 0,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    dados = payload.model_dump()
    if id_rascunho:
        dados["id_rascunho"] = id_rascunho
    return repository.mon_criar_monitoria(user, dados, ip=client_ip(request))


@router.get("/monitorias", dependencies=[Depends(require_permissions("monitoria.visualizar"))])
def listar_monitorias(
    codigo: str = "",
    operacao: str = "",
    status: str = "",
    canal: str = "",
    id_operador: int = 0,
    id_avaliador: int = 0,
    id_equipe: int = 0,
    operador: str = "",
    avaliador: str = "",
    data_inicio: str = "",
    data_fim: str = "",
    somente_ncg: bool = False,
    pagina: int = 1,
    por_pagina: int = 25,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    filtros = {
        "codigo": codigo, "operacao": operacao, "status": status, "canal": canal, "id_operador": id_operador,
        "id_avaliador": id_avaliador, "id_equipe": id_equipe, "operador": operador, "avaliador": avaliador,
        "data_inicio": data_inicio, "data_fim": data_fim, "somente_ncg": somente_ncg,
    }
    return repository.mon_listar(user, filtros, pagina=pagina, por_pagina=por_pagina)


@router.get("/monitorias/{ref}", dependencies=[Depends(require_permissions("monitoria.visualizar"))])
def detalhe_monitoria(
    ref: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_detalhe(user, ref, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Fluxo: feedback, confirmação, contestação, réplica, reanálise, evidências
# ---------------------------------------------------------------------------
@router.post("/monitorias/{ref}/feedback", dependencies=[Depends(require_permissions("monitoria.feedback_aplicar"))])
def aplicar_feedback(
    ref: str, payload: FeedbackRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_aplicar_feedback(user, ref, payload.model_dump(), ip=client_ip(request))


@router.post("/monitorias/{ref}/confirmar", dependencies=[Depends(require_permissions("monitoria.contestar"))])
def confirmar_monitoria(
    ref: str, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_confirmar(user, ref, ip=client_ip(request))


@router.post("/monitorias/{ref}/contestar", dependencies=[Depends(require_permissions("monitoria.contestar"))])
def contestar_monitoria(
    ref: str, payload: ContestacaoRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_contestar(user, ref, payload.model_dump(), ip=client_ip(request))


@router.post("/monitorias/{ref}/replica", dependencies=[Depends(require_permissions("monitoria.contestar"))])
def replicar_contestacao(
    ref: str, payload: ReplicaRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_replicar(user, ref, payload.texto, ip=client_ip(request))


@router.post("/monitorias/{ref}/anexos", dependencies=[Depends(require_permissions("monitoria.contestar"))])
async def anexar_evidencia(
    ref: str, request: Request, arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    conteudo = await arquivo.read(11 * 1024 * 1024)
    return repository.mon_anexar_evidencia(user, ref, nome=arquivo.filename or "evidencia", conteudo=conteudo, ip=client_ip(request))


@router.get("/anexos/{id_anexo}", dependencies=[Depends(require_permissions("monitoria.visualizar"))])
def baixar_evidencia(id_anexo: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    caminho, nome, mime = repository.mon_obter_anexo(user, id_anexo)
    return FileResponse(caminho, media_type=mime, filename=nome)


@router.post("/monitorias/{ref}/reanalise", dependencies=[Depends(require_permissions("monitoria.reanalisar"))])
def reanalisar_contestacao(
    ref: str, payload: ReanaliseRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_reanalisar(user, ref, payload.model_dump(), ip=client_ip(request))


@router.post("/sla/processar", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def processar_slas(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    """Disparo manual/externo do job de SLA (o APScheduler já o executa a cada 5 min)."""
    return repository.mon_processar_slas()


# ---------------------------------------------------------------------------
# Planos de ação
# ---------------------------------------------------------------------------
@router.get("/planos", dependencies=[Depends(require_permissions("monitoria.plano_acao_visualizar", "monitoria.plano_acao"))])
def listar_planos(
    operacao: str = "", status: str = "", id_operador: int = 0, id_responsavel: int = 0, criterio: str = "",
    data_inicio: str = "", data_fim: str = "", vencidos: bool = False, pagina: int = 1, por_pagina: int = 25,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    filtros = {"operacao": operacao, "status": status, "id_operador": id_operador, "id_responsavel": id_responsavel,
               "criterio": criterio, "data_inicio": data_inicio, "data_fim": data_fim, "vencidos": vencidos}
    return repository.mon_plano_listar(user, filtros, pagina=pagina, por_pagina=por_pagina)


@router.get("/planos/{id_plano}", dependencies=[Depends(require_permissions("monitoria.plano_acao_visualizar", "monitoria.plano_acao"))])
def detalhe_plano(id_plano: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_plano_detalhe(user, id_plano)


@router.post("/planos", dependencies=[Depends(require_permissions("monitoria.plano_acao"))])
def criar_plano(payload: PlanoAcaoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_plano_criar(user, payload.model_dump(), ip=client_ip(request))


@router.put("/planos/{id_plano}", dependencies=[Depends(require_permissions("monitoria.plano_acao"))])
def revisar_plano(id_plano: int, payload: PlanoAcaoRevisaoRequest, request: Request,
                  user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_plano_revisar(user, id_plano, payload.model_dump(), ip=client_ip(request))


# ---------------------------------------------------------------------------
# Dashboard, relatórios, exportação e compartilhamento
# ---------------------------------------------------------------------------
def _filtros(operacao, id_equipe, id_operador, id_avaliador, data_inicio, data_fim):
    return {"operacao": operacao, "id_equipe": id_equipe, "id_operador": id_operador, "id_avaliador": id_avaliador,
            "data_inicio": data_inicio, "data_fim": data_fim}


@router.get("/dashboard", dependencies=[Depends(require_permissions("monitoria.dashboard"))])
def dashboard(
    modo: str = "geral", top: int = 5, granularidade: str = "mes", operacao: str = "", id_equipe: int = 0, id_operador: int = 0,
    id_avaliador: int = 0, data_inicio: str = "", data_fim: str = "",
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_dashboard(user, _filtros(operacao, id_equipe, id_operador, id_avaliador, data_inicio, data_fim),
                                    modo=modo, top=top, granularidade=granularidade)


@router.get("/relatorios/{tipo}", dependencies=[Depends(require_permissions("monitoria.relatorios"))])
def relatorio(
    tipo: str, operacao: str = "", id_equipe: int = 0, id_operador: int = 0, id_avaliador: int = 0, data_inicio: str = "",
    data_fim: str = "", status: str = "", user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    filtros = _filtros(operacao, id_equipe, id_operador, id_avaliador, data_inicio, data_fim)
    filtros["status"] = status
    return repository.mon_relatorio(user, tipo, filtros)


@router.get("/relatorios/{tipo}/exportar", dependencies=[Depends(require_permissions("monitoria.exportar"))])
def exportar_relatorio(
    tipo: str, request: Request, formato: str = "xlsx", operacao: str = "", id_equipe: int = 0, id_operador: int = 0,
    id_avaliador: int = 0, data_inicio: str = "", data_fim: str = "", status: str = "",
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    filtros = _filtros(operacao, id_equipe, id_operador, id_avaliador, data_inicio, data_fim)
    filtros["status"] = status
    conteudo, nome, mime = repository.mon_exportar(user, tipo, formato, filtros, ip=client_ip(request))
    return Response(content=conteudo, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@router.post("/exportar/monitorias", dependencies=[Depends(require_permissions("monitoria.exportar"))])
def exportar_monitorias(
    payload: CompartilharRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    conteudo, nome, mime = repository.mon_exportar_monitorias(user, payload.ids, ip=client_ip(request))
    return Response(content=conteudo, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@router.post("/compartilhar", dependencies=[Depends(require_permissions("monitoria.exportar"))])
def compartilhar(
    payload: CompartilharRequest, request: Request,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    return repository.mon_compartilhar(user, payload.ids, payload.destinatarios, payload.mensagem, ip=client_ip(request))


# ---------------------------------------------------------------------------
# Logs, guia, configurações, zona de risco e identidade por operação
# ---------------------------------------------------------------------------
@router.get("/logs", dependencies=[Depends(require_permissions("monitoria.logs"))])
def listar_logs(
    usuario: str = "", acao: str = "", entidade: str = "", operacao: str = "", resultado: str = "", perfil: str = "",
    data_inicio: str = "", data_fim: str = "", pagina: int = 1, por_pagina: int = 50,
    user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository),
):
    filtros = {"usuario": usuario, "acao": acao, "entidade": entidade, "operacao": operacao, "resultado": resultado,
               "perfil": perfil, "data_inicio": data_inicio, "data_fim": data_fim}
    return repository.mon_logs(user, filtros, pagina=pagina, por_pagina=por_pagina)


@router.get("/guia", dependencies=[Depends(require_permissions("sessao.monitoria.acessar", "monitoria.visualizar"))])
def listar_guia(todos: bool = False, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_guia_listar(incluir_inativos=bool(todos and user.has_permission("monitoria.configurar")))}


@router.post("/guia", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def criar_guia(payload: GuiaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
               repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_guia_salvar(user, payload.model_dump(), ip=client_ip(request))


@router.put("/guia/{id_guia}", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def atualizar_guia(id_guia: int, payload: GuiaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                   repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_guia_salvar(user, payload.model_dump(), id_guia, ip=client_ip(request))


@router.get("/config", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def obter_config(repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_config_obter()


@router.put("/config", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def salvar_config(payload: ConfigMonitoriaRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                  repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_config_salvar(user, payload.model_dump(), ip=client_ip(request))


@router.post("/risco/{acao}", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def zona_de_risco(acao: str, payload: RiscoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user),
                  repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_risco_executar(user, acao, payload.operacao, payload.confirmacao, payload.justificativa, ip=client_ip(request))


@router.get("/identidade", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def listar_identidade(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.mon_identidade_listar(user)}


@router.put("/identidade/{operacao}", dependencies=[Depends(require_permissions("monitoria.configurar"))])
def salvar_identidade(operacao: str, payload: IdentidadeOperacaoRequest, request: Request,
                      user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.mon_identidade_salvar(user, operacao, payload.cor_primaria, ip=client_ip(request))


@router.post("/identidade/{operacao}/logo", dependencies=[Depends(require_permissions("monitoria.configurar"))])
async def salvar_logo(operacao: str, request: Request, arquivo: UploadFile = File(...),
                      user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    conteudo = await arquivo.read(2 * 1024 * 1024)
    return repository.mon_logo_salvar(user, operacao, nome=arquivo.filename or "logo.png", conteudo=conteudo, ip=client_ip(request))


@public_router.get("/logos/{arquivo}")
def baixar_logo(arquivo: str, repository: DatabaseRepository = Depends(get_repository)):
    if not re.match(r"^[a-z0-9]{4,20}\.(png|jpg|jpeg)$", arquivo):
        raise HTTPException(status_code=404, detail="Logo não encontrada.")
    caminho, mime = repository.mon_logo_arquivo(arquivo)
    return FileResponse(caminho, media_type=mime)

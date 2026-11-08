"""Diário de bordo (08/nov/2026) — rotas. Regras em repositories/diario.py e services/diario_regras.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.diario import (
    DiarioAbsRequest,
    DiarioCadastroRequest,
    DiarioEditarRequest,
    DiarioEncerramentoRequest,
    DiarioEnvioRequest,
    DiarioExportarRequest,
    DiarioImportarRequest,
    DiarioIntercorrenciaRequest,
    DiarioMotivoRequest,
    DiarioParcialRequest,
    DiarioTurnoSalvarRequest,
    DiarioVersaoRequest,
)
from ..services import diario_regras as regras
from ..services import relatorio_exportacao as exportacao

router = APIRouter(prefix="/diario", tags=["diario"], dependencies=[Depends(get_current_user)])

_VER = "diario.visualizar"
_LER = ("diario.visualizar", "diario.intercorrencias")
_PREENCHER = "diario.preencher"
_REABRIR = "diario.reabrir"
_EXPORTAR = "diario.exportar"
_ADMIN = "diario.administrar"


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


@router.get("/contexto", dependencies=[Depends(require_permissions(*_LER))])
def contexto(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_contexto(user)


@router.post("/termos/aceite", dependencies=[Depends(require_permissions(*_LER))])
def aceitar_termos(request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_aceitar_termos(user, _ip(request))


@router.get("/dia", dependencies=[Depends(require_permissions(*_LER))])
def dia(operacao: str, data: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_dia(user, operacao, data)


@router.get("/resumo-hoje", dependencies=[Depends(require_permissions(_VER))])
def resumo_hoje(user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.diario_resumo_hoje(user)}


# ------------------------------------------------------------------ turno
@router.post("/turnos/{id_turno}/editar", dependencies=[Depends(require_permissions(_PREENCHER))])
def editar_turno(id_turno: int, payload: DiarioEditarRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_marcar_edicao(user, id_turno, payload.forcar)


@router.put("/turnos/{id_turno}", dependencies=[Depends(require_permissions(_PREENCHER))])
def salvar_turno(id_turno: int, payload: DiarioTurnoSalvarRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_turno(
        user, id_turno, payload.versao, [d.model_dump() for d in payload.demandas], [n.model_dump() for n in payload.ns], payload.observacoes
    )


@router.post("/turnos/{id_turno}/concluir", dependencies=[Depends(require_permissions(_PREENCHER))])
def concluir_turno(id_turno: int, payload: DiarioVersaoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_concluir_turno(user, id_turno, payload.versao)


@router.post("/turnos/{id_turno}/reabrir", dependencies=[Depends(require_permissions(_REABRIR))])
def reabrir_turno(id_turno: int, payload: DiarioMotivoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    saida = repository.diario_reabrir_turno(user, id_turno, payload.motivo)
    audit_action(repository, user, modulo="Diário de bordo", acao="reabrir_turno", entidade="diario_turno", entidade_id=str(id_turno), justificativa=payload.motivo, request=request)
    return saida


# ------------------------------------------------------------------ dia
@router.put("/dias/{id_dia}/encerramento", dependencies=[Depends(require_permissions(_PREENCHER))])
def salvar_encerramento(id_dia: int, payload: DiarioEncerramentoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_encerramento(user, id_dia, payload.versao, payload.encerramento_tipo, payload.passagem, encerrar=False)


@router.post("/dias/{id_dia}/encerrar", dependencies=[Depends(require_permissions(_PREENCHER))])
def encerrar_dia(id_dia: int, payload: DiarioEncerramentoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_encerramento(user, id_dia, payload.versao, payload.encerramento_tipo, payload.passagem, encerrar=True)


@router.post("/dias/{id_dia}/reabrir", dependencies=[Depends(require_permissions(_REABRIR))])
def reabrir_dia(id_dia: int, payload: DiarioMotivoRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    saida = repository.diario_reabrir_dia(user, id_dia, payload.motivo)
    audit_action(repository, user, modulo="Diário de bordo", acao="reabrir_dia", entidade="diario_dia", entidade_id=str(id_dia), justificativa=payload.motivo, request=request)
    return saida


@router.post("/dias/{id_dia}/abs", dependencies=[Depends(require_permissions(_PREENCHER))])
def corrigir_abs(id_dia: int, payload: DiarioAbsRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    valores = {c: getattr(payload, c) for c in regras.CAMPOS_ABS}
    return repository.diario_corrigir_abs(user, id_dia, valores, payload.motivo)


@router.post("/dias/{id_dia}/parciais", dependencies=[Depends(require_permissions(_PREENCHER))])
def criar_parcial(id_dia: int, payload: DiarioParcialRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_parcial(user, id_dia, None, payload.hora, payload.valores)


@router.put("/dias/{id_dia}/parciais/{id_parcial}", dependencies=[Depends(require_permissions(_PREENCHER))])
def editar_parcial(id_dia: int, id_parcial: int, payload: DiarioParcialRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_parcial(user, id_dia, id_parcial, payload.hora, payload.valores)


@router.delete("/dias/{id_dia}/parciais/{id_parcial}", dependencies=[Depends(require_permissions(_PREENCHER))])
def excluir_parcial(id_dia: int, id_parcial: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_excluir_parcial(user, id_dia, id_parcial)


@router.post("/dias/{id_dia}/envio", dependencies=[Depends(require_permissions(_VER))])
def registrar_envio(id_dia: int, payload: DiarioEnvioRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_registrar_envio(user, id_dia, payload.passo)


@router.get("/dias/{id_dia}/alteracoes", dependencies=[Depends(require_permissions(_VER))])
def alteracoes(id_dia: int, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.diario_alteracoes(user, id_dia)}


@router.get("/dias/{id_dia}/alteracoes/exportar", dependencies=[Depends(require_permissions(_EXPORTAR))])
def exportar_alteracoes(id_dia: int, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    itens = repository.diario_alteracoes(user, id_dia)
    colunas = ["Quando", "Quem", "Turno", "O quê", "Ação", "Campo", "Antes", "Depois", "Motivo"]
    linhas = [[i["criado_em"].replace("T", " "), i.get("usuario_nome"), regras.ROTULO_TURNO.get(i.get("turno") or "", ""), i["entidade"], i["acao"],
               i.get("campo"), i.get("antes"), i.get("depois"), i.get("motivo")] for i in itens]
    repository.diario_registrar_exportacao(user, "", id_dia, f"Alterações do dia ({len(linhas)} linhas)")
    audit_action(repository, user, modulo="Diário de bordo", acao="exportar_alteracoes", entidade="diario_dia", entidade_id=str(id_dia), request=request)
    return Response(content=exportacao.gerar_xlsx("Diário de bordo · alterações do dia", [], colunas, linhas), media_type=exportacao.MIME["xlsx"],
                    headers={"Content-Disposition": f'attachment; filename="{exportacao.nome_arquivo("diario-alteracoes", "xlsx")}"',
                             "Access-Control-Expose-Headers": "Content-Disposition"})


# ------------------------------------------------------------------ intercorrências
@router.post("/intercorrencias", dependencies=[Depends(require_permissions(_PREENCHER))])
def criar_intercorrencia(payload: DiarioIntercorrenciaRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_criar_intercorrencia(user, payload.operacao, payload.model_dump())


@router.put("/intercorrencias/{id_interc}", dependencies=[Depends(require_permissions(_PREENCHER))])
def editar_intercorrencia(id_interc: int, payload: DiarioIntercorrenciaRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    if payload.versao is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Versão da intercorrência ausente.")
    return repository.diario_editar_intercorrencia(user, id_interc, payload.versao, payload.model_dump())


@router.post("/intercorrencias/{id_interc}/excluir", dependencies=[Depends(require_permissions(_PREENCHER))])
def excluir_intercorrencia(id_interc: int, payload: DiarioMotivoRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_excluir_intercorrencia(user, id_interc, payload.motivo)


@router.get("/intercorrencias/no-horario", dependencies=[Depends(require_permissions(*_LER, "monitoria.criar", "monitoria.reanalisar"))])
def intercorrencias_no_horario(operacao: str, momento: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.diario_intercorrencias_no_horario(user, operacao, momento)}


# ------------------------------------------------------------------ histórico e exportação
@router.get("/historico", dependencies=[Depends(require_permissions(_VER))])
def historico(operacao: str, ano_mes: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.diario_historico(user, operacao, ano_mes)}


@router.post("/historico/exportar", dependencies=[Depends(require_permissions(_EXPORTAR))])
def exportar_historico(payload: DiarioExportarRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    formato = payload.formato.lower()
    if formato not in ("xlsx", "csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato inválido. Use xlsx ou csv.")
    itens = repository.diario_historico(user, payload.operacao, payload.ano_mes)
    canais = sorted({c for i in itens for c in i["ns"]})
    rot_estado = {"concluido": "concluído", "rascunho": "rascunho", "reaberto": "reaberto", "vazio": "não feito"}
    colunas = ["Dia", "Abertura", "Intermediário", "Fechamento", "Tratadas", "Pendentes", *[f"NS {c}" for c in canais], "ABS %", "ABS de", "Intercorrências",
               "Encerramento", "Envio ao grupo", "Quem registrou", "Importado"]
    linhas = [[i["data"], *[rot_estado.get(t, t) for t in i["turnos"]], i["tratadas"], i["pendentes"], *[i["ns"].get(c) for c in canais], i["abs"],
               "correção" if i["abs_origem"] == "correcao" else "Presença", i["intercorrencias"], regras.ROTULO_ENCERRAMENTO.get(i["encerramento_tipo"] or "", ""),
               {"enviado": "Enviado", "copiado": "Copiado", "baixado": "Baixado"}.get(i["envio"], "Não marcado"), ", ".join(i["autores"]), "sim" if i["importado"] else ""]
              for i in itens]
    filtros = [("Operação", payload.operacao), ("Mês", payload.ano_mes)]
    conteudo = exportacao.gerar_csv(colunas, linhas) if formato == "csv" else exportacao.gerar_xlsx("Diário de bordo · histórico", filtros, colunas, linhas)
    repository.diario_registrar_exportacao(user, payload.operacao, None, f"Histórico {payload.ano_mes} ({formato}, {len(linhas)} dias)")
    audit_action(repository, user, modulo="Diário de bordo", acao="exportar_historico", entidade="diario_dia",
                 valor_novo={"operacao": payload.operacao, "ano_mes": payload.ano_mes, "formato": formato, "linhas": len(linhas)}, request=request)
    return Response(content=conteudo, media_type=exportacao.MIME[formato],
                    headers={"Content-Disposition": f'attachment; filename="{exportacao.nome_arquivo("diario-de-bordo-" + payload.ano_mes, formato)}"',
                             "Access-Control-Expose-Headers": "Content-Disposition"})


# ------------------------------------------------------------------ cadastros e importação (Administração)
@router.get("/cadastros", dependencies=[Depends(require_permissions(_ADMIN))])
def listar_cadastros(operacao: str, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return {"itens": repository.diario_cadastros(user, operacao)}


@router.post("/cadastros", dependencies=[Depends(require_permissions(_ADMIN))])
def criar_cadastro(payload: DiarioCadastroRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_cadastro(user, payload.operacao, None, payload.tipo, payload.nome, payload.ativo, payload.ordem)


@router.put("/cadastros/{id_item}", dependencies=[Depends(require_permissions(_ADMIN))])
def editar_cadastro(id_item: int, payload: DiarioCadastroRequest, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    return repository.diario_salvar_cadastro(user, payload.operacao, id_item, payload.tipo, payload.nome, payload.ativo, payload.ordem)


@router.post("/importar", dependencies=[Depends(require_permissions(_ADMIN))])
def importar(payload: DiarioImportarRequest, request: Request, user: AuthenticatedUser = Depends(get_current_user), repository: DatabaseRepository = Depends(get_repository)):
    if not payload.arquivos:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escolha ao menos um arquivo .json do diário antigo.")
    saida = repository.diario_importar(user, payload.operacao, payload.arquivos, payload.gravar)
    if payload.gravar:
        audit_action(repository, user, modulo="Diário de bordo", acao="importar_registros_antigos", entidade="diario_dia",
                     valor_novo={"operacao": payload.operacao, "gravados": saida.get("gravados"), "ignorados": saida.get("ignorados")}, request=request)
    return saida

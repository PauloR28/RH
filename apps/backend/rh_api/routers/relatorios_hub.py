"""Relatórios e Históricos — exportação unificada (XLSX, CSV e PDF).

Os dados de cada relatório continuam saindo das rotas de origem (WFM, Monitoria, RH, Logs), que aplicam escopo e permissão.
Aqui o servidor só formata o arquivo e confere duas coisas: o relatório está ligado ao perfil (`relhub.*`) e o perfil pode
EXPORTAR a área (permissão de exportação da origem). Fica registrado na auditoria."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..rbac import ACCESS_DENIED_MESSAGE, RELHUB_PERMISSAO_BASE
from ..repositories import DatabaseRepository
from ..services import relatorio_exportacao as exportacao

router = APIRouter(prefix="/relatorios-hub", tags=["relatorios-hub"], dependencies=[Depends(get_current_user)])

# Permissão de EXPORTAÇÃO por relatório (a de visualização é a de base, em rbac.RELATORIOS_HUB).
_EXPORTAR = {
    "relhub.wfm.painel": "wfm.relatorios",
    "relhub.wfm.resumo": "wfm.relatorios",
    "relhub.wfm.escalas": "wfm.relatorios",
    "relhub.wfm.presencas": "wfm.relatorios",
    "relhub.wfm.trocas": "wfm.relatorios",
    "relhub.wfm.aprovacoes": "wfm.relatorios",
    "relhub.wfm.historico": "wfm.auditoria",
    "relhub.monitoria.historico": "monitoria.exportar",
    "relhub.monitoria.qualidade": "monitoria.exportar",
    "relhub.monitoria.planos": "monitoria.exportar",
    "relhub.monitoria.dashboard": "monitoria.exportar",
    "relhub.monitoria.logs": "monitoria.logs",
    "relhub.rh.processos": "relatorios.exportar",
    "relhub.rh.candidatos": "relatorios.exportar",
    "relhub.rh.ranking": "relatorios.exportar",
    "relhub.rh.funil": "relatorios.exportar",
    "relhub.rh.exames": "candidatos.consultar_historico",
    "relhub.sistema.logs": "logs.exportar",
}


class ExportarRelatorioRequest(BaseModel):
    relatorio: str = Field(min_length=3, max_length=80)
    formato: str = Field(default="xlsx", max_length=8)
    titulo: str = Field(default="", max_length=120)
    filtros: list[list[str]] = Field(default_factory=list, max_length=20)
    colunas: list[str] = Field(min_length=1, max_length=60)
    linhas: list[list[Any]] = Field(default_factory=list)


# Porta de entrada: precisa de ao menos um relatório ligado; a conferência por relatório (visualizar + exportar) é feita abaixo.
@router.post("/exportar", dependencies=[Depends(require_permissions("sessao.relatorios.acessar"))])
def exportar(
    payload: ExportarRelatorioRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    chave = payload.relatorio if payload.relatorio.startswith("relhub.") else f"relhub.{payload.relatorio}"
    formato = payload.formato.lower()
    if chave not in RELHUB_PERMISSAO_BASE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relatório desconhecido.")
    if formato not in exportacao.FORMATOS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Formato inválido. Use xlsx, csv ou pdf.")
    if not (user.has_permission(chave) and user.has_permission(RELHUB_PERMISSAO_BASE[chave]) and user.has_permission(_EXPORTAR[chave])):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCESS_DENIED_MESSAGE)
    limite = exportacao.LIMITE_LINHAS_PDF if formato == "pdf" else exportacao.LIMITE_LINHAS
    if len(payload.linhas) > limite:
        raise HTTPException(
            status_code=413,
            detail=f"A exportação em {formato.upper()} aceita até {limite:,} linhas; o relatório tem {len(payload.linhas):,}. Reduza o período.".replace(",", "."),
        )
    filtros = [(str(f[0]), str(f[1])) for f in payload.filtros if len(f) >= 2]
    titulo = payload.titulo.strip() or "Relatório"
    if formato == "csv":
        conteudo = exportacao.gerar_csv(payload.colunas, payload.linhas)
    elif formato == "xlsx":
        conteudo = exportacao.gerar_xlsx(titulo, filtros, payload.colunas, payload.linhas)
    else:
        conteudo = exportacao.gerar_pdf(titulo, filtros, payload.colunas, payload.linhas)
    audit_action(
        repository, user, modulo="Relatórios e Históricos", acao="exportar_relatorio", entidade=chave,
        valor_novo={"formato": formato, "linhas": len(payload.linhas)}, request=request,
    )
    nome = exportacao.nome_arquivo(chave.removeprefix("relhub."), formato)
    return Response(
        content=conteudo,
        media_type=exportacao.MIME[formato],
        headers={"Content-Disposition": f'attachment; filename="{nome}"', "Access-Control-Expose-Headers": "Content-Disposition"},
    )

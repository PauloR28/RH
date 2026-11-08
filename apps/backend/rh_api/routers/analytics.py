from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository

router = APIRouter(tags=["analytics"], dependencies=[Depends(get_current_user)])


@router.get("/candidate-analytics", dependencies=[Depends(require_permissions("relatorios.visualizar"))])
def get_candidate_analytics(repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_candidate_analytics()


@router.get("/candidate-analytics/{id_teste}", dependencies=[Depends(require_permissions("relatorios.visualizar"))])
def get_candidate_analytics_detail(
    id_teste: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_candidate_analytics_detail(id_teste)


@router.get("/reports/processes", dependencies=[Depends(require_permissions("relatorios.visualizar"))])
def get_process_report(
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_process_report(start_date=start_date, end_date=end_date)


@router.get("/reports/processes/export", dependencies=[Depends(require_permissions("relatorios.exportar"))])
def export_process_report(
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    filename, content = repository.export_process_report_csv(
        start_date=start_date,
        end_date=end_date,
    )
    audit_action(
        repository,
        user,
        modulo="Relatórios",
        acao="exportar_relatorio_processos",
        entidade="relatorio",
        entidade_id="processos",
        valor_novo={"start_date": start_date, "end_date": end_date},
    )
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/reports/candidates", dependencies=[Depends(require_permissions("relatorios.visualizar"))])
def get_candidate_report(
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    status_filter: str = Query(default=""),
    id_processo: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_candidate_report(
        start_date=start_date,
        end_date=end_date,
        status_filter=status_filter,
        id_processo=id_processo,
    )


@router.get("/reports/funnel-dashboard", dependencies=[Depends(require_permissions("relatorios.visualizar"))])
def get_funnel_dashboard(
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    id_processo: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_funnel_dashboard(
        start_date=start_date,
        end_date=end_date,
        id_processo=id_processo,
    )


@router.get("/reports/candidates/export", dependencies=[Depends(require_permissions("relatorios.exportar"))])
def export_candidate_report(
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    status_filter: str = Query(default=""),
    id_processo: str = Query(default=""),
    revelar_pii: bool = Query(default=False, description="Exporta telefone/e-mail completos em vez de mascarados. Fica registrado na auditoria."),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    filename, content = repository.export_candidate_report_csv(
        start_date=start_date,
        end_date=end_date,
        status_filter=status_filter,
        id_processo=id_processo,
        mask_pii=not revelar_pii,
    )
    audit_action(
        repository,
        user,
        modulo="Relatórios",
        acao="exportar_relatorio_candidatos_pii_completo" if revelar_pii else "exportar_relatorio_candidatos",
        entidade="relatorio",
        entidade_id="candidatos",
        valor_novo={
            "start_date": start_date,
            "end_date": end_date,
            "status_filter": status_filter,
            "id_processo": id_processo,
            "pii_revelado": revelar_pii,
        },
    )
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

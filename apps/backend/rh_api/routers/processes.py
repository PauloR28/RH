from __future__ import annotations

from fastapi import APIRouter, Body, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, ensure_user_permission, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.processes import (
    CandidateProfileUpdateRequest,
    CandidateReconsiderRequest,
    CandidateSheetUpdateRequest,
    CvPreAnalysisUpdateRequest,
    ProcessDossierNoteCreateRequest,
    ProcessDossierNoteUpdateRequest,
    ProcessCandidateCreateRequest,
    ProcessCandidateStatusUpdateRequest,
    ProcessCreateRequest,
    ProcessStateChangeRequest,
    ProcessUpdateRequest,
    StandaloneCandidateStatusUpdateRequest,
    TalentBankCreateRequest,
    TalentBankUseRequest,
    WhatsAppManualContactRequest,
)


router = APIRouter(tags=["processes"], dependencies=[Depends(get_current_user)])


@router.get("/processes", dependencies=[Depends(require_permissions("vagas.visualizar"))])
def get_processes(
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=100),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_processes(page=page, page_size=page_size)


@router.post("/processes", dependencies=[Depends(require_permissions("vagas.criar", "processos.criar"))])
def create_process(
    payload: ProcessCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_process(payload.model_dump(), marcado_por=user.username)
    audit_action(
        repository,
        user,
        modulo="Vagas",
        acao="criar_processo",
        entidade="processo",
        entidade_id=str(result.get("id_processo") or getattr(payload, "id_processo", "") or ""),
        valor_novo=payload.model_dump(),
    )
    if payload.urgente:
        audit_action(
            repository,
            user,
            modulo="Vagas",
            acao="marcar_vaga_urgente",
            entidade="processo",
            entidade_id=str(result.get("id_processo") or ""),
            valor_novo={"urgente": True, "origem": "criacao_da_vaga"},
        )
    return result


@router.put("/processes/{id_processo}", dependencies=[Depends(require_permissions("vagas.editar", "vagas.editar_limitado", "processos.editar"))])
def update_process(
    id_processo: str,
    payload: ProcessUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_process(id_processo, payload.model_dump(), marcado_por=user.username, user=user)
    audit_action(
        repository,
        user,
        modulo="Vagas",
        acao="editar_processo",
        entidade="processo",
        entidade_id=id_processo,
        valor_novo=payload.model_dump(),
    )
    if result.get("urgente_alterado"):
        audit_action(
            repository,
            user,
            modulo="Vagas",
            acao="marcar_vaga_urgente" if result.get("urgente") else "desmarcar_vaga_urgente",
            entidade="processo",
            entidade_id=id_processo,
            valor_novo={"urgente": bool(result.get("urgente")), "origem": "edicao_da_vaga"},
        )
    return result


@router.post("/processes/{id_processo}/close", dependencies=[Depends(require_permissions("vagas.encerrar"))])
def close_process(
    id_processo: str,
    payload: ProcessStateChangeRequest | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.close_process(
        id_processo,
        justificativa=payload.justificativa if payload else "",
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Vagas",
        acao="encerrar_processo",
        entidade="processo",
        entidade_id=id_processo,
        justificativa=payload.justificativa if payload else "",
    )
    return result


@router.post("/processes/{id_processo}/pause", dependencies=[Depends(require_permissions("vagas.editar", "processos.editar"))])
def pause_process(
    id_processo: str,
    payload: ProcessStateChangeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.change_process_status(
        id_processo,
        novo_status="Pausado",
        justificativa=payload.justificativa,
        usuario_responsavel=user.username,
        tempo_pausa=payload.tempo_pausa,
        pausa_previsao_termino=payload.pausa_previsao_termino,
    )
    audit_action(
        repository,
        user,
        modulo="Processos",
        acao="pausar_processo",
        entidade="processo",
        entidade_id=id_processo,
        valor_anterior={"status": result.get("status_anterior")},
        valor_novo={
            "status": result.get("status_novo"),
            "tempo_pausa": payload.tempo_pausa,
            "pausa_previsao_termino": payload.pausa_previsao_termino,
        },
        justificativa=payload.justificativa,
    )
    return result


@router.post("/processes/{id_processo}/resume", dependencies=[Depends(require_permissions("vagas.editar", "processos.editar"))])
def resume_process(
    id_processo: str,
    payload: ProcessStateChangeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.change_process_status(
        id_processo,
        novo_status="Aberto",
        justificativa=payload.justificativa,
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Processos",
        acao="retomar_processo",
        entidade="processo",
        entidade_id=id_processo,
        valor_anterior={"status": result.get("status_anterior")},
        valor_novo={"status": result.get("status_novo")},
        justificativa=payload.justificativa,
    )
    return result


@router.post("/processes/{id_processo}/cancel", dependencies=[Depends(require_permissions("vagas.encerrar"))])
def cancel_process(
    id_processo: str,
    payload: ProcessStateChangeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.change_process_status(
        id_processo,
        novo_status="Cancelado",
        justificativa=payload.justificativa,
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Processos",
        acao="cancelar_processo",
        entidade="processo",
        entidade_id=id_processo,
        valor_anterior={"status": result.get("status_anterior")},
        valor_novo={"status": result.get("status_novo")},
        justificativa=payload.justificativa,
    )
    return result


@router.post("/processes/inactivity-alerts/run", dependencies=[Depends(require_permissions("notificacoes.configurar"))])
def run_process_inactivity_alerts(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.monitor_process_inactivity(dias=30)
    audit_action(
        repository,
        user,
        modulo="Notificações",
        acao="monitorar_processos_sem_movimentacao",
        entidade="processos",
        valor_novo=result,
    )
    return result


@router.get("/process-candidates", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def get_process_candidates(
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=100),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_process_candidates(page=page, page_size=page_size)


@router.post("/process-candidates", dependencies=[Depends(require_permissions("candidatos.criar"))])
def create_process_candidate(
    payload: ProcessCandidateCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_process_candidate(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="criar_candidato",
        entidade="candidato_processo",
        entidade_id=str(result.get("id_registro") or getattr(payload, "id_registro", "") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/process-candidates/{id_registro}/status")
def update_process_candidate_status(
    id_registro: int,
    payload: ProcessCandidateStatusUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    status_candidato = (payload.status_candidato or "").strip().lower()
    if status_candidato == "aprovado":
        ensure_user_permission(user, "candidatos.aprovar_final", repository=repository)
    elif status_candidato in {"eliminado", "reprovado", "desistente"}:
        ensure_user_permission(user, "candidatos.eliminar", repository=repository)
    else:
        ensure_user_permission(user, "candidatos.mover_etapa", repository=repository)

    result = repository.update_process_candidate_status(id_registro, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="atualizar_status_candidato",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post(
    "/process-candidates/{id_registro}/reconsider",
    dependencies=[Depends(require_permissions("candidatos.reverter_eliminacao"))],
)
def reconsider_process_candidate(
    id_registro: int,
    payload: CandidateReconsiderRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.reconsider_candidate_elimination(
        id_registro,
        payload.justificativa,
        actor=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="reconsiderar_eliminacao",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post("/process-candidates/{id_registro}/approval-whatsapp", dependencies=[Depends(require_permissions("emails.enviar_modelo", "candidatos.aprovar_final", require_all=True))])
def record_approval_whatsapp(
    id_registro: int,
    payload: dict | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.record_candidate_approval_whatsapp(
        id_registro,
        payload or {},
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="registrar_whatsapp_aprovacao",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload or {},
    )
    return result


@router.post(
    "/process-candidates/{id_registro}/whatsapp-contact",
    dependencies=[
        Depends(
            require_permissions(
                "candidatos.editar",
                "candidatos.editar_basico",
                "entrevistas.criar",
                "emails.enviar_modelo",
            )
        )
    ],
)
def record_whatsapp_contact(
    id_registro: int,
    payload: WhatsAppManualContactRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.record_candidate_whatsapp_contact(
        id_registro,
        payload.model_dump(),
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="registrar_contato_whatsapp",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post("/process-candidates/{id_registro}/approval-email", dependencies=[Depends(require_permissions("emails.enviar_modelo", "candidatos.aprovar_final", require_all=True))])
def send_approval_email(
    id_registro: int,
    payload: dict | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.send_candidate_approval_email(
        id_registro,
        payload or {},
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="E-mails",
        acao="enviar_email_aprovacao",
        entidade="candidato_processo",
        entidade_id=str(id_registro),
        valor_novo=payload or {},
    )
    return result


@router.get("/motivos-eliminacao", dependencies=[Depends(require_permissions("candidatos.eliminar"))])
def get_motivos_eliminacao(repository: DatabaseRepository = Depends(get_repository)):
    """Lista enxuta dos motivos de eliminacao cadastrados (Configuracoes >
    Catalogos), incluindo as sub-causas de cada motivo (payload.sub_causas).
    Rota separada do CRUD completo de /settings/catalog/motivos_eliminacao
    (que exige configuracoes.editar) para que qualquer usuario com permissao
    de eliminar candidatos consiga ler a lista ao abrir o formulario de
    eliminacao, sem precisar de acesso as telas de Configuracoes."""
    return repository.list_catalog_items_by_type("motivos_eliminacao", apenas_ativos=True)


@router.get("/talent-bank", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def get_talent_bank(
    search: str = Query(default=""),
    skill: str = Query(default=""),
    tag: str = Query(default=""),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=100),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_talent_bank(
        search=search,
        skill=skill,
        tag=tag,
        page=page,
        page_size=page_size,
    )


@router.post("/talent-bank", dependencies=[Depends(require_permissions("candidatos.mover_etapa", "candidatos.eliminar"))])
def create_talent_bank_candidate(
    payload: TalentBankCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.add_candidate_to_talent_bank(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="enviar_banco_talentos",
        entidade="banco_talentos",
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/talent-bank/{id_banco}", dependencies=[Depends(require_permissions("candidatos.excluir"))])
def delete_talent_bank_candidate(
    id_banco: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_talent_bank_candidate(id_banco)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="excluir_banco_talentos",
        entidade="banco_talentos",
        entidade_id=str(id_banco),
    )
    return result


@router.post("/talent-bank/{id_banco}/revalidate", dependencies=[Depends(require_permissions("candidatos.mover_etapa"))])
def revalidate_talent_bank_candidate(
    id_banco: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.revalidate_talent_bank_candidate(id_banco)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="revalidar_banco_talentos",
        entidade="banco_talentos",
        entidade_id=str(id_banco),
    )
    return result


@router.post("/talent-bank/{id_banco}/use", dependencies=[Depends(require_permissions("candidatos.criar"))])
def use_talent_bank_candidate(
    id_banco: int,
    payload: TalentBankUseRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.use_talent_bank_candidate(id_banco, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="usar_candidato_banco_talentos",
        entidade="banco_talentos",
        entidade_id=str(id_banco),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/candidate-profiles/{id_teste}", dependencies=[Depends(require_permissions("candidatos.editar", "candidatos.editar_basico"))])
def update_candidate_profile(
    id_teste: str,
    payload: CandidateProfileUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.upsert_candidate_profile(id_teste, payload.model_dump(exclude_unset=True))
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="editar_candidato",
        entidade="candidato",
        entidade_id=id_teste,
        valor_novo=payload.model_dump(exclude_unset=True),
    )
    return result


@router.get("/candidate-profiles/{id_teste}/sheet", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def get_candidate_sheet(
    id_teste: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_candidate_sheet(id_teste)


@router.put("/candidate-profiles/{id_teste}/sheet", dependencies=[Depends(require_permissions("candidatos.editar", "candidatos.editar_basico", "candidatos.editar_admissional"))])
def update_candidate_sheet(
    id_teste: str,
    payload: CandidateSheetUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_candidate_sheet(id_teste, payload.model_dump(exclude_unset=True))
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="editar_ficha_candidato",
        entidade="candidato",
        entidade_id=id_teste,
        valor_novo=payload.model_dump(exclude_unset=True),
    )
    return result


@router.put("/candidate-profiles/{id_teste}/status")
def update_standalone_candidate_status(
    id_teste: str,
    payload: StandaloneCandidateStatusUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    status_candidato = (payload.status_candidato or "").strip().lower()
    if status_candidato in {"eliminado", "reprovado", "desistente"}:
        ensure_user_permission(user, "candidatos.eliminar", repository=repository)
    else:
        ensure_user_permission(user, "candidatos.mover_etapa", repository=repository)
    result = repository.update_standalone_candidate_status(id_teste, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="atualizar_status_candidato_avulso",
        entidade="candidato",
        entidade_id=id_teste,
        valor_novo=payload.model_dump(),
    )
    return result


@router.get("/processes/{id_processo}/details", dependencies=[Depends(require_permissions("processos.visualizar"))])
def get_process_details(
    id_processo: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_process_details(id_processo)


@router.get(
    "/processes/{id_processo}/candidatos-sugeridos",
    dependencies=[Depends(require_permissions("candidatos.visualizar", "vagas.visualizar"))],
)
def get_process_suggested_candidates(
    id_processo: str,
    limit: int = Query(default=15, ge=1, le=50),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_talent_bank_matches(id_processo, limit=limit)


@router.get("/processes/{id_processo}/dossier/notes", dependencies=[Depends(require_permissions("processos.visualizar", "relatorios.visualizar"))])
def list_process_dossier_notes(
    id_processo: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_process_dossier_notes(id_processo)


@router.post("/processes/{id_processo}/dossier/notes", dependencies=[Depends(require_permissions("candidatos.editar", "candidatos.editar_basico", "processos.editar"))])
def create_process_dossier_note(
    id_processo: str,
    payload: ProcessDossierNoteCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_process_dossier_note(
        id_processo,
        payload.model_dump(),
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Processos",
        acao="criar_anotacao_dossie",
        entidade="processo",
        entidade_id=id_processo,
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/process-dossier-notes/{id_anotacao}", dependencies=[Depends(require_permissions("candidatos.editar", "candidatos.editar_basico", "processos.editar"))])
def update_process_dossier_note(
    id_anotacao: int,
    payload: ProcessDossierNoteUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_process_dossier_note(
        id_anotacao,
        payload.model_dump(),
        usuario_responsavel=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Processos",
        acao="editar_anotacao_dossie",
        entidade="processos_dossie_anotacoes",
        entidade_id=str(id_anotacao),
        valor_novo=payload.model_dump(),
    )
    return result


@router.get("/email-inbox", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def list_email_inbox(
    limit: int = Query(default=50),
    include_ignored: bool = Query(default=False),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_email_inbox(limit=limit, include_ignored=include_ignored)


@router.get("/email-inbox/{item_id}", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def get_email_inbox_item(
    item_id: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_email_inbox_item(item_id)


@router.post("/email-inbox/{item_id}/analyze-cv", dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))])
def analyze_email_inbox_cv(
    item_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.analyze_email_inbox_cv(item_id)
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="analisar_cv_ia",
        entidade="email_inbox_item",
        entidade_id=str(item_id),
    )
    return result


@router.post("/email-inbox/{item_id}/link-process", dependencies=[Depends(require_permissions("candidatos.criar"))])
def link_email_inbox_to_process(
    item_id: str,
    payload: dict | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.link_email_inbox_to_process(item_id, payload or {})
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="vincular_cv_email_processo",
        entidade="email_inbox_item",
        entidade_id=str(item_id),
    )
    return result


@router.post("/email-inbox/{item_id}/talent-bank", dependencies=[Depends(require_permissions("candidatos.mover_etapa"))])
def send_email_inbox_to_talent_bank(
    item_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.send_email_inbox_to_talent_bank(item_id)
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="enviar_cv_email_banco_talentos",
        entidade="email_inbox_item",
        entidade_id=str(item_id),
    )
    return result


@router.post("/email-inbox/{item_id}/ignore", dependencies=[Depends(require_permissions("candidatos.mover_etapa"))])
def ignore_email_inbox_item(
    item_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.ignore_email_inbox_item(item_id)
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="ignorar_cv_email",
        entidade="email_inbox_item",
        entidade_id=str(item_id),
    )
    return result


@router.get("/processes/{id_processo}/email-inbox", dependencies=[Depends(require_permissions("candidatos.visualizar"))])
def list_process_email_inbox(
    id_processo: str,
    limit: int = Query(default=12),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_process_email_inbox(id_processo, limit=limit)


@router.post("/processes/{id_processo}/email-inbox/analyze-cv", dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))])
def analyze_process_email_cv(
    id_processo: str,
    payload: dict | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.analyze_email_cv_attachment(id_processo, payload or {})
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="analisar_cv_ia",
        entidade="processo",
        entidade_id=str(id_processo),
    )
    return result


@router.post("/processos/{id_processo}/gerar-link-candidatura", dependencies=[Depends(require_permissions("vagas.editar", "vagas.editar_limitado"))])
def generate_public_application_link(
    id_processo: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.generate_public_application_link(
        id_processo,
        referrer_url=request.headers.get("referer", ""),
        origin_url=request.headers.get("origin", ""),
    )
    audit_action(
        repository,
        user,
        modulo="Vagas",
        acao="gerar_link_candidatura",
        entidade="processo",
        entidade_id=id_processo,
        request=request,
    )
    return result


@router.patch("/processos/{id_processo}/link-candidatura/desativar", dependencies=[Depends(require_permissions("vagas.editar", "vagas.editar_limitado"))])
def deactivate_public_application_link(
    id_processo: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.deactivate_public_application_link(id_processo)
    audit_action(
        repository,
        user,
        modulo="Vagas",
        acao="desativar_link_candidatura",
        entidade="processo",
        entidade_id=id_processo,
    )
    return result


@router.post(
    "/candidate-profiles/{id_teste}/anonimizar",
    dependencies=[Depends(require_permissions("candidatos.anonimizar", "lgpd.anonimizar"))],
)
def anonymize_candidate_profile(
    id_teste: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.anonymize_candidate(id_teste)
    audit_action(
        repository,
        user,
        modulo="LGPD",
        acao="anonimizar_candidato",
        entidade="candidato",
        entidade_id=id_teste,
        valor_novo={"already_anonymized": result.get("already_anonymized", False)},
    )
    return result


@router.get("/candidate-profiles/{id_teste}/cv", dependencies=[Depends(require_permissions("candidatos.baixar_curriculo"))])
def download_candidate_cv(
    id_teste: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    asset = repository.get_candidate_cv_asset(id_teste)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="baixar_curriculo",
        entidade="candidato",
        entidade_id=id_teste,
    )
    if asset.get("bytes") is not None:
        return Response(
            content=asset["bytes"],
            media_type=asset["media_type"],
            headers={"Content-Disposition": f'attachment; filename="{asset["filename"]}"'},
        )
    return FileResponse(
        asset["path"],
        media_type=asset["media_type"],
        filename=asset["filename"],
    )


@router.post("/candidate-profiles/{id_teste}/cv-contact", dependencies=[Depends(require_permissions("candidatos.baixar_curriculo"))])
def extract_candidate_cv_contact(
    id_teste: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.extract_candidate_cv_contact(id_teste)


@router.post("/candidate-profiles/{id_teste}/cv", dependencies=[Depends(require_permissions("candidatos.editar", "candidatos.editar_basico", "candidatos.avaliar_curriculo"))])
async def upload_candidate_cv(
    id_teste: str,
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = await repository.upload_candidate_profile_cv(id_teste, arquivo)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="upload_curriculo",
        entidade="candidato",
        entidade_id=id_teste,
        valor_novo={"arquivo": arquivo.filename or ""},
    )
    return result


@router.post("/candidate-profiles/{id_teste}/analyze-cv", dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))])
def analyze_candidate_profile_cv(
    id_teste: str,
    payload: dict | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.analyze_candidate_profile_cv(
        id_teste,
        id_processo=(payload or {}).get("id_processo", ""),
    )
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="analisar_cv_ia",
        entidade="candidato",
        entidade_id=str(id_teste),
    )
    return result


@router.get("/processes/{id_processo}/cv-pre-analyses", dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))])
def list_cv_pre_analyses(
    id_processo: str,
    page: int = 1,
    page_size: int = 5,
    nome: str = Query(default=""),
    score_min: str = Query(default=""),
    score_max: str = Query(default=""),
    classificacao: str = Query(default=""),
    incluir_ocultos: bool = Query(default=False),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_cv_pre_analyses(
        id_processo,
        page,
        page_size,
        nome=nome,
        score_min=score_min,
        score_max=score_max,
        classificacao=classificacao,
        incluir_ocultos=incluir_ocultos,
    )


@router.post("/processes/{id_processo}/cv-pre-analyses/clear-list", dependencies=[Depends(require_permissions("candidatos.excluir"))])
def clear_cv_pre_analyses_list(
    id_processo: str,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.clear_cv_pre_analyses_list(id_processo)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="limpar_pre_analises_cv",
        entidade="processo",
        entidade_id=id_processo,
    )
    return result


@router.post("/processes/{id_processo}/cv-pre-analyses", dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))])
async def create_cv_pre_analysis(
    id_processo: str,
    arquivo: UploadFile = File(...),
    guardar_cv_original: str = Form("0"),
    repository: DatabaseRepository = Depends(get_repository),
):
    return await repository.create_cv_pre_analysis(id_processo, arquivo, guardar_cv_original)


@router.put("/cv-pre-analyses/{id_pre_analise}", dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))])
def update_cv_pre_analysis(
    id_pre_analise: int,
    payload: CvPreAnalysisUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_cv_pre_analysis(id_pre_analise, payload.model_dump())
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="editar_pre_analise_cv",
        entidade="cv_pre_analise",
        entidade_id=str(id_pre_analise),
    )
    return result


@router.delete("/cv-pre-analyses/{id_pre_analise}", dependencies=[Depends(require_permissions("candidatos.excluir"))])
def delete_cv_pre_analysis(
    id_pre_analise: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_cv_pre_analysis(id_pre_analise)
    audit_action(
        repository,
        user,
        modulo="Candidatos",
        acao="excluir_pre_analise_cv",
        entidade="cv_pre_analise",
        entidade_id=str(id_pre_analise),
    )
    return result


@router.post("/cv-pre-analyses/{id_pre_analise}/add-to-process", dependencies=[Depends(require_permissions("candidatos.criar"))])
def add_cv_pre_analysis_to_process(
    id_pre_analise: int,
    payload: dict | None = Body(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    payload_data = payload or {}
    result = repository.add_cv_pre_analysis_to_process(
        id_pre_analise,
        manual_override=bool(payload_data.get("manual_override")),
        motivo_override=payload_data.get("motivo_override", ""),
        eh_indicacao=bool(payload_data.get("eh_indicacao")),
        tipo_indicacao=payload_data.get("tipo_indicacao", ""),
    )
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="adicionar_pre_analise_ao_processo",
        entidade="cv_pre_analise",
        entidade_id=str(id_pre_analise),
    )
    return result


@router.post("/cv-pre-analyses/{id_pre_analise}/dismiss", dependencies=[Depends(require_permissions("candidatos.mover_etapa"))])
def dismiss_cv_pre_analysis(
    id_pre_analise: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.dismiss_cv_pre_analysis(id_pre_analise)
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="descartar_pre_analise_cv",
        entidade="cv_pre_analise",
        entidade_id=str(id_pre_analise),
    )
    return result


@router.post("/cv-pre-analyses/{id_pre_analise}/talent-bank", dependencies=[Depends(require_permissions("candidatos.mover_etapa"))])
def add_cv_pre_analysis_to_talent_bank(
    id_pre_analise: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.add_cv_pre_analysis_to_talent_bank(id_pre_analise)
    # Auditoria (C4, 27/set/2026): tratamento de currículo fica rastreável (LGPD).
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="enviar_pre_analise_banco_talentos",
        entidade="cv_pre_analise",
        entidade_id=str(id_pre_analise),
    )
    return result

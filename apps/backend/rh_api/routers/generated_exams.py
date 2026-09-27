from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from conecta.infrastructure.security.rate_limit import InMemoryRateLimiter

from ..auth import AuthenticatedUser
from ..config import get_settings
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..services.feedback_qualitativo import build_qualitative_feedback
from ..schemas.generated_exams import (
    CancelExamRequest,
    DecisionRhRequest,
    GeneratedExamCreateRequest,
    ManualEvaluationRequest,
    PublicCandidateDataRequest,
    PublicExamAccessRequest,
    PublicExamAnswersRequest,
    PublicStageStartRequest,
    PublicExamTokenRequest,
    ReopenExamRequest,
)


logger = logging.getLogger(__name__)

router = APIRouter(tags=["generated-exams"])
public_router = APIRouter(prefix="/conecta-provas-api", tags=["conecta-provas-public"])
exam_access_limiter = InMemoryRateLimiter()


def _user_label(user: AuthenticatedUser) -> str:
    return user.nome or user.usuario or user.email or "RH"


@router.get(
    "/generated-exams",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.visualizar"))],
)
def list_generated_exams(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_generated_exams()


@router.get(
    "/generated-exams/question-heatmap",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.visualizar"))],
)
def get_question_heatmap(
    trilha: str = Query(default="", max_length=120),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_question_heatmap(trilha=trilha)


@router.post(
    "/generated-exams",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.criar", "provas.enviar"))],
)
def create_generated_exam(
    payload: GeneratedExamCreateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_generated_exam(
        payload.model_dump(),
        generated_by=_user_label(user),
    )
    audit_action(
        repository,
        user,
        modulo="Conecta Provas",
        acao="gerar_prova",
        entidade="provas_geradas",
        entidade_id=str(result.get("id_prova", "")),
        valor_novo={
            "id_prova": result.get("id_prova"),
            "id_teste": result.get("id_teste"),
            "status": result.get("status"),
        },
        request=request,
    )
    return result


@router.get(
    "/generated-exams/{id_prova}",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.visualizar"))],
)
def get_generated_exam(id_prova: int, repository: DatabaseRepository = Depends(get_repository)):
    result = repository.get_generated_exam(id_prova)
    # Camada aditiva de feedback qualitativo (item 4 do roadmap): não altera a
    # pontuação/correção já calculada pelo repositório, apenas anexa texto
    # explicativo por questão errada + um resumo por categoria/dificuldade,
    # calculado em tempo de leitura a partir das respostas já corrigidas.
    try:
        respostas = result.get("respostas") if isinstance(result, dict) else None
        if respostas:
            questoes = result.get("questoes") if isinstance(result, dict) else None
            result["feedback_qualitativo"] = build_qualitative_feedback(respostas, questoes)
    except Exception as exc:  # pragma: no cover - camada de apoio, nunca deve quebrar a tela de resultado
        logger.warning("Falha ao gerar feedback qualitativo para a prova %s: %s", id_prova, exc)
    return result


@router.get(
    "/generated-exams/{id_prova}/replay",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.visualizar"))],
)
def get_generated_exam_replay(id_prova: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_exam_replay(id_prova)


@router.get(
    "/generated-exams/{id_prova}/preview-session",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.visualizar"))],
)
def get_generated_exam_preview_session(id_prova: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.preview_generated_exam_session(id_prova)


@router.put(
    "/generated-exams/{id_prova}",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.editar"))],
)
def update_generated_exam(
    id_prova: int,
    payload: GeneratedExamCreateRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_generated_exam(
        id_prova,
        payload.model_dump(),
        updated_by=_user_label(user),
    )
    audit_action(
        repository,
        user,
        modulo="Conecta Provas",
        acao="editar_prova",
        entidade="provas_geradas",
        entidade_id=str(id_prova),
        valor_novo={"id_prova": id_prova, "status": result.get("status")},
        request=request,
    )
    return result


@router.delete(
    "/generated-exams/{id_prova}",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.excluir"))],
)
def delete_generated_exam(
    id_prova: int,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_generated_exam(id_prova)
    audit_action(
        repository,
        user,
        modulo="Conecta Provas",
        acao="excluir_prova",
        entidade="provas_geradas",
        entidade_id=str(id_prova),
        valor_anterior={"id_prova": id_prova},
        request=request,
    )
    return result


@router.post(
    "/generated-exams/{id_prova}/manual-evaluation",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.corrigir"))],
)
def update_manual_evaluation(
    id_prova: int,
    payload: ManualEvaluationRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_manual_evaluation(
        id_prova,
        payload.model_dump(),
        updated_by=_user_label(user),
    )
    audit_action(
        repository,
        user,
        modulo="Conecta Provas",
        acao="atualizar_correcao_manual",
        entidade="resultados_provas",
        entidade_id=str(id_prova),
        valor_novo={"camposAtualizados": [key for key, value in payload.model_dump().items() if value not in (None, "")]},
        justificativa=payload.observacao,
        request=request,
    )
    return result


@router.post(
    "/generated-exams/{id_prova}/score/recalculate",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.corrigir", "provas.configurar_pesos"))],
)
def recalculate_score(
    id_prova: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.recalculate_score_conecta(
        id_prova,
        recalculated_by=_user_label(user),
        reason="Recalculo manual pelo RH",
    )
    # Auditoria (C4, 27/set/2026): decisões do RH sobre a prova ficam registradas.
    audit_action(
        repository,
        user,
        modulo="Provas",
        acao="recalcular_score_prova",
        entidade="prova_gerada",
        entidade_id=str(id_prova),
        valor_novo=None,
    )
    return result


@router.post(
    "/generated-exams/{id_prova}/reopen",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.editar", "provas.corrigir"))],
)
def reopen_generated_exam(
    id_prova: int,
    payload: ReopenExamRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.reopen_generated_exam(
        id_prova,
        payload.model_dump(),
        reopened_by=_user_label(user),
    )
    # Auditoria (C4, 27/set/2026): decisões do RH sobre a prova ficam registradas.
    audit_action(
        repository,
        user,
        modulo="Provas",
        acao="reabrir_prova",
        entidade="prova_gerada",
        entidade_id=str(id_prova),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post(
    "/generated-exams/{id_prova}/cancel",
    dependencies=[Depends(get_current_user), Depends(require_permissions("provas.excluir", "provas.editar"))],
)
def cancel_generated_exam(
    id_prova: int,
    payload: CancelExamRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.cancel_generated_exam(
        id_prova,
        payload.model_dump(),
        cancelled_by=_user_label(user),
    )
    # Auditoria (C4, 27/set/2026): decisões do RH sobre a prova ficam registradas.
    audit_action(
        repository,
        user,
        modulo="Provas",
        acao="cancelar_prova",
        entidade="prova_gerada",
        entidade_id=str(id_prova),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post(
    "/generated-exams/{id_prova}/decision",
    dependencies=[Depends(get_current_user), Depends(require_permissions("candidatos.aprovar_final", "candidatos.eliminar"))],
)
def register_rh_decision(
    id_prova: int,
    payload: DecisionRhRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.register_rh_decision(
        id_prova,
        payload.model_dump(),
        user_name=_user_label(user),
    )
    # Auditoria (C4, 27/set/2026): decisões do RH sobre a prova ficam registradas.
    audit_action(
        repository,
        user,
        modulo="Provas",
        acao="decisao_rh_prova",
        entidade="prova_gerada",
        entidade_id=str(id_prova),
        valor_novo=payload.model_dump(),
    )
    return result


@public_router.post("/acesso/email")
def public_access_email(
    payload: PublicExamAccessRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_access_by_email(payload.email)


@public_router.post("/acesso/telefone")
def public_access_phone(
    payload: PublicExamAccessRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_access_by_phone(payload.telefone)


@public_router.post("/acesso/codigo")
def public_access_code(
    payload: PublicExamAccessRequest,
    request: Request = None,
    repository: DatabaseRepository = Depends(get_repository),
):
    origem = request.client.host if request and request.client else ""
    settings = get_settings()
    limiter_key = origem or "desconhecido"
    if not exam_access_limiter.allow(
        limiter_key,
        limit=settings.exam_access_rate_limit,
        window_seconds=settings.exam_access_rate_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de acesso. Aguarde e tente novamente.",
        )
    result = repository.public_access_by_code(payload.codigo)
    if result.get("success"):
        exam_access_limiter.reset(limiter_key)
    return result


@public_router.post("/sessao")
def public_get_session(
    payload: PublicExamTokenRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_get_exam_session(payload.token)


@public_router.post("/confirmar-dados")
def public_confirm_candidate_data(
    payload: PublicCandidateDataRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_update_candidate_data(payload.model_dump())


@public_router.post("/iniciar")
def public_start_exam(
    payload: PublicExamTokenRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_start_exam(payload.token)


@public_router.post("/iniciar-etapa")
def public_start_stage(
    payload: PublicStageStartRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_start_exam_stage(payload.model_dump())


@public_router.post("/respostas")
def public_save_answers(
    payload: PublicExamAnswersRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_save_answers(payload.model_dump())


@public_router.post("/concluir-etapa")
def public_complete_stage(
    payload: PublicExamAnswersRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_complete_stage(payload.model_dump())


@public_router.post("/interromper-etapa")
def public_interrupt_stage(
    payload: PublicExamAnswersRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_interrupt_stage(payload.model_dump())


@public_router.post("/revisao")
def public_mark_review(
    payload: PublicExamAnswersRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_save_answers(payload.model_dump(), status_value="Em revisão")


@public_router.post("/finalizar")
def public_finalize_exam(
    payload: PublicExamAnswersRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.public_finalize_exam(payload.model_dump())

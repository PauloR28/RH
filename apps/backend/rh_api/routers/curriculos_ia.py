from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from ..auth import AuthenticatedUser
from ..config import Settings, get_settings
from ..dependencies import (
    audit_action,
    get_current_user,
    get_repository,
    require_permissions,
)
from ..repositories import DatabaseRepository
from ..services.curriculo_extractor import extrair_curriculo_para_ia
from ..services.cv import CvTextExtractionError
from ..services.ia_curriculo_service import (
    AVISO_REVISAO_HUMANA,
    PROMPT_VERSION,
    IaCurriculoError,
    IaCurriculoService,
)

logger = logging.getLogger(__name__)
router = APIRouter(
    tags=["curriculos-ia"],
    dependencies=[Depends(get_current_user)],
)


@router.get(
    "/curriculos-ia/configuracao",
    dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))],
)
def get_curriculo_ia_configuration(settings: Settings = Depends(get_settings)):
    reason = ""
    if not settings.ai_enabled:
        reason = "A análise com IA está desativada no servidor."
    elif not settings.ai_available:
        reason = "A análise com IA ainda não foi configurada no servidor."
    return {
        "enabled": settings.ai_enabled,
        "available": settings.ai_available,
        "provider": settings.ai_provider if settings.ai_available else "",
        "model": settings.ai_model if settings.ai_available else "",
        "reason": reason,
        "aviso": AVISO_REVISAO_HUMANA,
    }


@router.post(
    "/curriculos/{id_candidato}/analisar-ia",
    dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))],
)
def analyze_curriculo_with_ai(
    id_candidato: str,
    request: Request,
    id_processo: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
    user: AuthenticatedUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    if not settings.ai_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A análise de currículo com IA está desativada.",
        )
    if not settings.ai_available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A análise com IA não está configurada no servidor.",
        )

    context = repository.get_curriculo_ia_context(id_candidato, id_processo)
    if bool(context["processo"].get("ia_analise_desabilitada")):
        # Achado S-10 (SEC-011): opt-out por processo enquanto o DPA do
        # provedor de IA não é formalmente confirmado com o RH/jurídico.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A análise de currículo com IA está desabilitada para este processo seletivo.",
        )
    analysis_id = repository.create_curriculo_ia_analysis(
        id_candidato=context["id_candidato"],
        id_processo=context["id_processo"],
        provedor=settings.ai_provider,
        modelo=settings.ai_model,
        versao_prompt=PROMPT_VERSION,
        duplicate_window_seconds=settings.ai_duplicate_window_seconds,
    )

    try:
        curriculo = context["curriculo"]
        extracted = extrair_curriculo_para_ia(
            curriculo.get("caminho_arquivo") or "",
            curriculo.get("nome_arquivo_original") or "",
            curriculo.get("tipo_arquivo") or "",
            limite_caracteres=settings.ai_max_curriculo_chars,
        )
        result = IaCurriculoService(settings).analisar(
            texto_curriculo=extracted.texto,
            contexto_vaga=context["processo"],
        )
        analysis = repository.complete_curriculo_ia_analysis(
            analysis_id,
            resultado=result.resultado,
            json_resultado=result.json_resultado,
            tokens_entrada=result.tokens_entrada,
            tokens_saida=result.tokens_saida,
        )
        audit_action(
            repository,
            user,
            modulo="Currículos",
            acao="analisar_curriculo_ia",
            entidade="analises_curriculo_ia",
            entidade_id=str(analysis_id),
            valor_novo={
                "id_candidato": context["id_candidato"],
                "id_processo": context["id_processo"],
                "status": "CONCLUIDA",
                "versao_prompt": PROMPT_VERSION,
            },
            request=request,
        )
        return {
            "success": True,
            "analise": analysis,
            "aviso": AVISO_REVISAO_HUMANA,
        }
    except CvTextExtractionError as exc:
        repository.fail_curriculo_ia_analysis(
            analysis_id,
            erro=exc.user_message,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.user_message,
        ) from exc
    except IaCurriculoError as exc:
        repository.fail_curriculo_ia_analysis(
            analysis_id,
            erro=exc.user_message,
            json_resultado=exc.raw_result,
            tokens_entrada=exc.tokens_entrada,
            tokens_saida=exc.tokens_saida,
        )
        audit_action(
            repository,
            user,
            modulo="Currículos",
            acao="analisar_curriculo_ia",
            entidade="analises_curriculo_ia",
            entidade_id=str(analysis_id),
            valor_novo={"status": "ERRO"},
            request=request,
            sucesso=False,
        )
        raise HTTPException(
            status_code=(
                status.HTTP_504_GATEWAY_TIMEOUT
                if exc.timeout
                else status.HTTP_502_BAD_GATEWAY
            ),
            detail=exc.user_message,
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Falha inesperada na análise de currículo %s.", analysis_id)
        repository.fail_curriculo_ia_analysis(
            analysis_id,
            erro=f"Falha interna: {type(exc).__name__}",
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível concluir a análise. Tente novamente.",
        ) from exc


@router.get(
    "/curriculos/{id_candidato}/analises-ia",
    dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))],
)
def list_curriculo_ai_analyses(
    id_candidato: str,
    id_processo: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return {
        "analises": repository.list_curriculo_ia_analyses(
            id_candidato,
            id_processo=id_processo,
        ),
        "aviso": AVISO_REVISAO_HUMANA,
    }


@router.get(
    "/curriculos/{id_candidato}/analises-ia/ultima",
    dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))],
)
def get_latest_curriculo_ai_analysis(
    id_candidato: str,
    id_processo: str = Query(default=""),
    repository: DatabaseRepository = Depends(get_repository),
):
    return {
        "analise": repository.get_latest_curriculo_ia_analysis(
            id_candidato,
            id_processo=id_processo,
        ),
        "aviso": AVISO_REVISAO_HUMANA,
    }


@router.post(
    "/analises-curriculo-ia/{id_analise}/marcar-revisada",
    dependencies=[Depends(require_permissions("candidatos.avaliar_curriculo"))],
)
def mark_curriculo_ai_analysis_reviewed(
    id_analise: int,
    request: Request,
    repository: DatabaseRepository = Depends(get_repository),
    user: AuthenticatedUser = Depends(get_current_user),
):
    analysis = repository.review_curriculo_ia_analysis(
        id_analise,
        id_usuario=user.id_usuario,
    )
    audit_action(
        repository,
        user,
        modulo="Currículos",
        acao="revisar_analise_curriculo_ia",
        entidade="analises_curriculo_ia",
        entidade_id=str(id_analise),
        valor_novo={"revisado_por_humano": True},
        request=request,
    )
    return {
        "success": True,
        "analise": analysis,
        "aviso": AVISO_REVISAO_HUMANA,
    }

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import AuthenticatedUser
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.raciocinio_logico import (
    RaciocinioAplicacaoCreateRequest,
    RaciocinioFinalizarRequest,
    RaciocinioPerguntaCreateRequest,
    RaciocinioPerguntaUpdateRequest,
    RaciocinioProximaAdaptativaRequest,
)

router = APIRouter(prefix="/raciocinio-logico", tags=["raciocinio-logico"], dependencies=[Depends(get_current_user)])
public_router = APIRouter(prefix="/raciocinio-logico-api", tags=["raciocinio-logico-public"])


@router.get("/perguntas", dependencies=[Depends(require_permissions("provas.visualizar"))])
def list_raciocinio_perguntas(repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_raciocinio_perguntas()


@router.post("/perguntas", dependencies=[Depends(require_permissions("provas.questoes_criar"))])
def create_raciocinio_pergunta(
    payload: RaciocinioPerguntaCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_raciocinio_pergunta(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - Raciocínio Lógico",
        acao="criar_pergunta_raciocinio",
        entidade="raciocinio_pergunta",
        entidade_id=str(result.get("id_pergunta") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/perguntas/{id_pergunta}", dependencies=[Depends(require_permissions("provas.questoes_editar"))])
def update_raciocinio_pergunta(
    id_pergunta: int,
    payload: RaciocinioPerguntaUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_raciocinio_pergunta(id_pergunta, payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - Raciocínio Lógico",
        acao="editar_pergunta_raciocinio",
        entidade="raciocinio_pergunta",
        entidade_id=str(id_pergunta),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/perguntas/{id_pergunta}", dependencies=[Depends(require_permissions("provas.questoes_excluir"))])
def delete_raciocinio_pergunta(
    id_pergunta: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_raciocinio_pergunta(id_pergunta)
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - Raciocínio Lógico",
        acao="excluir_pergunta_raciocinio",
        entidade="raciocinio_pergunta",
        entidade_id=str(id_pergunta),
    )
    return result


@router.post("/aplicacoes", dependencies=[Depends(require_permissions("provas.enviar"))])
def create_raciocinio_aplicacao(
    payload: RaciocinioAplicacaoCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_raciocinio_aplicacao(payload.model_dump())
    audit_action(
        repository,
        user,
        modulo="Conecta Provas - Raciocínio Lógico",
        acao="gerar_aplicacao_raciocinio",
        entidade="raciocinio_aplicacao",
        entidade_id=str(result.get("id_aplicacao") or ""),
        valor_novo={"id_teste": payload.id_teste},
    )
    return result


@router.get("/aplicacoes/{id_aplicacao}", dependencies=[Depends(require_permissions("provas.visualizar"))])
def get_raciocinio_aplicacao(id_aplicacao: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_raciocinio_aplicacao(id_aplicacao)


@router.get(
    "/candidatos/{id_teste}/resultado",
    dependencies=[Depends(require_permissions("provas.visualizar"))],
)
def get_raciocinio_resultado_candidato(id_teste: str, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_raciocinio_resultado_candidato(id_teste)


# ----------------------------------------------------------------------
# Rotas públicas (aplicação do teste pelo candidato)
# ----------------------------------------------------------------------
@public_router.get("/aplicacoes/{id_aplicacao}")
def public_get_raciocinio_aplicacao(id_aplicacao: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_raciocinio_aplicacao(id_aplicacao)


@public_router.post("/aplicacoes/{id_aplicacao}/finalizar")
def public_finalize_raciocinio_aplicacao(
    id_aplicacao: int,
    payload: RaciocinioFinalizarRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.finalize_raciocinio_aplicacao(id_aplicacao, payload.model_dump())


@public_router.post("/aplicacoes/{id_aplicacao}/proxima-adaptativa")
def public_avancar_raciocinio_adaptativo(
    id_aplicacao: int,
    payload: RaciocinioProximaAdaptativaRequest,
    repository: DatabaseRepository = Depends(get_repository),
):
    """Modo adaptativo apenas: entrega a proxima questao (dificuldade
    adjacente à ultima resposta) sem expor gabarito nem o pool restante."""
    return repository.avancar_raciocinio_adaptativo(id_aplicacao, payload.model_dump())

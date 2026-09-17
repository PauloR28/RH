from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response

from ..auth import AuthenticatedUser
from ..config import Settings, get_settings
from ..dependencies import audit_action, get_current_user, get_repository, require_permissions
from ..repositories import DatabaseRepository
from ..schemas.onboarding import (
    TERMO_LGPD_ANEXO_TREINAMENTO_TEXTO,
    TERMO_LGPD_ANEXO_TREINAMENTO_VERSAO,
    AnexoDownloadToggleRequest,
    ModuloImportSchema,
    OnboardingAssignmentUpdateRequest,
    OnboardingAttendanceRequest,
    OnboardingItemToggleRequest,
    OnboardingStartRequest,
    OnboardingTrilhaCreateRequest,
    OnboardingTrilhaUpdateRequest,
    ProcessTrainingReleaseRequest,
    TreinamentoWizardCreateRequest,
    VincularTrilhaProcessoRequest,
)
from ..services.office_conversion import convert_office_document_to_pdf
from ..services.training_uploads import (
    CATEGORIA_DOCUMENTO,
    CATEGORIA_IMAGEM,
    CATEGORIA_PPTX,
    CATEGORIA_VIDEO,
    save_training_upload,
    validate_training_upload,
)


router = APIRouter(prefix="/onboarding", tags=["onboarding"], dependencies=[Depends(get_current_user)])

# Nome de arquivo gerado por generate_public_token() + extensão de imagem
# (ver services/training_uploads.py) — valida antes de montar o caminho em
# disco, para nunca aceitar ".." ou separadores de diretório.
_NOME_ARQUIVO_SECAO_IMAGEM_PATTERN = re.compile(r"^[a-z0-9]{4,20}\.(png|jpg|jpeg)$")
_MIME_POR_EXTENSAO = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


@router.get("/trilhas", dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))])
def list_onboarding_trilhas(
    categoria: str = "",
    id_operacao: int = 0,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_onboarding_trilhas(categoria=categoria or None, id_operacao=id_operacao or None)


@router.get("/assignments", dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))])
def list_onboarding_assignments(status: str = "", repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_onboarding_assignments(status_filtro=status or None)


@router.put("/assignments/{id_onboarding}", dependencies=[Depends(require_permissions("onboarding.editar"))])
def update_onboarding_assignment(
    id_onboarding: int,
    payload: OnboardingAssignmentUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_onboarding_assignment(id_onboarding, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="atualizar_agenda_treinamento",
        entidade="onboarding_candidato",
        entidade_id=str(id_onboarding),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/assignments/{id_onboarding}", dependencies=[Depends(require_permissions("onboarding.editar"))])
def delete_onboarding_assignment(
    id_onboarding: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_onboarding_assignment(id_onboarding, actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="encerrar_treinamento_colaborador",
        entidade="onboarding_candidato",
        entidade_id=str(id_onboarding),
    )
    return result


@router.post("/assignments/presenca", dependencies=[Depends(require_permissions("onboarding.editar"))])
def save_onboarding_attendance(
    payload: OnboardingAttendanceRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.save_onboarding_attendance(
        [item.model_dump() for item in payload.presencas],
        actor=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="salvar_lista_presenca_treinamento",
        entidade="onboarding_candidato",
        entidade_id="lote",
        valor_novo=payload.model_dump(),
    )
    return result


@router.get(
    "/processos-treinamentos",
    dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))],
)
def list_process_trainings(id_processo: str = "", repository: DatabaseRepository = Depends(get_repository)):
    return repository.list_process_trainings(id_processo=id_processo or None)


@router.get(
    "/processos-treinamentos/{id_processo_treinamento}/candidatos",
    dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))],
)
def list_process_training_release_candidates(
    id_processo_treinamento: int,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.list_process_training_release_candidates(id_processo_treinamento)


@router.post(
    "/processos-treinamentos/{id_processo_treinamento}/liberar",
    dependencies=[Depends(require_permissions("onboarding.editar"))],
)
def release_process_training_slots(
    id_processo_treinamento: int,
    payload: ProcessTrainingReleaseRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.release_process_training_slots(
        id_processo_treinamento,
        candidatos=payload.candidatos,
        actor=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="liberar_vagas_treinamento_processo",
        entidade="processo_treinamento",
        entidade_id=str(id_processo_treinamento),
        valor_novo=payload.model_dump(),
    )
    return result


@router.post(
    "/trilhas/{id_trilha}/vincular-processo",
    dependencies=[Depends(require_permissions("onboarding.editar"))],
)
def vincular_trilha_a_processo(
    id_trilha: int,
    payload: VincularTrilhaProcessoRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.vincular_trilha_a_processo(id_trilha, payload.id_processo)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="vincular_treinamento_processo",
        entidade="processo_treinamento",
        entidade_id=payload.id_processo,
        valor_novo={"id_trilha": id_trilha},
    )
    return result


@router.get("/trilhas/{id_trilha}", dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))])
def get_onboarding_trilha(id_trilha: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_onboarding_trilha(id_trilha)


@router.post("/trilhas", dependencies=[Depends(require_permissions("onboarding.editar"))])
def create_onboarding_trilha(
    payload: OnboardingTrilhaCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_onboarding_trilha(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="criar_trilha_onboarding",
        entidade="trilha_onboarding",
        entidade_id=str(result.get("id_trilha") or ""),
        valor_novo=payload.model_dump(),
    )
    return result


@router.put("/trilhas/{id_trilha}", dependencies=[Depends(require_permissions("onboarding.editar"))])
def update_onboarding_trilha(
    id_trilha: int,
    payload: OnboardingTrilhaUpdateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.update_onboarding_trilha(id_trilha, payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="editar_trilha_onboarding",
        entidade="trilha_onboarding",
        entidade_id=str(id_trilha),
        valor_novo=payload.model_dump(),
    )
    return result


@router.delete("/trilhas/{id_trilha}", dependencies=[Depends(require_permissions("onboarding.editar"))])
def delete_onboarding_trilha(
    id_trilha: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_onboarding_trilha(id_trilha)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="excluir_trilha_onboarding",
        entidade="trilha_onboarding",
        entidade_id=str(id_trilha),
    )
    return result


@router.post("/candidatos/iniciar", dependencies=[Depends(require_permissions("onboarding.editar"))])
def start_onboarding(
    payload: OnboardingStartRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.start_onboarding(
        payload.id_registro,
        payload.trilha_id,
        actor=user.username,
        data_prevista=payload.data_prevista,
        local=payload.local,
        ministrante=payload.ministrante,
    )
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="iniciar_onboarding_candidato",
        entidade="onboarding_candidato",
        entidade_id=str(payload.id_registro),
        valor_novo=payload.model_dump(),
    )
    return result


@router.get(
    "/candidatos/{id_registro}",
    dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))],
)
def get_onboarding_progress(id_registro: int, repository: DatabaseRepository = Depends(get_repository)):
    return repository.get_onboarding_progress(id_registro)


@router.put("/itens/{id_onboarding_item}", dependencies=[Depends(require_permissions("onboarding.editar"))])
def set_onboarding_item_status(
    id_onboarding_item: int,
    payload: OnboardingItemToggleRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.set_onboarding_item_status(id_onboarding_item, payload.concluido, actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="marcar_item_onboarding" if payload.concluido else "desmarcar_item_onboarding",
        entidade="onboarding_item",
        entidade_id=str(id_onboarding_item),
        valor_novo=payload.model_dump(),
    )
    return result


# ----------------------------------------------------------------------
# App mobile do colaborador ("Conecta App", promt.txt). Auto-escopo pelo
# e-mail do token (user.email) — nunca aceita id_registro/id_onboarding vindo
# do cliente, mesmo padrão de routers/notifications.py.
# ----------------------------------------------------------------------
@router.get("/meus-treinamentos", dependencies=[Depends(require_permissions("onboarding.visualizar"))])
def list_my_trainings(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_my_trainings(user.email)


@router.get(
    "/meus-treinamentos/presenciais",
    dependencies=[Depends(require_permissions("onboarding.visualizar"))],
)
def list_my_presencial_trainings(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_my_trainings(user.email, apenas_presenciais=True)


@router.post(
    "/meus-treinamentos/itens/{id_onboarding_item}/concluir",
    dependencies=[Depends(require_permissions("onboarding.concluir_proprio"))],
)
def complete_my_training_item(
    id_onboarding_item: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.complete_my_training_item(user.email, id_onboarding_item, actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="colaborador_concluiu_item_onboarding",
        entidade="onboarding_item",
        entidade_id=str(id_onboarding_item),
    )
    return result


# ----------------------------------------------------------------------
# Wizard de criação de treinamento (Prompt.txt, rodada 06/set/2026) — ver
# docs/central-treinamentos/01-plano-tecnico.md.
# ----------------------------------------------------------------------
@router.post("/treinamentos", dependencies=[Depends(require_permissions("onboarding.criar"))])
def create_treinamento_wizard(
    payload: TreinamentoWizardCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.create_treinamento_wizard(payload.model_dump(), actor=user.username)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="criar_treinamento_wizard",
        entidade="trilha_onboarding",
        entidade_id=str(result.get("trilha", {}).get("id_trilha") or ""),
        valor_novo={"ocorrencias": len(payload.ocorrencias), "participantes": len(payload.participantes)},
    )
    return result


@router.get(
    "/candidatos-elegiveis",
    dependencies=[Depends(require_permissions("onboarding.criar", "onboarding.editar"))],
)
def search_candidatos_para_treinamento(busca: str = "", repository: DatabaseRepository = Depends(get_repository)):
    return repository.search_candidatos_para_treinamento(busca)


# ----------------------------------------------------------------------
# Uploads: slide .pptx (trilha), vídeo (módulo), documentos/imagens (Saiba +)
# ----------------------------------------------------------------------
@router.post("/trilhas/{id_trilha}/pptx", dependencies=[Depends(require_permissions("onboarding.editar"))])
async def upload_trilha_pptx(
    id_trilha: int,
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    content = await arquivo.read()
    upload = validate_training_upload(
        original_filename=arquivo.filename or "slide.pptx",
        content=content,
        categoria=CATEGORIA_PPTX,
        max_bytes=settings.training_upload_max_pptx_mb * 1024 * 1024,
    )
    stored_path = save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="pptx")

    pdf_path: str | None = None
    pdf_bytes = convert_office_document_to_pdf(
        content, original_extension="pptx", libreoffice_path=settings.libreoffice_path
    )
    if pdf_bytes:
        pdf_stored_path = stored_path.with_suffix(".pdf")
        pdf_stored_path.write_bytes(pdf_bytes)
        pdf_path = str(pdf_stored_path)

    result = repository.set_trilha_pptx(
        id_trilha,
        pptx_path=str(stored_path),
        pptx_nome_original=upload.original_filename,
        pptx_pdf_path=pdf_path,
    )
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="upload_slide_treinamento",
        entidade="trilha_onboarding",
        entidade_id=str(id_trilha),
        valor_novo={"nome_arquivo": upload.original_filename, "conversao_pdf": bool(pdf_path)},
    )
    return result


@router.post("/itens/{id_item}/video", dependencies=[Depends(require_permissions("onboarding.editar"))])
async def upload_item_video(
    id_item: int,
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    content = await arquivo.read()
    upload = validate_training_upload(
        original_filename=arquivo.filename or "video.mp4",
        content=content,
        categoria=CATEGORIA_VIDEO,
        max_bytes=settings.training_upload_max_video_mb * 1024 * 1024,
    )
    stored_path = save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="video")
    result = repository.set_item_video(id_item, video_path=str(stored_path), video_nome_original=upload.original_filename)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="upload_video_modulo",
        entidade="trilha_onboarding_item",
        entidade_id=str(id_item),
        valor_novo={"nome_arquivo": upload.original_filename},
    )
    return result


@router.get(
    "/itens/{id_item}/video",
    dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))],
)
def baixar_item_video(id_item: int, repository: DatabaseRepository = Depends(get_repository)):
    video = repository.get_trilha_item_video(id_item)
    caminho = Path(video["video_path"])
    if not caminho.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arquivo de vídeo não encontrado.")
    media_type = "video/webm" if caminho.suffix.lower() == ".webm" else "video/mp4"
    return FileResponse(caminho, media_type=media_type, filename=video.get("video_nome_original") or caminho.name)


@router.post("/itens/{id_item}/secoes-imagens", dependencies=[Depends(require_permissions("onboarding.editar"))])
async def upload_secao_imagem(
    id_item: int,
    arquivo: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    """Imagem de uma seção de conteúdo do módulo (Correções.txt, 08/set/2026:
    "imagens podem entrar como links ou uploads"). Ao contrário do vídeo/anexo,
    não precisa de linha própria no banco — o arquivo em disco já é a fonte da
    verdade, e a URL retornada aqui é o que entra na lista `imagens` da seção
    (mesmo formato de uma imagem informada por link)."""
    content = await arquivo.read()
    upload = validate_training_upload(
        original_filename=arquivo.filename or "imagem.png",
        content=content,
        categoria=CATEGORIA_IMAGEM,
        max_bytes=settings.training_upload_max_document_mb * 1024 * 1024,
    )
    save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="secoes-imagens")
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="upload_secao_imagem_modulo",
        entidade="trilha_onboarding_item",
        entidade_id=str(id_item),
        valor_novo={"nome_arquivo": upload.original_filename},
    )
    return {"url": f"/onboarding/secoes-imagens/{upload.stored_filename}", "nome_arquivo": upload.original_filename}


@router.get("/secoes-imagens/{nome_arquivo}", dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))])
def baixar_secao_imagem(nome_arquivo: str, settings: Settings = Depends(get_settings)):
    if not _NOME_ARQUIVO_SECAO_IMAGEM_PATTERN.fullmatch(nome_arquivo):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagem não encontrada.")
    caminho = Path(settings.training_upload_dir) / "secoes-imagens" / nome_arquivo
    if not caminho.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imagem não encontrada.")
    return FileResponse(caminho, media_type=_MIME_POR_EXTENSAO.get(caminho.suffix.lower(), "application/octet-stream"))


@router.post("/trilhas/{id_trilha}/anexos", dependencies=[Depends(require_permissions("onboarding.editar"))])
async def upload_trilha_anexo(
    id_trilha: int,
    arquivo: UploadFile = File(...),
    trilha_item_id: int = Form(0),
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    """Documento ou imagem da aba "Saiba +" (nível treinamento se trilha_item_id=0,
    nível módulo caso contrário). Nasce sempre com download desligado — ver
    PUT /anexos/{id_anexo}/download para o fluxo de liberação LGPD."""
    content = await arquivo.read()
    filename = arquivo.filename or "arquivo"
    extensao = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    categoria = CATEGORIA_IMAGEM if extensao in (".png", ".jpg", ".jpeg") else CATEGORIA_DOCUMENTO
    max_mb = settings.training_upload_max_document_mb
    upload = validate_training_upload(
        original_filename=filename,
        content=content,
        categoria=categoria,
        max_bytes=max_mb * 1024 * 1024,
    )
    stored_path = save_training_upload(upload, upload_dir=settings.training_upload_dir, subpasta="anexos")
    result = repository.add_trilha_anexo(
        id_trilha,
        trilha_item_id=trilha_item_id or None,
        nome_arquivo_original=upload.original_filename,
        nome_arquivo_armazenado=upload.stored_filename,
        tipo_arquivo=upload.mime_type,
        caminho_arquivo=str(stored_path),
        tamanho_bytes=upload.size_bytes,
        actor=user.username,
    )
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="upload_anexo_treinamento",
        entidade="trilha_onboarding_anexo",
        entidade_id=str(result.get("id_anexo") or ""),
        valor_novo={"nome_arquivo": upload.original_filename, "trilha_item_id": trilha_item_id or None},
    )
    return result


@router.put("/anexos/{id_anexo}/download", dependencies=[Depends(require_permissions("onboarding.editar"))])
def toggle_anexo_download(
    id_anexo: int,
    payload: AnexoDownloadToggleRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.toggle_anexo_download(
        id_anexo,
        permite_download=payload.permite_download,
        termo_aceito=payload.termo_aceito,
        termo_versao=TERMO_LGPD_ANEXO_TREINAMENTO_VERSAO,
        actor=user.username,
    )
    # Prompt.txt §3.3: "a ação será registrada (auditoria — quem liberou,
    # quando)" — rastreabilidade jurídica via o mecanismo de auditoria já
    # existente, além das colunas termo_aceito_em/por na própria linha.
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="liberar_download_anexo_treinamento" if payload.permite_download else "bloquear_download_anexo_treinamento",
        entidade="trilha_onboarding_anexo",
        entidade_id=str(id_anexo),
        valor_novo={
            "permite_download": payload.permite_download,
            "termo_versao": TERMO_LGPD_ANEXO_TREINAMENTO_VERSAO if payload.permite_download else None,
            "termo_texto": TERMO_LGPD_ANEXO_TREINAMENTO_TEXTO if payload.permite_download else None,
        },
    )
    return result


@router.delete("/anexos/{id_anexo}", dependencies=[Depends(require_permissions("onboarding.editar"))])
def delete_trilha_anexo(
    id_anexo: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    result = repository.delete_trilha_anexo(id_anexo)
    audit_action(
        repository,
        user,
        modulo="Onboarding",
        acao="excluir_anexo_treinamento",
        entidade="trilha_onboarding_anexo",
        entidade_id=str(id_anexo),
    )
    return result


@router.get("/anexos/{id_anexo}/arquivo", dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))])
def baixar_anexo(
    id_anexo: int,
    user: AuthenticatedUser = Depends(get_current_user),
    repository: DatabaseRepository = Depends(get_repository),
):
    anexo = repository.get_trilha_anexo(id_anexo)
    pode_editar = user.has_permission("onboarding.editar")
    if not anexo.get("permite_download") and not pode_editar:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Download deste documento não está liberado.")
    return FileResponse(
        anexo["caminho_arquivo"],
        media_type=anexo.get("tipo_arquivo") or "application/octet-stream",
        filename=anexo["nome_arquivo_original"],
    )


@router.get("/trilhas/{id_trilha}/pptx-pdf", dependencies=[Depends(require_permissions("onboarding.visualizar", "onboarding.editar"))])
def baixar_pptx_pdf(id_trilha: int, repository: DatabaseRepository = Depends(get_repository)):
    trilha = repository.get_onboarding_trilha(id_trilha)
    pdf_path = trilha.get("pptx_pdf_path")
    if not pdf_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF do slide indisponível (conversão não realizada — ver ponto de validação manual na entrega).",
        )
    return FileResponse(pdf_path, media_type="application/pdf", filename="slide.pdf")


# ----------------------------------------------------------------------
# JSON de módulo: modelo em branco, schema e validação de upload (Prompt.txt
# §3.2 — "valide o upload contra esse schema... nunca falhar silenciosamente").
# ----------------------------------------------------------------------
_MODELO_MODULO_JSON = {
    "titulo": "Ex: Introdução ao Sistema X",
    "subtitulo": "Ex: Visão geral e primeiros passos",
    "descricao": "Ex: Módulo introdutório sobre o sistema utilizado pela operação.",
    "texto_principal": "Ex: Texto completo do módulo, explicando o conteúdo em detalhes.",
    "obrigatorio": True,
    "tipo_conteudo": "texto",
    "conteudo_url": "Ex: https://exemplo.com/video-ou-embed (opcional, deixe vazio se for anexar vídeo pelo upload)",
    "dica_texto": "Ex: Lembre-se de salvar seu progresso antes de sair.",
    "tabela": {
        "colunas": ["Ex: Campo", "Ex: Descrição"],
        "linhas": [["Ex: Nome", "Ex: Nome completo do colaborador"]],
    },
    "saiba_mais": [
        {"tipo": "dica", "texto": "Ex: Consulte também a política interna XYZ.", "url": ""},
        {"tipo": "link", "texto": "Ex: Manual completo", "url": "https://exemplo.com/manual"},
    ],
    # Imagens do módulo (opcional): zero, uma ou várias por seção, distribuídas
    # em vários subtítulos ao longo do módulo — não um único anexo no final,
    # como o vídeo. Cada URL costuma ser um link do SharePoint/OneDrive/
    # intranet já hospedando o arquivo (ver "secoes" — deixe a lista vazia
    # nas seções sem imagem).
    "secoes": [
        {
            "subtitulo": "Ex: Passo 1 — Acessando o sistema",
            "texto": "Ex: Explique aqui o primeiro passo, com detalhes.",
            "dica": "Ex: Dica específica desta seção (opcional).",
            "link": "Ex: https://exemplo.com/link-desta-secao (opcional)",
            "imagens": ["Ex: https://exemplo.sharepoint.com/imagem-passo-1.png"],
        },
        {
            "subtitulo": "Ex: Passo 2 — Configurando sua conta",
            "texto": "Ex: Seção sem imagem, dica ou link — os campos podem ficar vazios.",
            "dica": "",
            "link": "",
            "imagens": [],
        },
    ],
}


@router.get("/modulos/schema", dependencies=[Depends(require_permissions("onboarding.criar", "onboarding.editar"))])
def get_modulo_schema():
    return ModuloImportSchema.model_json_schema()


@router.get("/modulos/modelo", dependencies=[Depends(require_permissions("onboarding.criar", "onboarding.editar"))])
def download_modulo_modelo():
    conteudo = json.dumps(_MODELO_MODULO_JSON, ensure_ascii=False, indent=2)
    return Response(
        content=conteudo,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="modelo-modulo-treinamento.json"'},
    )


@router.post("/modulos/validar", dependencies=[Depends(require_permissions("onboarding.criar", "onboarding.editar"))])
def validar_modulo_json(payload: ModuloImportSchema):
    """Se o JSON enviado não bater com o schema, o FastAPI já responde 422 com
    a lista de erros por campo (nunca falha silenciosamente) — chegar aqui
    significa que o módulo é válido."""
    return {"valido": True, "modulo": payload.model_dump()}


# ----------------------------------------------------------------------
# Relatórios (Prompt.txt §3.8 — mínimo 2, implementados 3)
# ----------------------------------------------------------------------
@router.get("/relatorios/status", dependencies=[Depends(require_permissions("onboarding.gerenciar"))])
def relatorio_treinamentos_status(
    id_operacao: int = 0,
    data_inicio: str = "",
    data_fim: str = "",
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.report_treinamentos_status(
        id_operacao=id_operacao or None,
        data_inicio=data_inicio or None,
        data_fim=data_fim or None,
    )


@router.get("/relatorios/presenca", dependencies=[Depends(require_permissions("onboarding.gerenciar"))])
def relatorio_presenca_colaborador(repository: DatabaseRepository = Depends(get_repository)):
    return repository.report_presenca_colaborador()


@router.get("/relatorios/conclusao-operacao", dependencies=[Depends(require_permissions("onboarding.gerenciar"))])
def relatorio_conclusao_operacao(repository: DatabaseRepository = Depends(get_repository)):
    return repository.report_conclusao_operacao()

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from ..dependencies import get_repository
from ..repositories import DatabaseRepository

router = APIRouter(tags=["public-candidacy"])


@router.get("/public/candidatura/{slug}")
def get_public_application(
    slug: str,
    repository: DatabaseRepository = Depends(get_repository),
):
    return repository.get_public_application(slug)


@router.post("/public/candidatura/{slug}/enviar")
async def submit_public_application(
    slug: str,
    request: Request = None,
    nome_completo: str = Form(""),
    email: str = Form(""),
    telefone: str = Form(""),
    area_interesse: str = Form(""),
    resumo_profissional: str = Form(""),
    cidade: str = Form(""),
    bairro: str = Form(""),
    lgpd_aceito: str = Form(""),
    curriculo: UploadFile | None = File(None),
    repository: DatabaseRepository = Depends(get_repository),
):
    origem = request.client.host if request and request.client else ""
    return await repository.submit_public_application(
        slug,
        nome_completo=nome_completo,
        email=email,
        telefone=telefone,
        area_interesse=area_interesse,
        resumo_profissional=resumo_profissional,
        cidade=cidade,
        bairro=bairro,
        lgpd_aceito=lgpd_aceito,
        curriculo=curriculo,
        lgpd_consentimento_ip=origem,
    )

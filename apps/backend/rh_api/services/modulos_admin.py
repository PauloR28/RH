"""Escrita do registro de módulos e do dono das permissões (Tecnologia). Sempre auditada; sempre invalida o cache de acesso."""

from __future__ import annotations

from fastapi import HTTPException, status

from ..config import get_settings
from ..db import get_connection
from ..modulos_catalogo import MODULO_TECNOLOGIA, MODULOS_PADRAO, MODULOS_PROTEGIDOS, MODULOS_VALIDOS
from . import acesso


def _erro(codigo: int, detalhe: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def listar_modulos() -> list[dict]:
    est = acesso.estado()
    return [
        {
            "chave": chave,
            "nome": est.nomes.get(chave, nome),
            "ordem": est.ordem.get(chave, ordem),
            "ativo": acesso.modulo_ativo(chave),
            "protegido": chave in MODULOS_PROTEGIDOS,
        }
        for chave, nome, ordem, _p in MODULOS_PADRAO
    ]


def definir_ativo(chave: str, ativo: bool, *, autor: str) -> dict:
    """Liga/desliga um módulo. `core` e `tecnologia` são protegidos (decisão 6): nunca desligam."""
    if chave not in MODULOS_VALIDOS:
        raise _erro(status.HTTP_404_NOT_FOUND, "Módulo não encontrado.")
    if chave in MODULOS_PROTEGIDOS and not ativo:
        raise _erro(status.HTTP_409_CONFLICT, "Este módulo é protegido e não pode ser desativado.")
    anterior = acesso.modulo_ativo(chave)
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE dbo.modulos_sistema SET ativo = ?, atualizado_em = GETDATE(), atualizado_por = ? WHERE chave = ?",
            (1 if ativo else 0, autor[:180], chave),
        )
        if cursor.rowcount == 0:
            raise _erro(status.HTTP_409_CONFLICT, "Registro de módulos indisponível: aplique a migration V055.")
    finally:
        conn.close()
    acesso.invalidar_cache()
    return {"chave": chave, "ativo_anterior": anterior, "ativo": ativo}


def definir_modulo_da_permissao(chave: str, modulo: str, abre_modulo: bool | None, *, autor: str) -> dict:
    """Reatribui o módulo dono de uma permissão (a "configurabilidade" decidida pelo RH, ex.: Relatórios)."""
    from ..rbac import PERMISSION_DEFINITIONS

    if chave not in PERMISSION_DEFINITIONS:
        raise _erro(status.HTTP_404_NOT_FOUND, "Permissão não encontrada.")
    if modulo not in MODULOS_VALIDOS:
        raise _erro(status.HTTP_400_BAD_REQUEST, "Módulo inválido.")
    dono_anterior = acesso.modulo_da_permissao(chave)
    abre_anterior = acesso.modulo_aberto_por(chave)
    abre_novo = abre_anterior is not None if abre_modulo is None else abre_modulo
    # Não deixa a Tecnologia sem a(s) permissão(ões) que a abrem: seria trancar todos para fora (decisão 6).
    if abre_anterior == MODULO_TECNOLOGIA and (modulo != MODULO_TECNOLOGIA or not abre_novo):
        raise _erro(status.HTTP_409_CONFLICT, "Esta permissão abre o módulo Tecnologia e não pode ser movida nem deixar de abri-lo.")
    conn = get_connection(get_settings(), autocommit=True)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE dbo.permissoes SET modulo_dono = ?, abre_modulo = ? WHERE chave = ?",
            (modulo, 1 if abre_novo else 0, chave),
        )
        if cursor.rowcount == 0:
            raise _erro(status.HTTP_409_CONFLICT, "Permissão sem registro no banco ou migration V056 não aplicada.")
    finally:
        conn.close()
    acesso.invalidar_cache()
    return {"chave": chave, "modulo_anterior": dono_anterior, "modulo": modulo, "abre_modulo": abre_novo, "autor": autor}

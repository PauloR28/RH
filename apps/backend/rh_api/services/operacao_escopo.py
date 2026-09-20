"""Isolamento por operação para conteúdo personalizado por operação
(promt.txt §2.4 / M08 — ADITIVO, sem mudar o comportamento de quem não tem
operação atribuída).

Regra herdada do Conecta (AuthenticatedUser.allows_operacao): usuário sem
operações atribuídas continua vendo tudo. Quem tem operações só vê:
  * conteúdo "padrão" (sem operação definida — vale para todos);
  * conteúdo das suas operações;
  * treinamentos em que está atrelado como ministrante (ex.: supervisor de
    outra equipe que aplica um treinamento) — só para treinamentos.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from .helpers import normalize_text

MENSAGEM_FORA_ESCOPO = "Este conteúdo pertence a uma operação fora do seu escopo de acesso."


def usuario_restrito(user) -> bool:
    return bool(getattr(user, "operacoes", None))


def ids_operacoes_do_usuario(repository, user) -> set[int]:
    """`id_item` do catálogo de operações correspondentes às chaves/nomes do usuário."""
    if not usuario_restrito(user):
        return set()
    conn = repository._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id_item, chave, nome FROM dbo.operacoes")
        alvo = {normalize_text(item).lower() for item in user.operacoes}
        return {
            int(row[0])
            for row in cursor.fetchall()
            if normalize_text(row[1]).lower() in alvo or normalize_text(row[2]).lower() in alvo
        }
    finally:
        conn.close()


def trilhas_como_ministrante(repository, user) -> set[int]:
    """Trilhas em que o usuário aparece como ministrante de alguma atribuição."""
    nomes = {
        normalize_text(valor).lower()
        for valor in (getattr(user, "nome", ""), getattr(user, "email", ""), getattr(user, "username", ""))
        if normalize_text(valor)
    }
    if not nomes:
        return set()
    conn = repository._connect()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT trilha_id, ministrante FROM dbo.onboarding_candidatos WHERE ministrante IS NOT NULL")
        return {int(row[0]) for row in cursor.fetchall() if normalize_text(row[1]).lower() in nomes}
    finally:
        conn.close()


def trilhas_visiveis(repository, user, trilhas: list[dict]) -> list[dict]:
    if not usuario_restrito(user):
        return trilhas
    ids_ops = ids_operacoes_do_usuario(repository, user)
    ministradas = trilhas_como_ministrante(repository, user)
    return [
        item
        for item in trilhas
        if not item.get("id_operacao")
        or int(item["id_operacao"]) in ids_ops
        or int(item.get("id_trilha") or 0) in ministradas
    ]


def exigir_trilha_visivel(repository, user, trilha: dict) -> None:
    if not trilhas_visiveis(repository, user, [trilha]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MENSAGEM_FORA_ESCOPO)

"""Política de inatividade (Configurações › Segurança, Etapa 7b — 17/nov/2026).

Regra do Paulo: sem acesso por 60 dias, o acesso é bloqueado; por 120 dias, o usuário é excluído (o histórico fica).
Os números vêm da tela (services/seguranca_config.py). Não vale para o Administrador.

* Conta a partir do último acesso; quem nunca entrou conta a partir da criação.
* Bloquear = status "Bloqueado" (desbloqueia em Usuários, como hoje).
* Excluir = a mesma exclusão definitiva da tela Usuários. Quem tem histórico na Monitoria (imutável) não pode ser
  excluído: fica bloqueado, e o histórico continua.
* Aviso: notificação no sino N dias antes do bloqueio, uma vez só.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import HTTPException

from ..rbac import ROLE_ADMIN
from . import seguranca_config

logger = logging.getLogger(__name__)
ATOR_ROTINA = {"nome": "Rotina de inatividade", "email": "sistema", "perfil_nome": "Rotina automática"}
_ATIVOS = {"ativo"}
_PARADOS = {"bloqueado", "inativo"}


def _usuarios(cursor) -> list[dict]:
    cursor.execute(
        """
        SELECT id_usuario, nome, email, perfil_id, status, COALESCE(ultimo_acesso_em, criado_em) AS referencia
        FROM usuarios
        WHERE perfil_id <> ?
        """,
        (ROLE_ADMIN,),
    )
    return [
        {"id_usuario": int(r[0]), "nome": r[1] or "", "email": r[2] or "", "perfil": r[3] or "", "status": str(r[4] or ""), "referencia": r[5]}
        for r in cursor.fetchall()
    ]


def classificar(usuarios: list[dict], config: dict, agora: datetime) -> dict:
    """Separa quem bloquear, excluir e avisar hoje. Função pura (testável sem banco)."""
    bloqueio = int(config["inatividade_bloqueio_dias"])
    exclusao = int(config["inatividade_exclusao_dias"])
    aviso = int(config["inatividade_aviso_dias"])
    saida: dict[str, list[dict]] = {"bloquear": [], "excluir": [], "avisar": []}
    for u in usuarios:
        ref = u.get("referencia")
        if not isinstance(ref, datetime):
            continue
        dias = (agora - ref).days
        situacao = u["status"].strip().lower()
        item = {**u, "dias": dias, "referencia": ref.isoformat()}
        if dias >= exclusao and situacao in _ATIVOS | _PARADOS:
            saida["excluir"].append(item)
        elif dias >= bloqueio and situacao in _ATIVOS:
            saida["bloquear"].append(item)
        elif aviso and bloqueio - aviso <= dias < bloqueio and situacao in _ATIVOS:
            saida["avisar"].append({**item, "bloqueia_em": (ref + timedelta(days=bloqueio)).date().isoformat()})
    return saida


def previa(repository, *, agora: datetime | None = None) -> dict:
    config = seguranca_config.ler()
    conn = repository._connect()
    try:
        lista = classificar(_usuarios(conn.cursor()), config, agora or datetime.now())
    finally:
        conn.close()
    return {"ativa": bool(config["inatividade_ativa"]), **{k: len(v) for k, v in lista.items()}, "pessoas": lista}


def executar(repository, *, agora: datetime | None = None) -> dict:
    """Rotina diária. Só faz algo com a política ligada."""
    config = seguranca_config.ler()
    if not config["inatividade_ativa"]:
        return {"executado": False, "motivo": "Política de inatividade desligada."}
    agora = agora or datetime.now()
    conn = repository._connect()
    try:
        cursor = conn.cursor()
        lista = classificar(_usuarios(cursor), config, agora)
        bloqueados = 0
        for u in lista["bloquear"] + lista["excluir"]:
            if u["status"].strip().lower() not in _ATIVOS:
                continue
            cursor.execute(
                "UPDATE usuarios SET status = 'Bloqueado', bloqueado_em = GETDATE(), atualizado_por = ?, atualizado_em = GETDATE() WHERE id_usuario = ?",
                (ATOR_ROTINA["nome"], u["id_usuario"]),
            )
            repository._insert_audit_log(
                cursor, user=ATOR_ROTINA, modulo="Usuários", acao="bloquear_usuario", entidade="usuario",
                entidade_id=str(u["id_usuario"]), valor_anterior={"status": u["status"]}, valor_novo={"status": "Bloqueado"},
                justificativa=f"Sem acesso há {u['dias']} dias (política de inatividade).", origem="rotina",
            )
            bloqueados += 1
        avisados = 0
        for u in lista["avisar"]:
            cursor.execute(
                "SELECT COUNT(*) FROM notificacoes WHERE entidade = 'usuario_inatividade' AND entidade_id = ? AND criado_em >= ?",
                (str(u["id_usuario"]), agora - timedelta(days=int(config["inatividade_aviso_dias"]) + 1)),
            )
            if int(cursor.fetchone()[0]):
                continue
            repository._criar_notificacao(
                cursor, destinatario_usuario=u["email"], categoria="seguranca_inatividade", entidade="usuario_inatividade",
                entidade_id=str(u["id_usuario"]), titulo="Seu acesso ao Conecta vai ser bloqueado",
                mensagem=f"Você está há {u['dias']} dias sem entrar. Entre no Conecta até {u['bloqueia_em']} para manter o acesso.",
            )
            avisados += 1
        conn.commit()
    finally:
        conn.close()
    excluidos, mantidos = 0, 0
    for u in lista["excluir"]:
        try:
            repository.delete_system_user(
                u["id_usuario"], actor=None,
                justificativa=f"Sem acesso há {u['dias']} dias (política de inatividade). Exclusão automática.",
            )
            excluidos += 1
        except HTTPException:  # histórico da Monitoria (imutável) ou outra trava: fica bloqueado
            mantidos += 1
    resultado = {"executado": True, "bloqueados": bloqueados, "excluidos": excluidos, "mantidos_bloqueados": mantidos, "avisados": avisados}
    logger.info("Política de inatividade: %s", resultado)
    return resultado

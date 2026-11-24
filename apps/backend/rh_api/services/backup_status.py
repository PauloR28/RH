"""Configurações › Backup (Etapa 7b — decisão D5 de 16/11: o Conecta só MOSTRA a situação; quem faz o backup é a tarefa
agendada do Windows, infra/scripts/powershell/backup-producao.ps1, que também avisa por e-mail quando falha).

Fontes, as duas só leitura:
* Histórico do SQL Server (``msdb.dbo.backupset``) do banco do Conecta.
* Registro do script (arquivos ``backup-AAAA-MM-DD.log``) na pasta de ``RH_BACKUP_LOG_DIR``, se configurada.
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

TIPOS = {"D": "Completo", "I": "Diferencial", "L": "Log"}
HORAS_ATRASO = 26  # backup diário às 02:00: passou disso sem backup novo = atrasado


def _historico(cursor) -> list[dict]:
    cursor.execute(
        """
        SELECT TOP 10 backup_start_date, backup_finish_date, type, backup_size, is_damaged
        FROM msdb.dbo.backupset WHERE database_name = DB_NAME() ORDER BY backup_finish_date DESC
        """
    )
    return [
        {
            "inicio": r[0].isoformat() if r[0] else None,
            "fim": r[1].isoformat() if r[1] else None,
            "tipo": TIPOS.get(str(r[2] or ""), str(r[2] or "")),
            "tamanho_mb": round(float(r[3] or 0) / 1024 / 1024, 1),
            "danificado": bool(r[4]),
        }
        for r in cursor.fetchall()
    ]


def _registro(pasta: str) -> dict | None:
    if not pasta:
        return None
    base = Path(pasta)
    if not base.is_dir():
        return {"pasta": pasta, "erro": "Pasta do registro não encontrada."}
    arquivos = sorted(base.glob("backup-*.log"), reverse=True)
    if not arquivos:
        return {"pasta": pasta, "erro": "Nenhum registro de backup na pasta."}
    linhas = arquivos[0].read_text(encoding="utf-8", errors="replace").splitlines()
    return {
        "pasta": pasta,
        "arquivo": arquivos[0].name,
        "linhas": linhas[-40:],
        "falhou": any("[ERRO]" in linha for linha in linhas),
    }


def situacao(repository, *, agora: datetime | None = None) -> dict:
    agora = agora or datetime.now()
    historico: list[dict] = []
    erro_banco = ""
    conn = repository._connect()
    try:
        historico = _historico(conn.cursor())
    except Exception as exc:  # noqa: BLE001 - sem acesso ao msdb: mostra o motivo
        erro_banco = f"Não foi possível ler o histórico de backup do SQL Server ({exc.__class__.__name__})."
    finally:
        conn.close()
    registro = _registro(os.getenv("RH_BACKUP_LOG_DIR", "").strip())
    ultimo = next((h for h in historico if h["tipo"] == "Completo"), None)
    if ultimo and ultimo["fim"]:
        horas = (agora - datetime.fromisoformat(ultimo["fim"])).total_seconds() / 3600
        estado = "falha" if ultimo["danificado"] or (registro or {}).get("falhou") else ("atrasado" if horas > HORAS_ATRASO else "ok")
    else:
        estado = "sem_registro"
    return {"estado": estado, "ultimo": ultimo, "historico": historico, "registro": registro, "erro": erro_banco}

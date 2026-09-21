"""Arquivamento de logs do sistema (Correções.txt, 21/set/2026 — "Carregamento e armazenamento").

`logs_auditoria` só cresce; com o tempo a listagem e as consultas ficam lentas. Este job
exporta os registros mais antigos que a janela de retenção para um ZIP (CSV compactado),
confere que o ZIP foi gravado e só então remove as linhas exportadas do banco.

Infraestrutura leve e degradável (CLAUDE.md): roda dentro do APScheduler, é idempotente
e uma falha nunca apaga nada (a remoção só acontece depois do ZIP íntegro em disco).
Os logs da Monitoria (`monitoria_logs`) são IMUTÁVEIS por trigger de banco e ficam
fora deste job — nunca são exportados nem removidos.

Configuração por variável de ambiente (nada na interface):
  RH_LOG_ARCHIVE_ENABLED  liga/desliga (padrão: ligado)
  RH_LOG_ARCHIVE_DAYS     retenção em dias no banco (padrão 90; mínimo 30)
  RH_LOG_ARCHIVE_DIR      pasta dos ZIPs (padrão: <uploads de treinamento>/../log-archive)
  RH_LOG_ARCHIVE_BATCH    linhas por ZIP/lote (padrão 20000)
"""

from __future__ import annotations

import csv
import io
import logging
import os
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

TABELA = "dbo.logs_auditoria"
COLUNAS = (
    "id_log", "id_usuario", "nome_usuario", "email_usuario", "perfil_id", "perfil_nome", "data_hora", "modulo",
    "acao", "entidade", "entidade_id", "valor_anterior", "valor_novo", "justificativa", "origem", "sucesso", "criado_em",
)
DIAS_MINIMOS = 30


def _ler_int(nome: str, padrao: int, minimo: int) -> int:
    try:
        return max(minimo, int(os.getenv(nome, "").strip() or padrao))
    except ValueError:
        return padrao


def configuracao(settings: Any) -> dict[str, Any]:
    habilitado = os.getenv("RH_LOG_ARCHIVE_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off", "nao", "não"}
    pasta = os.getenv("RH_LOG_ARCHIVE_DIR", "").strip()
    if not pasta:
        pasta = str(Path(str(getattr(settings, "training_upload_dir", "data/private/training-uploads"))).parent / "log-archive")
    return {
        "habilitado": habilitado,
        "dias": _ler_int("RH_LOG_ARCHIVE_DAYS", 90, DIAS_MINIMOS),
        "pasta": Path(pasta),
        "lote": _ler_int("RH_LOG_ARCHIVE_BATCH", 20000, 100),
    }


def _celula(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, datetime):
        return valor.isoformat(sep=" ", timespec="seconds")
    text = str(valor)
    # Neutraliza fórmulas caso o CSV seja aberto no Excel.
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def _gravar_zip(pasta: Path, linhas: list[tuple], *, agora: datetime) -> Path:
    pasta.mkdir(parents=True, exist_ok=True)
    primeiro = min(l[6] for l in linhas if l[6]) if any(l[6] for l in linhas) else agora
    ultimo = max(l[6] for l in linhas if l[6]) if any(l[6] for l in linhas) else agora
    base = f"logs_auditoria_{primeiro:%Y%m%d}_{ultimo:%Y%m%d}_{agora:%H%M%S}"
    destino = pasta / f"{base}.zip"
    temporario = pasta / f"{base}.zip.parcial"
    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";")
    escritor.writerow(COLUNAS)
    for linha in linhas:
        escritor.writerow([_celula(v) for v in linha])
    with zipfile.ZipFile(temporario, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as arquivo:
        arquivo.writestr(f"{base}.csv", buffer.getvalue().encode("utf-8-sig"))
    with zipfile.ZipFile(temporario) as conferencia:  # integridade antes de qualquer remoção
        if conferencia.testzip() is not None:
            raise OSError("ZIP de logs corrompido; nada foi removido do banco.")
    temporario.replace(destino)
    return destino


def arquivar_logs(connect, settings: Any, *, agora: datetime | None = None) -> dict[str, Any]:
    """Exporta e remove os logs mais antigos que a retenção. `connect` devolve uma conexão pyodbc."""
    cfg = configuracao(settings)
    if not cfg["habilitado"]:
        return {"executado": False, "motivo": "desabilitado (RH_LOG_ARCHIVE_ENABLED)"}
    agora = agora or datetime.now()
    corte = agora - timedelta(days=cfg["dias"])
    arquivados = 0
    arquivos: list[str] = []
    while True:
        conn = connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT TOP (?) {', '.join(COLUNAS)} FROM {TABELA} WHERE data_hora < ? ORDER BY id_log",
                (cfg["lote"], corte),
            )
            linhas = [tuple(r) for r in cursor.fetchall()]
            if not linhas:
                break
            destino = _gravar_zip(cfg["pasta"], linhas, agora=agora + timedelta(seconds=len(arquivos)))
            ids = [int(l[0]) for l in linhas]
            for i in range(0, len(ids), 500):
                bloco = ids[i : i + 500]
                marcadores = ", ".join("?" for _ in bloco)
                cursor.execute(f"DELETE FROM {TABELA} WHERE id_log IN ({marcadores})", bloco)
            conn.commit()
            arquivados += len(ids)
            arquivos.append(destino.name)
        finally:
            conn.close()
        if len(linhas) < cfg["lote"]:
            break
    if arquivados:
        logger.info("Arquivamento de logs: %s registro(s) movido(s) para %s.", arquivados, ", ".join(arquivos))
    return {"executado": True, "retencao_dias": cfg["dias"], "arquivados": arquivados, "arquivos": arquivos}

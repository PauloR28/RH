from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path

from ..rbac import ROLE_ADMIN, ROLE_MANAGER
from ..services.helpers import normalize_text
from ..services.lgpd_retencao import (
    AVISAR,
    EXCLUIR,
    PROTEGIDO,
    avaliar,
    mensagem_aviso,
    normalizar_config,
)
from ..services.process_flow import (
    CANDIDATE_STATUS_APPROVED,
    canonicalize_candidate_status,
    is_process_closed,
)
from .bootstrap import ensure_lgpd_retention_table, ensure_notifications_table

logger = logging.getLogger(__name__)

# Tabelas que nunca são tocadas pela retenção (imutáveis ou de auditoria).
_TABELAS_PROTEGIDAS = frozenset({"logs_auditoria", "notificacoes", "lgpd_retencao_config"})
_LIMITE_POR_EXECUCAO = 500


class LgpdRetencaoRepositoryMixin:
    """Retenção automática de dados de candidatos (LGPD). Ver services/lgpd_retencao.py."""

    # ---------------------------------------------------------------- config
    def get_lgpd_retencao_config(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_lgpd_retention_table(cursor)
            cursor.execute(
                "SELECT ativo, meses_candidatura, meses_banco_talentos, dias_aviso, excluir_cvs_nao_vinculados, "
                "ultima_execucao, ultimo_resultado_json, atualizado_por, atualizado_em FROM dbo.lgpd_retencao_config WHERE id = 1"
            )
            row = cursor.fetchone()
        finally:
            conn.close()
        if not row:
            return {**normalizar_config({}), "ultima_execucao": None, "ultimo_resultado": None}
        config = normalizar_config(
            {"ativo": row[0], "meses_candidatura": row[1], "meses_banco_talentos": row[2], "dias_aviso": row[3],
             "excluir_cvs_nao_vinculados": row[4]}
        )
        try:
            resultado = json.loads(row[6]) if row[6] else None
        except ValueError:
            resultado = None
        return {
            **config,
            "ultima_execucao": row[5].isoformat() if row[5] else None,
            "ultimo_resultado": resultado,
            "atualizado_por": normalize_text(row[7]),
            "atualizado_em": row[8].isoformat() if row[8] else None,
        }

    def save_lgpd_retencao_config(self, data: dict, *, actor: str = "") -> dict:
        config = normalizar_config(data)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_lgpd_retention_table(cursor)
            cursor.execute(
                """
                MERGE dbo.lgpd_retencao_config WITH (HOLDLOCK) AS alvo
                USING (SELECT 1 AS id) AS origem ON alvo.id = origem.id
                WHEN MATCHED THEN UPDATE SET ativo = ?, meses_candidatura = ?, meses_banco_talentos = ?, dias_aviso = ?,
                    excluir_cvs_nao_vinculados = ?, atualizado_por = ?, atualizado_em = GETDATE()
                WHEN NOT MATCHED THEN INSERT (id, ativo, meses_candidatura, meses_banco_talentos, dias_aviso,
                    excluir_cvs_nao_vinculados, atualizado_por, atualizado_em)
                    VALUES (1, ?, ?, ?, ?, ?, ?, GETDATE());
                """,
                (
                    *(int(config["ativo"]), config["meses_candidatura"], config["meses_banco_talentos"], config["dias_aviso"],
                      int(config["excluir_cvs_nao_vinculados"]), normalize_text(actor)),
                ) * 2,
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_lgpd_retencao_config()

    # ------------------------------------------------------------- avaliação
    def _lgpd_candidaturas(self, cursor) -> list[dict]:
        """Uma linha por id_teste com o que as regras precisam."""
        cursor.execute(
            """
            SELECT cp.id_teste, cp.id_registro, cp.nome_candidato, cp.status_candidato, cp.data_prova,
                   ps.status AS status_processo, cm.criado_em, cm.nome_candidato AS nome_metadata
            FROM dbo.candidatos_processos cp
            LEFT JOIN dbo.candidatos_metadata cm ON cm.id_teste = cp.id_teste
            LEFT JOIN dbo.processos_seletivos ps ON ps.id_processo = cp.id_processo
            WHERE cp.id_teste IS NOT NULL AND cp.id_teste <> ''
            """
        )
        pessoas: dict[str, dict] = {}
        for id_teste, id_registro, nome, status_cand, data_prova, status_proc, criado_em, nome_meta in cursor.fetchall():
            chave = normalize_text(id_teste)
            item = pessoas.setdefault(
                chave,
                {"id_teste": chave, "id_registros": set(), "nome": normalize_text(nome_meta) or normalize_text(nome),
                 "datas": [], "contratado": False, "processo_aberto": False, "entrada_banco": None},
            )
            if id_registro is not None:
                item["id_registros"].add(int(id_registro))
            item["datas"] += [d for d in (criado_em, data_prova) if isinstance(d, datetime)]
            if canonicalize_candidate_status(status_cand) == CANDIDATE_STATUS_APPROVED:
                item["contratado"] = True
            # Processo não encontrado conta como encerrado; qualquer processo aberto protege.
            if status_proc is not None and not is_process_closed(status_proc):
                item["processo_aberto"] = True
        cursor.execute(
            """
            SELECT bt.id_teste, MAX(bt.data_movimentacao), MAX(bt.nome_candidato)
            FROM dbo.banco_talentos bt WHERE bt.id_teste IS NOT NULL AND bt.id_teste <> '' GROUP BY bt.id_teste
            """
        )
        for id_teste, entrada, nome in cursor.fetchall():
            chave = normalize_text(id_teste)
            item = pessoas.setdefault(
                chave,
                {"id_teste": chave, "id_registros": set(), "nome": normalize_text(nome), "datas": [],
                 "contratado": False, "processo_aberto": False, "entrada_banco": None},
            )
            item["entrada_banco"] = entrada if isinstance(entrada, datetime) else None
        for item in pessoas.values():
            item["data_candidatura"] = min(item["datas"]) if item["datas"] else None
        return list(pessoas.values())

    def simular_lgpd_retencao(self, *, agora: datetime | None = None) -> dict:
        """Prévia sem apagar nada: quem seria avisado e quem seria excluído hoje."""
        agora = agora or datetime.now()
        config = self.get_lgpd_retencao_config()
        conn = self._connect()
        try:
            cursor = conn.cursor()
            candidaturas = self._lgpd_candidaturas(cursor)
        finally:
            conn.close()
        excluir, avisar, protegidos = [], [], 0
        for item in candidaturas:
            resultado = avaliar(
                data_candidatura=item["data_candidatura"], entrada_banco=item["entrada_banco"], contratado=item["contratado"],
                processo_aberto=item["processo_aberto"], agora=agora, config=config,
            )
            linha = {
                "id_teste": item["id_teste"], "nome": item["nome"], "origem": resultado.get("origem"),
                "dias": resultado.get("dias"), "limite": resultado["limite"].isoformat() if resultado.get("limite") else None,
                "_avaliacao": resultado, "_id_registros": sorted(item["id_registros"]),
            }
            if resultado["situacao"] == EXCLUIR:
                excluir.append(linha)
            elif resultado["situacao"] == AVISAR:
                avisar.append(linha)
            elif resultado["situacao"] == PROTEGIDO:
                protegidos += 1
        limpar = lambda linhas: [{k: v for k, v in linha.items() if not k.startswith("_")} for linha in linhas]
        return {
            "config": config,
            "excluir": limpar(excluir),
            "avisar": limpar(avisar),
            "protegidos": protegidos,
            "total_avaliados": len(candidaturas),
            "_excluir": excluir,
            "_avisar": avisar,
        }

    # -------------------------------------------------------------- execução
    def _lgpd_tabelas_com_coluna(self, cursor, coluna: str) -> list[str]:
        cursor.execute(
            "SELECT t.name FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id WHERE c.name = ? ORDER BY t.name",
            (coluna,),
        )
        return [row[0] for row in cursor.fetchall() if row[0] not in _TABELAS_PROTEGIDAS and not row[0].startswith("monitoria")]

    def _lgpd_apagar_arquivo(self, caminho: str, raiz: str) -> bool:
        try:
            alvo = Path(caminho).resolve()
            base = Path(raiz).resolve()
            if base not in alvo.parents or not alvo.is_file():
                return False
            alvo.unlink()
            return True
        except OSError:
            return False

    def _lgpd_apagar_candidatura(self, id_teste: str, id_registros: list[int]) -> dict:
        """Apaga TUDO da candidatura: linhas com este id_teste/id_registro em
        qualquer tabela (menos auditoria e Monitoria) e os arquivos de CV em disco."""
        conn = self._connect()
        arquivos: list[str] = []
        try:
            cursor = conn.cursor()
            cursor.execute("IF OBJECT_ID('dbo.candidatos_anexos', 'U') IS NOT NULL SELECT caminho_arquivo FROM dbo.candidatos_anexos WHERE id_teste = ?", (id_teste,))
            if cursor.description:
                arquivos = [normalize_text(r[0]) for r in cursor.fetchall() if r[0]]
            linhas = 0
            if id_registros:
                marcadores = ", ".join("?" for _ in id_registros)
                cursor.execute(
                    f"IF OBJECT_ID('dbo.onboarding_candidatos_itens', 'U') IS NOT NULL "
                    f"DELETE FROM dbo.onboarding_candidatos_itens WHERE onboarding_candidato_id IN "
                    f"(SELECT id_onboarding FROM dbo.onboarding_candidatos WHERE id_registro IN ({marcadores}))",
                    tuple(id_registros),
                )
                for tabela in self._lgpd_tabelas_com_coluna(cursor, "id_registro"):
                    if tabela == "candidatos_processos":
                        continue
                    cursor.execute(f"DELETE FROM dbo.[{tabela}] WHERE id_registro IN ({marcadores})", tuple(id_registros))
                    linhas += max(0, cursor.rowcount)
            for tabela in self._lgpd_tabelas_com_coluna(cursor, "id_teste"):
                cursor.execute(f"DELETE FROM dbo.[{tabela}] WHERE id_teste = ?", (id_teste,))
                linhas += max(0, cursor.rowcount)
            conn.commit()
        finally:
            conn.close()
        apagados = sum(1 for caminho in arquivos if self._lgpd_apagar_arquivo(caminho, self.settings.public_cv_upload_dir))
        return {"linhas": linhas, "arquivos": apagados}

    def _lgpd_apagar_cvs_nao_vinculados(self, limite: datetime) -> dict:
        """CVs recebidos (pré-análise e anexos de e-mail) que nunca viraram
        candidatura e passaram do prazo."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "IF OBJECT_ID('dbo.cv_pre_analises', 'U') IS NOT NULL "
                "DELETE FROM dbo.cv_pre_analises WHERE COALESCE(criado_em, email_data) < ?",
                (limite,),
            )
            linhas = max(0, cursor.rowcount)
            conn.commit()
        finally:
            conn.close()
        arquivos = 0
        pasta = Path(getattr(self.settings, "email_inbox_attachments_dir", "") or "")
        if pasta.is_dir():
            corte = limite.timestamp()
            for caminho in pasta.rglob("*"):
                try:
                    if caminho.is_file() and os.path.getmtime(caminho) < corte:
                        caminho.unlink()
                        arquivos += 1
                except OSError:
                    continue
        return {"linhas": linhas, "arquivos": arquivos}

    def executar_lgpd_retencao(self, *, agora: datetime | None = None, forcar: bool = False, actor=None) -> dict:
        """Job diário. Desligado por padrão: só roda com a retenção ativa (ou
        forçado por quem tem permissão, com a mesma regra). Nunca apaga quem é
        contratado ou está em processo aberto."""
        agora = agora or datetime.now()
        previa = self.simular_lgpd_retencao(agora=agora)
        config = previa["config"]
        if not config["ativo"] and not forcar:
            return {"executado": False, "motivo": "Retenção automática desativada."}

        avisados = 0
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            for linha in previa["_avisar"]:
                cursor.execute(
                    "SELECT TOP 1 1 FROM dbo.notificacoes WHERE entidade = 'lgpd_retencao' AND entidade_id = ?",
                    (linha["id_teste"],),
                )
                if cursor.fetchone():
                    continue
                texto = mensagem_aviso(linha["nome"], linha["_avaliacao"])
                for papel in (ROLE_ADMIN, ROLE_MANAGER):
                    self._criar_notificacao(
                        cursor, destinatario_papel=papel, titulo="LGPD: dados serão excluídos em breve", mensagem=texto,
                        categoria="lgpd_retencao", entidade="lgpd_retencao", entidade_id=linha["id_teste"],
                    )
                avisados += 1
            conn.commit()
        finally:
            conn.close()

        excluidos, linhas, arquivos, falhas = [], 0, 0, 0
        for linha in previa["_excluir"][:_LIMITE_POR_EXECUCAO]:
            try:
                resultado = self._lgpd_apagar_candidatura(linha["id_teste"], linha["_id_registros"])
                linhas += resultado["linhas"]
                arquivos += resultado["arquivos"]
                excluidos.append(linha["id_teste"])
            except Exception:
                falhas += 1
                logger.exception("Retenção LGPD: falha ao apagar a candidatura %s.", linha["id_teste"])

        nao_vinculados = {"linhas": 0, "arquivos": 0}
        if config["excluir_cvs_nao_vinculados"]:
            from ..services.lgpd_retencao import somar_meses

            corte = somar_meses(agora, -config["meses_candidatura"])
            nao_vinculados = self._lgpd_apagar_cvs_nao_vinculados(corte)

        resultado = {
            "executado": True,
            "em": agora.isoformat(timespec="seconds"),
            "candidaturas_excluidas": len(excluidos),
            "avisos_enviados": avisados,
            "linhas_apagadas": linhas + nao_vinculados["linhas"],
            "arquivos_apagados": arquivos + nao_vinculados["arquivos"],
            "cvs_nao_vinculados_apagados": nao_vinculados["linhas"],
            "falhas": falhas,
            "pendentes_proxima_execucao": max(0, len(previa["_excluir"]) - _LIMITE_POR_EXECUCAO),
        }
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_lgpd_retention_table(cursor)
            # Upsert: a linha de configuração pode ainda não existir (valores padrão).
            cursor.execute(
                """
                MERGE dbo.lgpd_retencao_config WITH (HOLDLOCK) AS alvo
                USING (SELECT 1 AS id) AS origem ON alvo.id = origem.id
                WHEN MATCHED THEN UPDATE SET ultima_execucao = GETDATE(), ultimo_resultado_json = ?
                WHEN NOT MATCHED THEN INSERT (id, ultima_execucao, ultimo_resultado_json) VALUES (1, GETDATE(), ?);
                """,
                (json.dumps(resultado, ensure_ascii=False),) * 2,
            )
            # Auditoria sem dado pessoal: só os ids das candidaturas apagadas.
            self._insert_audit_log(
                cursor, user=actor, modulo="LGPD", acao="retencao_lgpd_automatica" if actor is None else "retencao_lgpd_manual",
                entidade="candidato", entidade_id="", valor_novo={**resultado, "ids_teste": excluidos},
                origem="job" if actor is None else "tela",
            )
            conn.commit()
        finally:
            conn.close()
        return resultado

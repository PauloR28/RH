"""Chamados: dashboard e configurações (categorias, SLA, encerramento automático, limites de anexo)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from fastapi import HTTPException, status

from ..services import chamados_regras as rg
from ..services.helpers import normalize_text
from .chamados import agora_utc

# chave -> (mínimo, máximo). Tudo o que é prazo ou limite é configurável; nada fica fixo no código.
LIMITES_CONFIG = {
    "sla_horas_critica": (0.25, 720),
    "sla_horas_alta": (0.25, 720),
    "sla_horas_media": (0.25, 720),
    "sla_horas_baixa": (0.25, 720),
    "encerramento_auto_horas": (1, 720),
    "anexo_max_mb": (1, 500),
    "anexo_max_mb_chamado": (1, 2000),
    "anexo_retencao_exclusao_dias": (1, 3650),
    "reabertura_dias": (0, 365),  # 0 desliga a reabertura
    "lembrete_email_ativo": (0, 1),
    "lembrete_sla_horas_antes": (0.25, 72),
    "lembrete_parado_horas": (1, 720),
}
ROTULO_TIPO_EMAIL = {
    "novo": "Novo chamado",
    "sla_proximo": "SLA perto de estourar",
    "sla_vencido": "SLA estourado",
    "parado": "Chamado parado há muito tempo",
    "reaberto": "Chamado reaberto",
}
_EMAIL_VALIDO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UTC_BRASILIA = timedelta(hours=-3)  # sem horário de verão desde 2019


def _http(code: int, msg: str) -> HTTPException:
    return HTTPException(status_code=code, detail=msg)


class ChamadosAdminRepositoryMixin:
    # ------------------------------------------------------------------ configurações
    def ch_config_obter(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT chave, valor FROM dbo.chamado_config")
            valores = {normalize_text(r[0]): normalize_text(r[1]) for r in cursor.fetchall()}
            cursor.execute("SELECT id_categoria, nome, ativo, ordem FROM dbo.chamado_categorias ORDER BY ordem, nome")
            categorias = [{"id": int(r[0]), "nome": normalize_text(r[1]), "ativo": bool(r[2]), "ordem": int(r[3])} for r in cursor.fetchall()]
            return {"config": {k: valores.get(k) for k in LIMITES_CONFIG}, "categorias": categorias}
        finally:
            conn.close()

    def ch_config_salvar(self, user, valores: dict) -> dict:
        limpos: dict[str, str] = {}
        for chave, bruto in valores.items():
            if chave not in LIMITES_CONFIG:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Configuração desconhecida: {chave}.")
            try:
                numero = float(bruto)
            except (TypeError, ValueError):
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Valor inválido em {chave}.")
            minimo, maximo = LIMITES_CONFIG[chave]
            if not minimo <= numero <= maximo:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{chave} deve estar entre {minimo:g} e {maximo:g}.")
            limpos[chave] = f"{numero:g}"
        if not limpos:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nada para salvar.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            for chave, valor in limpos.items():
                cursor.execute(
                    "UPDATE dbo.chamado_config SET valor = ?, atualizado_por = ?, atualizado_em = SYSUTCDATETIME() WHERE chave = ?\n"
                    "IF @@ROWCOUNT = 0 INSERT INTO dbo.chamado_config (chave, valor, atualizado_por) VALUES (?, ?, ?)",
                    (valor, user.username, chave, chave, valor, user.username),
                )
            conn.commit()
            return {"success": True, "config": limpos}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ch_categoria_salvar(self, dados: dict, id_categoria: int | None = None) -> dict:
        nome = normalize_text(dados.get("nome"))
        if id_categoria is None and not nome:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o nome da categoria.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if nome:
                cursor.execute("SELECT 1 FROM dbo.chamado_categorias WHERE nome = ? AND (? IS NULL OR id_categoria <> ?)", (nome, id_categoria, id_categoria))
                if cursor.fetchone():
                    raise _http(status.HTTP_409_CONFLICT, "Já existe uma categoria com este nome.")
            if id_categoria is None:
                cursor.execute("INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) OUTPUT INSERTED.id_categoria VALUES (?, 1, ?)",
                               (nome[:80], int(dados.get("ordem") or 50)))
                novo = int(cursor.fetchone()[0])
            else:
                cursor.execute("SELECT 1 FROM dbo.chamado_categorias WHERE id_categoria = ?", (int(id_categoria),))
                if not cursor.fetchone():
                    raise _http(status.HTTP_404_NOT_FOUND, "Categoria não encontrada.")
                sets, params = [], []
                if nome:
                    sets.append("nome = ?")
                    params.append(nome[:80])
                if dados.get("ativo") is not None:
                    sets.append("ativo = ?")
                    params.append(1 if dados["ativo"] else 0)
                if dados.get("ordem") is not None:
                    sets.append("ordem = ?")
                    params.append(int(dados["ordem"]))
                if sets:
                    cursor.execute(f"UPDATE dbo.chamado_categorias SET {', '.join(sets)} WHERE id_categoria = ?", (*params, int(id_categoria)))
                novo = int(id_categoria)
            conn.commit()
            return {"success": True, "id": novo}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------ destinatários de e-mail (alertas)
    TIPOS_EMAIL = ("novo", "sla_proximo", "sla_vencido", "parado", "reaberto")

    def ch_emails_listar(self) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_destinatario, email, nome, ativo, notif_novo, notif_sla_proximo, notif_sla_vencido, notif_parado, "
                           "notif_reaberto FROM dbo.chamado_email_destinatarios ORDER BY email")
            itens = [{"id": int(r[0]), "email": normalize_text(r[1]), "nome": normalize_text(r[2]), "ativo": bool(r[3]),
                      "tipos": {t: bool(r[4 + i]) for i, t in enumerate(self.TIPOS_EMAIL)}} for r in cursor.fetchall()]
            return {"itens": itens, "tipos": [{"chave": t, "rotulo": ROTULO_TIPO_EMAIL[t]} for t in self.TIPOS_EMAIL]}
        finally:
            conn.close()

    def ch_email_salvar(self, user, dados: dict, id_destinatario: int | None = None) -> dict:
        email = normalize_text(dados.get("email")).lower()
        if id_destinatario is None and not _EMAIL_VALIDO.match(email):
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe um e-mail válido.")
        tipos = dados.get("tipos") or {}
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if id_destinatario is None:
                cursor.execute("SELECT 1 FROM dbo.chamado_email_destinatarios WHERE email = ?", (email,))
                if cursor.fetchone():
                    raise _http(status.HTTP_409_CONFLICT, "Este e-mail já está na lista.")
                padrao = {"novo": 0, "sla_proximo": 1, "sla_vencido": 1, "parado": 1, "reaberto": 0}
                valores = [1 if tipos.get(t, bool(padrao[t])) else 0 for t in self.TIPOS_EMAIL]
                cursor.execute(
                    "INSERT INTO dbo.chamado_email_destinatarios (email, nome, ativo, notif_novo, notif_sla_proximo, notif_sla_vencido, notif_parado, "
                    "notif_reaberto, criado_por) OUTPUT INSERTED.id_destinatario VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)",
                    (email[:180], normalize_text(dados.get("nome"))[:120] or None, *valores, user.username))
                novo = int(cursor.fetchone()[0])
            else:
                sets, params = [], []
                if dados.get("ativo") is not None:
                    sets.append("ativo = ?")
                    params.append(1 if dados["ativo"] else 0)
                if dados.get("nome") is not None:
                    sets.append("nome = ?")
                    params.append(normalize_text(dados["nome"])[:120] or None)
                for t in self.TIPOS_EMAIL:
                    if t in tipos:
                        sets.append(f"notif_{t} = ?")
                        params.append(1 if tipos[t] else 0)
                if sets:
                    cursor.execute(f"UPDATE dbo.chamado_email_destinatarios SET {', '.join(sets)} WHERE id_destinatario = ?", (*params, int(id_destinatario)))
                    if cursor.rowcount == 0:
                        raise _http(status.HTTP_404_NOT_FOUND, "Destinatário não encontrado.")
                novo = int(id_destinatario)
            conn.commit()
            return {"success": True, "id": novo}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ch_email_remover(self, id_destinatario: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM dbo.chamado_email_destinatarios WHERE id_destinatario = ?", (int(id_destinatario),))
            if cursor.rowcount == 0:
                raise _http(status.HTTP_404_NOT_FOUND, "Destinatário não encontrado.")
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------ dashboard
    def ch_dashboard(self, dias: int = 30) -> dict:
        dias = dias if dias in (7, 30, 90) else 30
        agora = agora_utc()
        fim_do_dia_utc = (agora + UTC_BRASILIA).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1) - UTC_BRASILIA
        desde = agora - timedelta(days=dias)
        conn = self._connect()
        try:
            cursor = conn.cursor()

            def contar(cond: str, *params) -> int:
                cursor.execute(f"SELECT COUNT(*) FROM dbo.chamados c WHERE {cond}", params)
                return int(cursor.fetchone()[0])

            ativos = "c.status IN ('aberto','em_andamento','aguardando_solicitante')"
            kpis = {
                "sla_vencido": contar("c.status IN ('aberto','em_andamento') AND c.prazo_sla < ?", agora),
                "vencem_hoje": contar("c.status IN ('aberto','em_andamento') AND c.prazo_sla >= ? AND c.prazo_sla < ?", agora, fim_do_dia_utc),
                "abertos": contar("c.status = 'aberto'"),
                "aguardando_solicitante": contar("c.status = 'aguardando_solicitante'"),
                "sem_responsavel": contar(f"c.id_responsavel IS NULL AND {ativos}"),
            }

            def agrupar(sql: str, *params) -> list[dict]:
                cursor.execute(sql, params)
                return [{"chave": normalize_text(r[0]), "rotulo": normalize_text(r[1]), "total": int(r[2])} for r in cursor.fetchall()]

            nao_encerrados = "c.status NOT IN ('encerrado','cancelado') AND c.criado_em >= ?"
            por_status = agrupar(f"SELECT c.status, c.status, COUNT(*) FROM dbo.chamados c WHERE {nao_encerrados} GROUP BY c.status", desde)
            for item in por_status:
                item["rotulo"] = rg.ROTULO_STATUS.get(item["chave"], item["chave"])
            por_status.sort(key=lambda i: rg.STATUS.index(i["chave"]) if i["chave"] in rg.STATUS else 99)
            por_operacao = agrupar(
                "SELECT c.operacao, ISNULL(o.nome, c.operacao), COUNT(*) FROM dbo.chamados c LEFT JOIN dbo.operacoes o ON o.chave = c.operacao "
                "WHERE c.status <> 'cancelado' AND c.criado_em >= ? GROUP BY c.operacao, ISNULL(o.nome, c.operacao) ORDER BY 3 DESC", desde)
            por_urgencia = agrupar("SELECT c.urgencia, c.urgencia, COUNT(*) FROM dbo.chamados c WHERE c.status <> 'cancelado' AND c.criado_em >= ? GROUP BY c.urgencia", desde)
            for item in por_urgencia:
                item["rotulo"] = rg.ROTULO_URGENCIA.get(item["chave"], item["chave"])
            por_urgencia.sort(key=lambda i: -rg.ORDEM_URGENCIA.get(i["chave"], 0))
            por_categoria = agrupar(
                "SELECT CAST(k.id_categoria AS NVARCHAR(20)), k.nome, COUNT(*) FROM dbo.chamados c JOIN dbo.chamado_categorias k ON k.id_categoria = c.id_categoria "
                "WHERE c.status <> 'cancelado' AND c.criado_em >= ? GROUP BY k.id_categoria, k.nome ORDER BY 3 DESC", desde)
            # Por solicitante (quem abriu): ranking do período, com quantos foram reabertos.
            cursor.execute(
                "SELECT TOP 15 c.id_solicitante, c.solicitante_nome, COUNT(*), SUM(CASE WHEN c.reaberto_vezes > 0 THEN 1 ELSE 0 END) "
                "FROM dbo.chamados c WHERE c.status <> 'cancelado' AND c.criado_em >= ? GROUP BY c.id_solicitante, c.solicitante_nome ORDER BY 3 DESC, 2", desde)
            por_solicitante = [{"chave": str(r[0]), "rotulo": normalize_text(r[1]), "total": int(r[2]), "reabertos": int(r[3] or 0)} for r in cursor.fetchall()]
            # Reabertos: o chamado reaberto continua sendo UM chamado; aqui contamos chamados do período que tiveram ao menos uma reabertura.
            cursor.execute("SELECT COUNT(*), SUM(CASE WHEN c.reaberto_vezes > 0 THEN 1 ELSE 0 END), ISNULL(SUM(c.reaberto_vezes), 0) "
                           "FROM dbo.chamados c WHERE c.status <> 'cancelado' AND c.criado_em >= ?", desde)
            total_periodo, reabertos_total, reaberturas = cursor.fetchone()
            total_periodo, reabertos_total = int(total_periodo or 0), int(reabertos_total or 0)
            reabertos = {
                "total": reabertos_total,
                "reaberturas": int(reaberturas or 0),
                "taxa": round(100 * reabertos_total / total_periodo, 1) if total_periodo else 0.0,
                "por_categoria": agrupar(
                    "SELECT CAST(k.id_categoria AS NVARCHAR(20)), k.nome, COUNT(*) FROM dbo.chamados c JOIN dbo.chamado_categorias k ON k.id_categoria = c.id_categoria "
                    "WHERE c.reaberto_vezes > 0 AND c.status <> 'cancelado' AND c.criado_em >= ? GROUP BY k.id_categoria, k.nome ORDER BY 3 DESC", desde),
                "por_solicitante": agrupar(
                    "SELECT TOP 10 CAST(c.id_solicitante AS NVARCHAR(20)), c.solicitante_nome, COUNT(*) FROM dbo.chamados c "
                    "WHERE c.reaberto_vezes > 0 AND c.status <> 'cancelado' AND c.criado_em >= ? GROUP BY c.id_solicitante, c.solicitante_nome ORDER BY 3 DESC", desde),
            }
            kpis["reabertos"] = reabertos_total
            return {"dias": dias, "kpis": kpis, "por_status": por_status, "por_operacao": por_operacao,
                    "por_urgencia": por_urgencia, "por_categoria": por_categoria, "por_solicitante": por_solicitante, "reabertos": reabertos}
        finally:
            conn.close()

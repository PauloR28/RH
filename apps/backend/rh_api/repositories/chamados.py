"""Chamados (Suporte TI): regras de acesso, criação, atendimento, timeline, anexos e jobs.

Toda permissão é checada AQUI (e nas rotas), nunca só no frontend. Datas em UTC (naive, `DATETIME2`), serializadas com `Z`.
O escopo de operação é lido do banco a cada chamada (`usuarios_operacoes`), não do token: trocar o vínculo vale na hora.
Diferente de outros módulos, usuário SEM vínculo de operação não vê nada (exceto perfis globais).
"""

from __future__ import annotations

import html
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_MANAGER, ROLE_OPERATOR
from ..services import chamados_regras as rg
from ..services import chamados_storage as st
from ..services.helpers import clamp_limit, normalize_text, rows_to_dicts

PERFIS_GLOBAIS = frozenset({ROLE_ADMIN, ROLE_MANAGER})
CATEGORIA_NOTIFICACAO = "chamados"
FASES = {
    "aberto": (rg.ABERTO, rg.EM_ANDAMENTO, rg.AGUARDANDO),
    "resolvidos": (rg.RESOLVIDO,),
    "historico": (rg.ENCERRADO, rg.CANCELADO),
}
_ORDEM_URGENCIA_SQL = "CASE c.urgencia WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END"
MAX_MENSAGEM = 8000


def _http(code: int, msg: str) -> HTTPException:
    return HTTPException(status_code=code, detail=msg)


def agora_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(valor: Any) -> str | None:
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor.replace(microsecond=0).isoformat() + "Z"
    return str(valor)


def _nome_usuario(user) -> str:
    return (" ".join(p for p in (normalize_text(getattr(user, "nome", "")), normalize_text(getattr(user, "sobrenome", ""))) if p)
            or normalize_text(getattr(user, "username", "")))


class ChamadosRepositoryMixin:
    # ------------------------------------------------------------------ contexto e acesso
    def _ch_config(self, cursor) -> dict:
        cursor.execute("SELECT chave, valor FROM dbo.chamado_config")
        cfg = {normalize_text(r[0]): normalize_text(r[1]) for r in cursor.fetchall()}

        def num(chave: str, padrao: float) -> float:
            try:
                return float(cfg.get(chave, padrao))
            except ValueError:
                return float(padrao)

        return {
            "sla_horas": {rg.CRITICA: num("sla_horas_critica", 2), rg.ALTA: num("sla_horas_alta", 4),
                          rg.MEDIA: num("sla_horas_media", 8), rg.BAIXA: num("sla_horas_baixa", 24)},
            "encerramento_auto_horas": num("encerramento_auto_horas", 48),
            "anexo_max_mb": int(num("anexo_max_mb", 25)),
            "anexo_max_mb_chamado": int(num("anexo_max_mb_chamado", 100)),
            "anexo_retencao_exclusao_dias": int(num("anexo_retencao_exclusao_dias", 30)),
            "reabertura_dias": num("reabertura_dias", 7),
            "lembrete_email_ativo": num("lembrete_email_ativo", 1) > 0,
            "lembrete_sla_horas_antes": num("lembrete_sla_horas_antes", 1),
            "lembrete_parado_horas": num("lembrete_parado_horas", 72),
        }

    def _ch_operacoes_do_usuario(self, cursor, user) -> list[dict]:
        """Operações em que o usuário pode abrir/ver chamados: [{chave, nome}]. Global = todas as ativas."""
        if user.perfil in PERFIS_GLOBAIS:
            cursor.execute("SELECT chave, nome FROM dbo.operacoes WHERE ativo = 1 AND chave IS NOT NULL ORDER BY nome")
        elif user.id_usuario:
            cursor.execute(
                "SELECT uo.operacao, ISNULL(o.nome, uo.operacao) FROM dbo.usuarios_operacoes uo "
                "LEFT JOIN dbo.operacoes o ON o.chave = uo.operacao WHERE uo.id_usuario = ? ORDER BY 2",
                (int(user.id_usuario),),
            )
        else:
            return []
        return [{"chave": normalize_text(r[0]), "nome": normalize_text(r[1])} for r in cursor.fetchall() if normalize_text(r[0])]

    def _ch_exigir_usuario(self, user) -> int:
        if not user.id_usuario:
            raise _http(status.HTTP_403_FORBIDDEN, "Esta conta não está vinculada a um usuário do Conecta.")
        return int(user.id_usuario)

    def _ch_pode_ver(self, user, ch: dict, operacoes: set[str], *, global_: bool) -> bool:
        uid = int(user.id_usuario or 0)
        if uid and ch["id_solicitante"] == uid:
            return True  # quem abriu sempre vê, mesmo sem permissão
        if user.has_permission("chamados.atender"):
            return True
        if uid and ch["id_responsavel"] == uid:
            return True
        return user.has_permission("chamados.ver_operacao") and (global_ or ch["operacao"] in operacoes)

    def _ch_carregar(self, cursor, id_chamado: int) -> dict:
        cursor.execute(
            "SELECT c.id_chamado, c.numero, c.titulo, c.descricao, c.id_categoria, k.nome AS categoria, c.operacao, "
            "c.id_solicitante, c.solicitante_nome, c.solicitante_email, c.solicitante_cargo, c.id_responsavel, "
            "(SELECT TOP 1 LTRIM(RTRIM(ISNULL(r.nome,'') + ' ' + ISNULL(r.sobrenome,''))) FROM dbo.usuarios r WHERE r.id_usuario = c.id_responsavel) AS responsavel_nome, "
            "c.tipo_impacto, c.pa_posto, c.pa_parada, c.urgencia, c.urgencia_solicitada, c.status, c.prazo_sla, c.sla_pausado_seg, "
            "c.sla_pausa_inicio, c.resolvido_em, c.encerrado_em, c.encerramento_automatico, c.resolvido_remotamente, c.reaberto_vezes, "
            "c.reaberto_ultimo_em, c.criado_em, c.atualizado_em "
            "FROM dbo.chamados c JOIN dbo.chamado_categorias k ON k.id_categoria = c.id_categoria WHERE c.id_chamado = ?",
            (int(id_chamado),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise _http(status.HTTP_404_NOT_FOUND, "Chamado não encontrado.")
        return rows[0]

    def _ch_acesso(self, cursor, user, id_chamado: int) -> tuple[dict, bool]:
        """Carrega o chamado e garante que o usuário pode vê-lo. Fora do escopo = 404 (não revela que existe)."""
        ch = self._ch_carregar(cursor, id_chamado)
        global_ = user.perfil in PERFIS_GLOBAIS
        operacoes = {o["chave"] for o in self._ch_operacoes_do_usuario(cursor, user)} if not global_ else set()
        if not self._ch_pode_ver(user, ch, operacoes, global_=global_):
            if not any(p.startswith("chamados.") for p in user.permissions):
                raise _http(status.HTTP_403_FORBIDDEN, "Você não possui permissão para acessar esta área ou executar esta ação.")
            raise _http(status.HTTP_404_NOT_FOUND, "Chamado não encontrado.")
        return ch, global_

    # ------------------------------------------------------------------ serialização
    def _ch_item(self, ch: dict, agora: datetime, *, agentes: list[dict] | None = None) -> dict:
        sla = rg.estado_sla(status=ch["status"], prazo_sla=ch["prazo_sla"], pausa_inicio=ch.get("sla_pausa_inicio"), agora=agora)
        return {
            "id": int(ch["id_chamado"]),
            "numero": int(ch["numero"]),
            "titulo": ch["titulo"],
            "categoria": ch.get("categoria"),
            "operacao": ch["operacao"],
            "solicitante": {"id": ch["id_solicitante"], "nome": ch["solicitante_nome"], "email": ch.get("solicitante_email"),
                            "cargo": ch.get("solicitante_cargo")},
            "responsavel": ({"id": ch["id_responsavel"], "nome": normalize_text(ch.get("responsavel_nome"))} if ch.get("id_responsavel") else None),
            "tipo_impacto": ch["tipo_impacto"],
            "pa_posto": ch.get("pa_posto"),
            "pa_parada": bool(ch["pa_parada"]),
            "urgencia": ch["urgencia"],
            "urgencia_rotulo": rg.ROTULO_URGENCIA[ch["urgencia"]],
            "status": ch["status"],
            "status_rotulo": rg.ROTULO_STATUS[ch["status"]],
            "prazo_sla": iso(ch["prazo_sla"]),
            "sla": sla,
            "agentes": agentes if agentes is not None else [],
            "agentes_total": len(agentes) if agentes is not None else int(ch.get("agentes_total") or 0),
            "resolvido_em": iso(ch.get("resolvido_em")),
            "encerrado_em": iso(ch.get("encerrado_em")),
            "encerramento_automatico": bool(ch.get("encerramento_automatico")),
            "resolvido_remotamente": bool(ch.get("resolvido_remotamente")),
            "reaberto_vezes": int(ch.get("reaberto_vezes") or 0),
            "reaberto_ultimo_em": iso(ch.get("reaberto_ultimo_em")),
            "criado_em": iso(ch["criado_em"]),
            "atualizado_em": iso(ch["atualizado_em"]),
        }

    def _ch_agentes(self, cursor, id_chamado: int) -> list[dict]:
        cursor.execute(
            "SELECT u.id_usuario, LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))), u.email "
            "FROM dbo.chamado_agentes a JOIN dbo.usuarios u ON u.id_usuario = a.id_usuario WHERE a.id_chamado = ? ORDER BY 2",
            (int(id_chamado),),
        )
        return [{"id": int(r[0]), "nome": normalize_text(r[1]), "email": normalize_text(r[2])} for r in cursor.fetchall()]

    def _ch_acoes(self, user, ch: dict, reabertura_dias: float | None = None) -> dict:
        """O que ESTE usuário pode fazer agora neste chamado (o frontend só desenha; o backend revalida cada ação)."""
        uid = int(user.id_usuario or 0)
        solicitante = bool(uid) and ch["id_solicitante"] == uid
        atende = user.has_permission("chamados.atender")
        s = ch["status"]
        final = s in rg.STATUS_FINAIS
        comenta = not final and (solicitante or atende or user.has_permission("chamados.ver_operacao") or ch["id_responsavel"] == uid)
        return {
            "comentar": comenta,
            "assumir": atende and s in (rg.ABERTO, rg.EM_ANDAMENTO, rg.AGUARDANDO) and ch["id_responsavel"] != uid,
            "atribuir": user.has_permission("chamados.atribuir") and not final,
            "mudar_status": rg.destinos_do_atendente(s) if atende else [],
            "alterar_urgencia": atende and not final,
            "cancelar": solicitante and s == rg.ABERTO,
            "confirmar_encerramento": solicitante and s == rg.RESOLVIDO,
            "reabrir": solicitante and (
                s == rg.RESOLVIDO if reabertura_dias is None else
                rg.reabertura_permitida(status=s, resolvido_em=ch.get("resolvido_em"), encerrado_em=ch.get("encerrado_em"),
                                        agora=agora_utc(), dias=reabertura_dias)),
            "excluir_anexo": not final or user.has_permission("chamados.configurar"),
        }

    # ------------------------------------------------------------------ timeline e notificação
    def _ch_evento(self, cursor, id_chamado: int, tipo: str, *, user=None, conteudo: str = "", dados: dict | None = None) -> int:
        cursor.execute(
            "INSERT INTO dbo.chamado_eventos (id_chamado, id_autor, autor_nome, tipo, conteudo, dados_json) "
            "OUTPUT INSERTED.id_evento VALUES (?, ?, ?, ?, ?, ?)",
            (int(id_chamado), int(user.id_usuario) if user is not None and user.id_usuario else None,
             _nome_usuario(user) if user is not None else None, tipo, conteudo or None,
             json.dumps(dados, ensure_ascii=False) if dados else None),
        )
        return int(cursor.fetchone()[0])

    def _ch_perfis_da_ti(self, cursor) -> list[str]:
        """Perfis que atendem chamados (têm `chamados.atender`), mais o Administrador (que acompanha todos os chamados)."""
        cursor.execute("SELECT id_perfil FROM dbo.perfil_permissoes WHERE chave_permissao = 'chamados.atender' AND permitido = 1")
        perfis = {normalize_text(r[0]) for r in cursor.fetchall()}
        perfis.add(ROLE_ADMIN)
        return sorted(p for p in perfis if p)

    def _ch_login_de(self, cursor, id_usuario: int | None) -> str:
        if not id_usuario:
            return ""
        cursor.execute("SELECT login FROM dbo.usuarios WHERE id_usuario = ?", (int(id_usuario),))
        row = cursor.fetchone()
        return normalize_text(row[0]) if row else ""

    def _ch_notificar(self, cursor, ch: dict, *, titulo: str, mensagem: str, para: str, ignorar_id: int | None = None) -> None:
        """para: 'solicitante' | 'responsavel' | 'ti' (responsável se houver, senão toda a TI) | 'ti_todos'."""
        alvos_usuario: list[str] = []
        alvos_papel: list[str] = []
        if para == "solicitante":
            alvos_usuario.append(self._ch_login_de(cursor, ch["id_solicitante"]))
        elif para == "responsavel":
            alvos_usuario.append(self._ch_login_de(cursor, ch["id_responsavel"]))
        elif para == "ti":
            if ch.get("id_responsavel"):
                alvos_usuario.append(self._ch_login_de(cursor, ch["id_responsavel"]))
            else:
                alvos_papel = self._ch_perfis_da_ti(cursor)
        else:
            alvos_papel = self._ch_perfis_da_ti(cursor)
            if ch.get("id_responsavel"):
                alvos_usuario.append(self._ch_login_de(cursor, ch["id_responsavel"]))
        if ignorar_id:
            ignorado = self._ch_login_de(cursor, ignorar_id)
            alvos_usuario = [a for a in alvos_usuario if a != ignorado]
        for login in {a for a in alvos_usuario if a}:
            self._criar_notificacao(cursor, destinatario_usuario=login, titulo=titulo, mensagem=mensagem,
                                    categoria=CATEGORIA_NOTIFICACAO, entidade="chamado", entidade_id=str(ch["id_chamado"]))
        for papel in alvos_papel:
            self._criar_notificacao(cursor, destinatario_papel=papel, titulo=titulo, mensagem=mensagem,
                                    categoria=CATEGORIA_NOTIFICACAO, entidade="chamado", entidade_id=str(ch["id_chamado"]))

    # ------------------------------------------------------------------ anexos
    def _ch_salvar_anexos(self, cursor, ch_id: int, arquivos: list[tuple[str, bytes]], user, cfg: dict, *, id_evento: int | None,
                          gravados: list[str]) -> list[dict]:
        if not arquivos:
            return []
        limite = cfg["anexo_max_mb"] * 1024 * 1024
        validados = [st.validar_anexo(nome, conteudo, max_bytes=limite) for nome, conteudo in arquivos]
        cursor.execute("SELECT ISNULL(SUM(tamanho),0) FROM dbo.chamado_anexos WHERE id_chamado = ? AND excluido_em IS NULL", (int(ch_id),))
        usado = int(cursor.fetchone()[0])
        if usado + sum(v.tamanho for v in validados) > cfg["anexo_max_mb_chamado"] * 1024 * 1024:
            raise _http(status.HTTP_400_BAD_REQUEST, f"Limite de {cfg['anexo_max_mb_chamado']} MB de anexos por chamado excedido.")
        provider = st.provider_padrao(self.settings)
        salvos = []
        for v in validados:
            chave = st.nova_chave(v.extensao)
            provider.put(chave, v.conteudo)
            gravados.append(chave)
            cursor.execute(
                "INSERT INTO dbo.chamado_anexos (id_chamado, id_evento, nome_original, mime, tamanho, sha256, chave_storage, provider, enviado_por) "
                "OUTPUT INSERTED.id_anexo VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (int(ch_id), id_evento, v.nome_original, v.mime, v.tamanho, v.sha256, chave, provider.nome,
                 int(user.id_usuario) if user.id_usuario else None),
            )
            salvos.append({"id": int(cursor.fetchone()[0]), "nome": v.nome_original, "mime": v.mime, "tamanho": v.tamanho})
        return salvos

    def _ch_limpar_gravados(self, gravados: list[str]) -> None:
        provider = st.provider_padrao(self.settings)
        for chave in gravados:
            try:
                provider.delete(chave)
            except Exception:
                self.logger.exception("Falha ao remover anexo órfão de chamado: %s", chave)

    # ------------------------------------------------------------------ transições
    def _ch_aplicar_status(self, cursor, ch: dict, destino: str, ator: str, user, *, conteudo: str = "", automatico: bool = False) -> dict:
        origem = ch["status"]
        if not rg.transicao_valida(origem, destino, ator):
            raise _http(status.HTTP_409_CONFLICT,
                        f"Transição não permitida: {rg.ROTULO_STATUS[origem]} → {rg.ROTULO_STATUS[destino]}.")
        agora = agora_utc()
        sets = ["status = ?", "atualizado_em = ?"]
        params: list = [destino, agora]
        if destino == rg.AGUARDANDO:
            sets.append("sla_pausa_inicio = ?")
            params.append(agora)
        if origem == rg.AGUARDANDO and ch.get("sla_pausa_inicio"):
            novo_prazo, seg = rg.encerrar_pausa(ch["prazo_sla"], ch["sla_pausa_inicio"], agora)
            sets += ["prazo_sla = ?", "sla_pausado_seg = sla_pausado_seg + ?", "sla_pausa_inicio = NULL",
                     "sla_aviso_notificado_em = NULL", "sla_vencido_notificado_em = NULL"]
            params += [novo_prazo, seg]
        if destino == rg.RESOLVIDO:
            sets.append("resolvido_em = ?")
            params.append(agora)
        reabrindo = origem in (rg.RESOLVIDO, rg.ENCERRADO) and destino == rg.EM_ANDAMENTO
        if reabrindo:
            horas = self._ch_config(cursor)["sla_horas"][ch["urgencia"]]
            sets += ["resolvido_em = NULL", "encerrado_em = NULL", "encerramento_automatico = 0", "prazo_sla = ?",
                     "sla_aviso_notificado_em = NULL", "sla_vencido_notificado_em = NULL", "parado_notificado_em = NULL",
                     "reaberto_vezes = reaberto_vezes + 1", "reaberto_ultimo_em = ?"]
            params += [rg.calcular_prazo(agora, horas), agora]
        if destino == rg.ENCERRADO:
            sets += ["encerrado_em = ?", "encerramento_automatico = ?"]
            params += [agora, 1 if automatico else 0]
        params += [int(ch["id_chamado"]), origem]
        cursor.execute(f"UPDATE dbo.chamados SET {', '.join(sets)} WHERE id_chamado = ? AND status = ?", tuple(params))
        if cursor.rowcount == 0:
            raise _http(status.HTTP_409_CONFLICT, "O chamado foi alterado por outra pessoa. Atualize a tela e tente novamente.")
        self._ch_evento(cursor, ch["id_chamado"], "reabertura" if reabrindo else "status", user=None if automatico else user,
                        conteudo=conteudo, dados={"de": origem, "para": destino, "automatico": automatico})
        return self._ch_carregar(cursor, ch["id_chamado"])

    def _ch_exigir_solicitante(self, user, ch: dict) -> None:
        if not user.id_usuario or ch["id_solicitante"] != int(user.id_usuario):
            raise _http(status.HTTP_403_FORBIDDEN, "Somente quem abriu o chamado pode executar esta ação.")

    # ------------------------------------------------------------------ meta
    def ch_meta(self, user) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cfg = self._ch_config(cursor)
            cursor.execute("SELECT id_categoria, nome FROM dbo.chamado_categorias WHERE ativo = 1 ORDER BY ordem, nome")
            categorias = [{"id": int(r[0]), "nome": normalize_text(r[1])} for r in cursor.fetchall()]
            return {
                "categorias": categorias,
                "urgencias": [{"valor": u, "rotulo": rg.ROTULO_URGENCIA[u], "horas": cfg["sla_horas"][u]} for u in rg.URGENCIAS],
                "status": [{"valor": s, "rotulo": rg.ROTULO_STATUS[s]} for s in rg.STATUS],
                "reabertura_dias": cfg["reabertura_dias"],
                "anexo_max_mb": cfg["anexo_max_mb"],
                "anexo_max_mb_chamado": cfg["anexo_max_mb_chamado"],
                "anexo_tipos": sorted(st.TIPOS),
                "operacoes": self._ch_operacoes_do_usuario(cursor, user),
                "permissoes": {k: user.has_permission(f"chamados.{k}") for k in
                               ("abrir", "ver_operacao", "atender", "atribuir", "dashboard", "configurar")},
            }
        finally:
            conn.close()

    # ------------------------------------------------------------------ criação
    def ch_criar(self, user, dados: dict, arquivos: list[tuple[str, bytes]]) -> dict:
        uid = self._ch_exigir_usuario(user)
        titulo = normalize_text(dados.get("titulo"))
        descricao = normalize_text(dados.get("descricao"))
        if not titulo or not descricao:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o título e a descrição do chamado.")
        impacto = normalize_text(dados.get("tipo_impacto")).lower()
        urgencia = normalize_text(dados.get("urgencia")).lower()
        if impacto not in rg.IMPACTOS or urgencia not in rg.URGENCIAS:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Tipo de impacto ou urgência inválidos.")
        pa_parada = bool(dados.get("pa_parada"))
        pa_posto = normalize_text(dados.get("pa_posto"))
        agentes_ids = sorted({int(a) for a in (dados.get("agentes_ids") or [])})
        # Agentes impactados são opcionais (a tela de abertura não pede mais); o que importa é o PA/posto afetado.
        if impacto != rg.IMPACTO_AGENTE:
            agentes_ids = []  # célula inteira dispensa agentes; o PA/posto é sempre opcional
        gravados: list[str] = []
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ops = self._ch_operacoes_do_usuario(cursor, user)
            chaves = [o["chave"] for o in ops]
            if not chaves:
                raise _http(status.HTTP_403_FORBIDDEN, "Você não está vinculado a nenhuma operação. Peça ao administrador para vinculá-lo.")
            operacao = normalize_text(dados.get("operacao"))
            if not operacao:
                if len(chaves) == 1:
                    operacao = chaves[0]
                else:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha a operação do chamado.")
            if operacao not in chaves:
                raise _http(status.HTTP_403_FORBIDDEN, "Você não pertence a esta operação.")
            cursor.execute("SELECT 1 FROM dbo.chamado_categorias WHERE id_categoria = ? AND ativo = 1", (int(dados.get("categoria_id") or 0),))
            if not cursor.fetchone():
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Categoria inválida.")
            if agentes_ids:
                marcadores = ",".join("?" * len(agentes_ids))
                cursor.execute(
                    f"SELECT COUNT(*) FROM dbo.usuarios u WHERE u.id_usuario IN ({marcadores}) AND u.perfil_id = ? AND u.status = 'Ativo' "
                    f"AND EXISTS (SELECT 1 FROM dbo.usuarios_operacoes uo WHERE uo.id_usuario = u.id_usuario AND uo.operacao = ?)",
                    (*agentes_ids, ROLE_OPERATOR, operacao),
                )
                if int(cursor.fetchone()[0]) != len(agentes_ids):
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Todos os agentes devem ser operadores ativos da operação escolhida.")
            cursor.execute("SELECT nome, sobrenome, email, cargo FROM dbo.usuarios WHERE id_usuario = ?", (uid,))
            u = cursor.fetchone()
            sol_nome = (" ".join(p for p in (normalize_text(u[0]), normalize_text(u[1])) if p) if u else "") or _nome_usuario(user)
            cfg = self._ch_config(cursor)
            efetiva, elevada = rg.aplicar_piso_urgencia(urgencia, pa_parada=pa_parada, tipo_impacto=impacto)
            agora = agora_utc()
            prazo = rg.calcular_prazo(agora, cfg["sla_horas"][efetiva])
            cursor.execute(
                "INSERT INTO dbo.chamados (titulo, descricao, id_categoria, operacao, id_solicitante, solicitante_nome, solicitante_email, "
                "solicitante_cargo, tipo_impacto, pa_posto, pa_parada, urgencia, urgencia_solicitada, status, prazo_sla, criado_em, atualizado_em) "
                "OUTPUT INSERTED.id_chamado VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (titulo[:160], descricao, int(dados["categoria_id"]), operacao, uid, sol_nome[:180],
                 (normalize_text(u[2]) if u else normalize_text(user.email)) or None, (normalize_text(u[3]) if u else "") or None,
                 impacto, pa_posto[:40] or None, 1 if pa_parada else 0, efetiva, urgencia, rg.ABERTO, prazo, agora, agora),
            )
            id_chamado = int(cursor.fetchone()[0])
            for a in agentes_ids:
                cursor.execute("INSERT INTO dbo.chamado_agentes (id_chamado, id_usuario) VALUES (?, ?)", (id_chamado, a))
            self._ch_evento(cursor, id_chamado, "sistema", user=user, conteudo="Chamado aberto.",
                            dados={"urgencia": efetiva, "urgencia_solicitada": urgencia})
            if elevada:
                self._ch_evento(cursor, id_chamado, "urgencia",
                                conteudo=f"Urgência elevada para {rg.ROTULO_URGENCIA[efetiva]}: PA parada ou impacto coletivo exige no mínimo Alta.",
                                dados={"de": urgencia, "para": efetiva, "regra": "piso"})
            id_evento = self._ch_evento(cursor, id_chamado, "anexo", user=user, conteudo="Anexos enviados na abertura.") if arquivos else None
            self._ch_salvar_anexos(cursor, id_chamado, arquivos, user, cfg, id_evento=id_evento, gravados=gravados)
            ch = self._ch_carregar(cursor, id_chamado)
            destaque = [t for t, ativo in (("Crítica", efetiva == rg.CRITICA), ("PA parada", pa_parada), ("Impacto coletivo", impacto == rg.IMPACTO_CELULA)) if ativo]
            self._ch_notificar(
                cursor, ch,
                titulo=f"Novo chamado #{ch['numero']}" + (f" · {' · '.join(destaque)}" if destaque else ""),
                mensagem=f"{titulo} ({ch['operacao']}), aberto por {sol_nome}.", para="ti_todos",
            )
            conn.commit()
            self._ch_enviar_email("novo", f"Novo chamado #{ch['numero']}" + (f" · {' · '.join(destaque)}" if destaque else ""),
                                  f"{titulo} ({ch['operacao']}), aberto por {sol_nome}.\nUrgência: {rg.ROTULO_URGENCIA[efetiva]}.")
            self._ch_confirmar_abertura(ch, (normalize_text(u[2]) if u else "") or normalize_text(user.email), rg.ROTULO_URGENCIA[efetiva])
            return {"id": id_chamado, "numero": int(ch["numero"]), "urgencia": efetiva, "urgencia_elevada": elevada,
                    "prazo_sla": iso(ch["prazo_sla"])}
        except Exception:
            conn.rollback()
            self._ch_limpar_gravados(gravados)
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------ listagens
    def _ch_filtros_sql(self, f: dict, where: list[str], params: list, agora: datetime) -> None:
        if f.get("fase") in FASES:
            lista = FASES[f["fase"]]
            where.append(f"c.status IN ({','.join('?' * len(lista))})")
            params.extend(lista)
        if f.get("status"):
            if f["status"] not in rg.STATUS:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Status inválido.")
            where.append("c.status = ?")
            params.append(f["status"])
        if f.get("urgencia"):
            if f["urgencia"] not in rg.URGENCIAS:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Urgência inválida.")
            where.append("c.urgencia = ?")
            params.append(f["urgencia"])
        if f.get("categoria_id"):
            where.append("c.id_categoria = ?")
            params.append(int(f["categoria_id"]))
        if f.get("operacao"):
            where.append("c.operacao = ?")
            params.append(normalize_text(f["operacao"]))
        if f.get("sem_responsavel"):
            where.append("c.id_responsavel IS NULL AND c.status IN ('aberto','em_andamento','aguardando_solicitante')")
        if f.get("responsavel_id"):
            where.append("c.id_responsavel = ?")
            params.append(int(f["responsavel_id"]))
        if f.get("vencidos"):
            where.append("c.status IN ('aberto','em_andamento') AND c.prazo_sla < ?")
            params.append(agora)
        if f.get("de"):
            where.append("c.criado_em >= ?")
            params.append(f["de"])
        if f.get("ate"):
            where.append("c.criado_em < ?")
            params.append(f["ate"])
        q = normalize_text(f.get("q"))
        if q:
            if q.lstrip("#").isdigit():
                where.append("c.numero = ?")
                params.append(int(q.lstrip("#")))
            else:
                where.append("c.titulo LIKE ?")
                params.append(f"%{q}%")

    def _ch_consulta(self, cursor, where: list[str], params: list, ordem: str, page: int, page_size: int, agora: datetime) -> dict:
        w = " AND ".join(where) if where else "1=1"
        cursor.execute(f"SELECT COUNT(*) FROM dbo.chamados c WHERE {w}", tuple(params))
        total = int(cursor.fetchone()[0])
        page = max(1, int(page or 1))
        page_size = clamp_limit(page_size, 20, 100)
        cursor.execute(
            "SELECT c.id_chamado, c.numero, c.titulo, k.nome AS categoria, c.operacao, c.id_solicitante, c.solicitante_nome, c.solicitante_email, "
            "c.solicitante_cargo, c.id_responsavel, "
            "(SELECT TOP 1 LTRIM(RTRIM(ISNULL(r.nome,'') + ' ' + ISNULL(r.sobrenome,''))) FROM dbo.usuarios r WHERE r.id_usuario = c.id_responsavel) AS responsavel_nome, "
            "c.tipo_impacto, c.pa_posto, c.pa_parada, c.urgencia, c.status, c.prazo_sla, c.sla_pausa_inicio, c.resolvido_em, c.encerrado_em, "
            "c.encerramento_automatico, c.resolvido_remotamente, c.reaberto_vezes, c.reaberto_ultimo_em, c.criado_em, c.atualizado_em, "
            "(SELECT COUNT(*) FROM dbo.chamado_agentes a WHERE a.id_chamado = c.id_chamado) AS agentes_total, "
            "(SELECT TOP 1 LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))) FROM dbo.chamado_agentes a JOIN dbo.usuarios u ON u.id_usuario = a.id_usuario "
            " WHERE a.id_chamado = c.id_chamado ORDER BY u.nome) AS agente_primeiro "
            f"FROM dbo.chamados c JOIN dbo.chamado_categorias k ON k.id_categoria = c.id_categoria WHERE {w} "
            f"ORDER BY {ordem} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",
            (*params, (page - 1) * page_size, page_size),
        )
        itens = []
        for row in rows_to_dicts(cursor, cursor.fetchall()):
            item = self._ch_item(row, agora)
            item["agente_primeiro"] = normalize_text(row.get("agente_primeiro"))
            itens.append(item)
        return {"itens": itens, "total": total, "page": page, "page_size": page_size}

    def _ch_resumo(self, cursor, where: list[str], params: list, agora: datetime, uid: int) -> dict:
        w = " AND ".join(where) if where else "1=1"
        inicio_mes = agora.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cursor.execute(
            f"SELECT c.status, COUNT(*) FROM dbo.chamados c WHERE {w} GROUP BY c.status", tuple(params))
        por_status = {normalize_text(r[0]): int(r[1]) for r in cursor.fetchall()}
        cursor.execute(
            f"SELECT COUNT(*) FROM dbo.chamados c WHERE {w} AND c.resolvido_em >= ?", (*params, inicio_mes))
        resolvidos_mes = int(cursor.fetchone()[0])
        fases = {nome: sum(por_status.get(s, 0) for s in lista) for nome, lista in FASES.items()}
        return {"por_status": por_status, "fases": fases, "resolvidos_mes": resolvidos_mes}

    def ch_listar(self, user, filtros: dict, *, escopo: str = "meus", page: int = 1, page_size: int = 20) -> dict:
        uid = self._ch_exigir_usuario(user)
        agora = agora_utc()
        conn = self._connect()
        try:
            cursor = conn.cursor()
            where: list[str] = []
            params: list = []
            if escopo == "operacao":
                if not user.has_permission("chamados.ver_operacao"):
                    raise _http(status.HTTP_403_FORBIDDEN, "Você não tem permissão para ver os chamados da operação.")
                if user.perfil not in PERFIS_GLOBAIS:
                    chaves = [o["chave"] for o in self._ch_operacoes_do_usuario(cursor, user)]
                    if not chaves:
                        return {"itens": [], "total": 0, "page": 1, "page_size": clamp_limit(page_size, 20, 100),
                                "resumo": {"por_status": {}, "fases": {k: 0 for k in FASES}, "resolvidos_mes": 0}}
                    where.append(f"c.operacao IN ({','.join('?' * len(chaves))})")
                    params.extend(chaves)
            else:
                where.append("c.id_solicitante = ?")
                params.append(uid)
            resumo = self._ch_resumo(cursor, list(where), list(params), agora, uid)
            self._ch_filtros_sql(filtros, where, params, agora)
            resultado = self._ch_consulta(cursor, where, params, "c.atualizado_em DESC, c.id_chamado DESC", page, page_size, agora)
            resultado["resumo"] = resumo
            return resultado
        finally:
            conn.close()

    def ch_fila(self, user, filtros: dict, *, page: int = 1, page_size: int = 20) -> dict:
        agora = agora_utc()
        conn = self._connect()
        try:
            cursor = conn.cursor()
            where: list[str] = []
            params: list = []
            if not filtros.get("status") and not filtros.get("fase"):
                where.append("c.status NOT IN ('encerrado','cancelado')")
            resumo = self._ch_resumo(cursor, [], [], agora, int(user.id_usuario or 0))
            self._ch_filtros_sql(filtros, where, params, agora)
            ordem = (f"CASE WHEN c.status IN ('aberto','em_andamento') AND c.prazo_sla < ? THEN 0 ELSE 1 END, {_ORDEM_URGENCIA_SQL}, c.prazo_sla ASC")
            w = " AND ".join(where) if where else "1=1"
            # O parâmetro do ORDER BY entra depois dos do WHERE (ordem de aparição no SQL).
            cursor.execute(f"SELECT COUNT(*) FROM dbo.chamados c WHERE {w}", tuple(params))
            total = int(cursor.fetchone()[0])
            page = max(1, int(page or 1))
            page_size = clamp_limit(page_size, 20, 100)
            cursor.execute(
                "SELECT c.id_chamado, c.numero, c.titulo, k.nome AS categoria, c.operacao, c.id_solicitante, c.solicitante_nome, c.solicitante_email, "
                "c.solicitante_cargo, c.id_responsavel, "
                "(SELECT TOP 1 LTRIM(RTRIM(ISNULL(r.nome,'') + ' ' + ISNULL(r.sobrenome,''))) FROM dbo.usuarios r WHERE r.id_usuario = c.id_responsavel) AS responsavel_nome, "
                "c.tipo_impacto, c.pa_posto, c.pa_parada, c.urgencia, c.status, c.prazo_sla, c.sla_pausa_inicio, c.resolvido_em, c.encerrado_em, "
                "c.encerramento_automatico, c.criado_em, c.atualizado_em, "
                "(SELECT COUNT(*) FROM dbo.chamado_agentes a WHERE a.id_chamado = c.id_chamado) AS agentes_total "
                f"FROM dbo.chamados c JOIN dbo.chamado_categorias k ON k.id_categoria = c.id_categoria WHERE {w} "
                f"ORDER BY {ordem} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",
                (*params, agora, (page - 1) * page_size, page_size),
            )
            itens = [self._ch_item(r, agora) for r in rows_to_dicts(cursor, cursor.fetchall())]
            sem_resp = self._ch_contar(cursor, "c.id_responsavel IS NULL AND c.status IN ('aberto','em_andamento','aguardando_solicitante')")
            resumo["sem_responsavel"] = sem_resp
            return {"itens": itens, "total": total, "page": page, "page_size": page_size, "resumo": resumo}
        finally:
            conn.close()

    def _ch_contar(self, cursor, condicao: str, params: tuple = ()) -> int:
        cursor.execute(f"SELECT COUNT(*) FROM dbo.chamados c WHERE {condicao}", params)
        return int(cursor.fetchone()[0])

    # ------------------------------------------------------------------ detalhe e timeline
    def ch_detalhe(self, user, id_chamado: int) -> dict:
        agora = agora_utc()
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            item = self._ch_item(ch, agora, agentes=self._ch_agentes(cursor, id_chamado))
            item["descricao"] = ch["descricao"]
            item["urgencia_solicitada"] = ch["urgencia_solicitada"]
            item["sla_pausado_seg"] = int(ch["sla_pausado_seg"] or 0)
            item["acoes"] = self._ch_acoes(user, ch, self._ch_config(cursor)["reabertura_dias"])
            cursor.execute(
                "SELECT id_anexo, nome_original, mime, tamanho, criado_em, enviado_por FROM dbo.chamado_anexos "
                "WHERE id_chamado = ? AND excluido_em IS NULL ORDER BY id_anexo", (int(id_chamado),))
            item["anexos"] = [{"id": int(r[0]), "nome": r[1], "mime": r[2], "tamanho": int(r[3]), "criado_em": iso(r[4]),
                               "enviado_por": r[5], "inline": r[2] in st.MIMES_INLINE} for r in cursor.fetchall()]
            return item
        finally:
            conn.close()

    def ch_eventos(self, user, id_chamado: int, *, antes_de: int | None = None, limite: int = 50) -> dict:
        limite = clamp_limit(limite, 50, 200)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._ch_acesso(cursor, user, id_chamado)
            params: list = [int(id_chamado)]
            filtro = ""
            if antes_de:
                filtro = " AND e.id_evento < ?"
                params.append(int(antes_de))
            cursor.execute(
                f"SELECT TOP ({limite + 1}) e.id_evento, e.id_autor, e.autor_nome, e.tipo, e.conteudo, e.dados_json, e.criado_em "
                f"FROM dbo.chamado_eventos e WHERE e.id_chamado = ?{filtro} ORDER BY e.id_evento DESC", tuple(params))
            linhas = rows_to_dicts(cursor, cursor.fetchall())
            tem_mais = len(linhas) > limite
            linhas = list(reversed(linhas[:limite]))
            ids = [int(r["id_evento"]) for r in linhas]
            anexos: dict[int, list] = {}
            if ids:
                cursor.execute(
                    f"SELECT id_evento, id_anexo, nome_original, mime, tamanho FROM dbo.chamado_anexos WHERE excluido_em IS NULL "
                    f"AND id_evento IN ({','.join('?' * len(ids))})", tuple(ids))
                for r in cursor.fetchall():
                    anexos.setdefault(int(r[0]), []).append({"id": int(r[1]), "nome": r[2], "mime": r[3], "tamanho": int(r[4])})
            eventos = []
            for r in linhas:
                eventos.append({
                    "id": int(r["id_evento"]), "tipo": r["tipo"], "autor_id": r["id_autor"], "autor_nome": r["autor_nome"] or "Sistema",
                    "conteudo": r["conteudo"] or "", "dados": json.loads(r["dados_json"]) if r["dados_json"] else None,
                    "criado_em": iso(r["criado_em"]), "anexos": anexos.get(int(r["id_evento"]), []),
                })
            return {"eventos": eventos, "tem_mais": tem_mais, "proximo_cursor": eventos[0]["id"] if eventos and tem_mais else None}
        finally:
            conn.close()

    # ------------------------------------------------------------------ ações
    def ch_mensagem(self, user, id_chamado: int, conteudo: str, arquivos: list[tuple[str, bytes]]) -> dict:
        texto = normalize_text(conteudo)
        if not texto and not arquivos:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escreva uma mensagem ou anexe um arquivo.")
        if len(texto) > MAX_MENSAGEM:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mensagem muito longa.")
        gravados: list[str] = []
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            if not self._ch_acoes(user, ch)["comentar"]:
                raise _http(status.HTTP_409_CONFLICT if ch["status"] in rg.STATUS_FINAIS else status.HTTP_403_FORBIDDEN,
                            "Não é possível comentar neste chamado.")
            uid = int(user.id_usuario)
            solicitante = ch["id_solicitante"] == uid
            cfg = self._ch_config(cursor)
            id_evento = self._ch_evento(cursor, id_chamado, "mensagem", user=user, conteudo=texto)
            self._ch_salvar_anexos(cursor, id_chamado, arquivos, user, cfg, id_evento=id_evento, gravados=gravados)
            if solicitante and ch["status"] == rg.AGUARDANDO:
                ch = self._ch_aplicar_status(cursor, ch, rg.EM_ANDAMENTO, rg.ATOR_SOLICITANTE, user, conteudo="Solicitante respondeu.")
            elif not solicitante and user.has_permission("chamados.atender"):
                if ch["status"] == rg.ABERTO:
                    cursor.execute("UPDATE dbo.chamados SET id_responsavel = ISNULL(id_responsavel, ?) WHERE id_chamado = ?", (uid, int(id_chamado)))
                    ch = self._ch_aplicar_status(cursor, self._ch_carregar(cursor, id_chamado), rg.EM_ANDAMENTO, rg.ATOR_ATENDENTE, user)
            cursor.execute("UPDATE dbo.chamados SET atualizado_em = ? WHERE id_chamado = ?", (agora_utc(), int(id_chamado)))
            ch = self._ch_carregar(cursor, id_chamado)
            if solicitante:
                self._ch_notificar(cursor, ch, titulo=f"Nova mensagem no chamado #{ch['numero']}", mensagem=f"{_nome_usuario(user)}: {texto[:140]}", para="ti", ignorar_id=uid)
            else:
                self._ch_notificar(cursor, ch, titulo=f"Nova mensagem no chamado #{ch['numero']}", mensagem=f"Suporte TI: {texto[:140]}", para="solicitante", ignorar_id=uid)
            conn.commit()
            return {"success": True, "id_evento": id_evento, "status": ch["status"]}
        except Exception:
            conn.rollback()
            self._ch_limpar_gravados(gravados)
            raise
        finally:
            conn.close()

    def ch_assumir(self, user, id_chamado: int) -> dict:
        uid = self._ch_exigir_usuario(user)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            if ch["status"] not in (rg.ABERTO, rg.EM_ANDAMENTO, rg.AGUARDANDO):
                raise _http(status.HTTP_409_CONFLICT, "Este chamado não pode mais ser assumido.")
            if ch["id_responsavel"] == uid:
                raise _http(status.HTTP_409_CONFLICT, "Você já é o responsável por este chamado.")
            anterior = ch["id_responsavel"]
            cursor.execute("UPDATE dbo.chamados SET id_responsavel = ?, atualizado_em = ? WHERE id_chamado = ?", (uid, agora_utc(), int(id_chamado)))
            self._ch_evento(cursor, id_chamado, "atribuicao", user=user, conteudo=f"{_nome_usuario(user)} assumiu o chamado.",
                            dados={"de": anterior, "para": uid})
            ch = self._ch_carregar(cursor, id_chamado)
            if ch["status"] == rg.ABERTO:
                ch = self._ch_aplicar_status(cursor, ch, rg.EM_ANDAMENTO, rg.ATOR_ATENDENTE, user)
            self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} em atendimento", mensagem=f"{_nome_usuario(user)} assumiu seu chamado.",
                               para="solicitante", ignorar_id=uid)
            conn.commit()
            return {"success": True, "status": ch["status"]}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ch_atribuir(self, user, id_chamado: int, id_responsavel: int) -> dict:
        self._ch_exigir_usuario(user)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            if ch["status"] in rg.STATUS_FINAIS:
                raise _http(status.HTTP_409_CONFLICT, "Chamado encerrado ou cancelado não pode ser atribuído.")
            cursor.execute(
                "SELECT LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))) FROM dbo.usuarios u WHERE u.id_usuario = ? AND u.status = 'Ativo' "
                "AND EXISTS (SELECT 1 FROM dbo.perfil_permissoes p WHERE p.id_perfil = u.perfil_id AND p.chave_permissao = 'chamados.atender' AND p.permitido = 1)",
                (int(id_responsavel),))
            alvo = cursor.fetchone()
            if not alvo:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O responsável precisa ser um usuário ativo com permissão de atender chamados.")
            anterior = ch["id_responsavel"]
            cursor.execute("UPDATE dbo.chamados SET id_responsavel = ?, atualizado_em = ? WHERE id_chamado = ?", (int(id_responsavel), agora_utc(), int(id_chamado)))
            self._ch_evento(cursor, id_chamado, "atribuicao", user=user, conteudo=f"Chamado atribuído a {normalize_text(alvo[0])}.",
                            dados={"de": anterior, "para": int(id_responsavel)})
            ch = self._ch_carregar(cursor, id_chamado)
            self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} atribuído a você", mensagem=ch["titulo"], para="responsavel", ignorar_id=int(user.id_usuario))
            self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} com novo responsável", mensagem=f"{normalize_text(alvo[0])} agora cuida do seu chamado.",
                               para="solicitante", ignorar_id=int(user.id_usuario))
            conn.commit()
            return {"success": True}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ch_mudar_status(self, user, id_chamado: int, destino: str, justificativa: str = "", resolvido_remotamente: bool = False) -> dict:
        uid = self._ch_exigir_usuario(user)
        destino = normalize_text(destino).lower()
        if destino not in rg.STATUS:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Status inválido.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            if destino == rg.EM_ANDAMENTO and ch["status"] == rg.ABERTO and not ch["id_responsavel"]:
                cursor.execute("UPDATE dbo.chamados SET id_responsavel = ? WHERE id_chamado = ?", (uid, int(id_chamado)))
            ch = self._ch_aplicar_status(cursor, ch, destino, rg.ATOR_ATENDENTE, user, conteudo=normalize_text(justificativa))
            if destino == rg.RESOLVIDO:
                remoto = bool(resolvido_remotamente)
                cursor.execute("UPDATE dbo.chamados SET resolvido_remotamente = ? WHERE id_chamado = ?", (1 if remoto else 0, int(id_chamado)))
                if remoto:
                    self._ch_evento(cursor, id_chamado, "sistema", user=user, conteudo="Resolvido remotamente.", dados={"resolvido_remotamente": True})
                self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} resolvido", mensagem="Confirme se o problema foi solucionado.", para="solicitante", ignorar_id=uid)
            elif destino == rg.AGUARDANDO:
                self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} aguarda sua resposta", mensagem=normalize_text(justificativa) or "O suporte pediu mais informações.", para="solicitante", ignorar_id=uid)
            else:
                self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']}: {rg.ROTULO_STATUS[destino]}", mensagem=ch["titulo"], para="solicitante", ignorar_id=uid)
            conn.commit()
            return {"success": True, "status": ch["status"]}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ch_mudar_urgencia(self, user, id_chamado: int, urgencia: str, justificativa: str = "") -> dict:
        self._ch_exigir_usuario(user)
        urgencia = normalize_text(urgencia).lower()
        if urgencia not in rg.URGENCIAS:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Urgência inválida.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            if ch["status"] in rg.STATUS_FINAIS or ch["status"] == rg.RESOLVIDO:
                raise _http(status.HTTP_409_CONFLICT, "Não é possível alterar a urgência deste chamado.")
            piso = rg.urgencia_minima(pa_parada=bool(ch["pa_parada"]), tipo_impacto=ch["tipo_impacto"])
            if rg.ORDEM_URGENCIA[urgencia] < rg.ORDEM_URGENCIA[piso]:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"PA parada ou impacto coletivo exige urgência mínima {rg.ROTULO_URGENCIA[piso]}.")
            if urgencia == ch["urgencia"]:
                return {"success": True, "urgencia": urgencia}
            cfg = self._ch_config(cursor)
            prazo = rg.calcular_prazo(ch["criado_em"], cfg["sla_horas"][urgencia], ch["sla_pausado_seg"])
            cursor.execute("UPDATE dbo.chamados SET urgencia = ?, prazo_sla = ?, atualizado_em = ?, sla_aviso_notificado_em = NULL, "
                           "sla_vencido_notificado_em = NULL WHERE id_chamado = ?", (urgencia, prazo, agora_utc(), int(id_chamado)))
            self._ch_evento(cursor, id_chamado, "urgencia", user=user,
                            conteudo=f"Urgência alterada de {rg.ROTULO_URGENCIA[ch['urgencia']]} para {rg.ROTULO_URGENCIA[urgencia]}."
                            + (f" Motivo: {normalize_text(justificativa)}" if normalize_text(justificativa) else ""),
                            dados={"de": ch["urgencia"], "para": urgencia})
            self._ch_notificar(cursor, self._ch_carregar(cursor, id_chamado), titulo=f"Chamado #{ch['numero']}: urgência alterada",
                               mensagem=f"Nova urgência: {rg.ROTULO_URGENCIA[urgencia]}.", para="solicitante", ignorar_id=int(user.id_usuario))
            conn.commit()
            return {"success": True, "urgencia": urgencia, "prazo_sla": iso(prazo)}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ch_cancelar(self, user, id_chamado: int, motivo: str = "") -> dict:
        return self._ch_acao_solicitante(user, id_chamado, rg.CANCELADO, motivo, "cancelado", exigir_motivo=False)

    def ch_confirmar(self, user, id_chamado: int) -> dict:
        return self._ch_acao_solicitante(user, id_chamado, rg.ENCERRADO, "Solução confirmada pelo solicitante.", "encerrado")

    def ch_reabrir(self, user, id_chamado: int, motivo: str) -> dict:
        """Reabre o MESMO chamado (mesmo id/número): só quem abriu, Resolvido ou Encerrado, dentro da janela `reabertura_dias`
        e com um comentário dizendo o que continua errado. Fica no histórico como evento `reabertura`."""
        uid = self._ch_exigir_usuario(user)
        motivo = normalize_text(motivo)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            self._ch_exigir_solicitante(user, ch)
            if not motivo:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o que continua acontecendo para reabrir o chamado.")
            dias = self._ch_config(cursor)["reabertura_dias"]
            if ch["status"] not in (rg.RESOLVIDO, rg.ENCERRADO):
                raise _http(status.HTTP_409_CONFLICT, "Só é possível reabrir um chamado resolvido ou encerrado.")
            if not rg.reabertura_permitida(status=ch["status"], resolvido_em=ch.get("resolvido_em"), encerrado_em=ch.get("encerrado_em"),
                                           agora=agora_utc(), dias=dias):
                raise _http(status.HTTP_409_CONFLICT, f"O prazo de reabertura ({dias:g} dias) terminou. Abra um novo chamado.")
            ch = self._ch_aplicar_status(cursor, ch, rg.EM_ANDAMENTO, rg.ATOR_SOLICITANTE, user, conteudo=motivo)
            self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} reaberto", mensagem=motivo, para="ti_todos", ignorar_id=uid)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        self._ch_enviar_email("reaberto", f"Chamado #{ch['numero']} reaberto",
                              f"{ch['titulo']} ({ch['operacao']}) foi reaberto por {_nome_usuario(user)}.\n\nMotivo: {motivo}")
        return {"success": True, "status": ch["status"], "reaberto_vezes": int(ch.get("reaberto_vezes") or 0)}

    def ch_historico(self, user, id_chamado: int) -> dict:
        """Histórico completo: a abertura aparece SEMPRE; as movimentações (status, atribuição, urgência, reabertura, sistema) só se
        existirem. Mensagens e anexos ficam na conversa, não aqui."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            cursor.execute(
                "SELECT e.id_evento, e.tipo, e.id_autor, e.autor_nome, e.conteudo, e.dados_json, e.criado_em FROM dbo.chamado_eventos e "
                "WHERE e.id_chamado = ? AND e.tipo IN ('status','atribuicao','urgencia','reabertura','sistema') "
                "AND NOT (e.tipo = 'sistema' AND e.conteudo = 'Chamado aberto.') ORDER BY e.id_evento", (int(id_chamado),))
            movimentacoes = [{
                "id": int(r["id_evento"]), "tipo": r["tipo"], "por": {"id": r["id_autor"], "nome": r["autor_nome"] or "Sistema"},
                "em": iso(r["criado_em"]), "descricao": r["conteudo"] or "", "dados": json.loads(r["dados_json"]) if r["dados_json"] else None,
            } for r in rows_to_dicts(cursor, cursor.fetchall())]
            return {
                "abertura": {"em": iso(ch["criado_em"]), "por": {"id": ch["id_solicitante"], "nome": ch["solicitante_nome"]}, "operacao": ch["operacao"]},
                "reaberto_vezes": int(ch.get("reaberto_vezes") or 0),
                "movimentacoes": movimentacoes,
            }
        finally:
            conn.close()

    # ------------------------------------------------------------------ e-mails de alerta (configuráveis em Configurações)
    _EMAIL_COLUNAS = {"novo": "notif_novo", "sla_proximo": "notif_sla_proximo", "sla_vencido": "notif_sla_vencido",
                      "parado": "notif_parado", "reaberto": "notif_reaberto"}

    def _ch_enviar_email(self, tipo: str, assunto: str, corpo: str) -> int:
        """Envia aos destinatários ativos que assinaram `tipo`. Nunca derruba a operação: SMTP ausente ou falha só é registrado no log."""
        coluna = self._EMAIL_COLUNAS.get(tipo)
        if not coluna:
            return 0
        try:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                if not self._ch_config(cursor)["lembrete_email_ativo"]:
                    return 0
                cursor.execute(f"SELECT email FROM dbo.chamado_email_destinatarios WHERE ativo = 1 AND {coluna} = 1")
                emails = [normalize_text(r[0]) for r in cursor.fetchall() if normalize_text(r[0])]
                if not emails:
                    cursor.execute("SELECT COUNT(*) FROM dbo.chamado_email_destinatarios WHERE ativo = 1")
                    if int(cursor.fetchone()[0]) == 0:  # ninguém cadastrado: usa a TI; destinatário que desmarcou o tipo não cai aqui
                        emails = self._ch_emails_da_ti(cursor)
            finally:
                conn.close()
            if not emails:
                self.logger.warning("E-mail de chamado (%s) sem destinatário: cadastre em Suporte TI > Configurações ou vincule e-mail aos usuários da TI.", tipo)
                return 0
            self._ch_disparar_email(emails, f"[Suporte TI] {assunto}", corpo)
            return len(emails)
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("E-mail de chamado (%s) não enviado: %s", tipo, exc)
            return 0

    def _ch_emails_da_ti(self, cursor) -> list[str]:
        """Fallback quando nenhum destinatário foi cadastrado: e-mail dos usuários ativos dos perfis que atendem chamados."""
        perfis = self._ch_perfis_da_ti(cursor)
        if not perfis:
            return []
        cursor.execute(
            f"SELECT DISTINCT email FROM dbo.usuarios WHERE status = 'Ativo' AND ISNULL(email,'') <> '' AND perfil_id IN ({','.join('?' * len(perfis))})",
            tuple(perfis),
        )
        return [normalize_text(r[0]) for r in cursor.fetchall() if normalize_text(r[0])]

    def _ch_disparar_email(self, emails: list[str], assunto: str, corpo: str) -> None:
        """Envia pelo canal disponível: Microsoft Graph (caixa oficial, o mesmo da Monitoria) e, se não estiver configurado, SMTP.
        Levanta exceção quando nenhum canal está pronto; quem chama decide se isso é só log."""
        from ..services.email_send_service import EmailSendService

        servico = EmailSendService(self.settings)
        if servico.configured:
            corpo_html = "".join(f"<p>{html.escape(linha)}</p>" for linha in corpo.split("\n") if linha.strip())
            servico.send_mail(destinatarios=emails, assunto=assunto, corpo_html=corpo_html)
            return
        self.send_internal_alert_email(destinatarios=emails, assunto=assunto, mensagem=corpo)

    def _ch_confirmar_abertura(self, ch: dict, email: str, urgencia_rotulo: str) -> bool:
        """E-mail de confirmação para quem abriu o chamado (best-effort: falha só vai para o log)."""
        email = normalize_text(email)
        if not email:
            self.logger.warning("Chamado #%s aberto sem e-mail do solicitante: confirmação não enviada.", ch.get("numero"))
            return False
        base = normalize_text(getattr(self.settings, "public_frontend_base_url", "")).rstrip("/")
        corpo = (f"CHAMADO #{ch['numero']} - Aberto\nDescrição: {ch['titulo']}\nUrgência: {urgencia_rotulo}\n"
                 "A equipe de TI foi avisada. Você recebe uma notificação a cada atualização.")
        if base:
            corpo += f"\nAcompanhe: {base}/suporte-ti/chamado/{ch['id_chamado']}"
        try:
            self._ch_disparar_email([email], f"[Suporte TI] Chamado #{ch['numero']} aberto", corpo)
            return True
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("Confirmação de abertura do chamado #%s não enviada a %s: %s", ch.get("numero"), email, exc)
            return False

    def _ch_acao_solicitante(self, user, id_chamado: int, destino: str, motivo: str, rotulo: str, exigir_motivo: bool = False) -> dict:
        self._ch_exigir_usuario(user)
        motivo = normalize_text(motivo)
        if exigir_motivo and not motivo:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o motivo da reabertura.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ch, _ = self._ch_acesso(cursor, user, id_chamado)
            self._ch_exigir_solicitante(user, ch)
            ch = self._ch_aplicar_status(cursor, ch, destino, rg.ATOR_SOLICITANTE, user, conteudo=motivo)
            if destino == rg.EM_ANDAMENTO:
                self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} reaberto", mensagem=motivo, para="ti", ignorar_id=int(user.id_usuario))
            elif destino == rg.ENCERRADO:
                self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} encerrado", mensagem="O solicitante confirmou a solução.", para="responsavel", ignorar_id=int(user.id_usuario))
            conn.commit()
            return {"success": True, "status": ch["status"]}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------ anexos (download e exclusão)
    def ch_anexo_abrir(self, user, id_anexo: int):
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_chamado, nome_original, mime, chave_storage FROM dbo.chamado_anexos WHERE id_anexo = ? AND excluido_em IS NULL", (int(id_anexo),))
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
            self._ch_acesso(cursor, user, int(row[0]))
            return st.provider_padrao(self.settings).open(normalize_text(row[3])), normalize_text(row[1]), normalize_text(row[2])
        finally:
            conn.close()

    def ch_anexo_excluir(self, user, id_anexo: int) -> dict:
        uid = self._ch_exigir_usuario(user)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_chamado, nome_original, enviado_por FROM dbo.chamado_anexos WHERE id_anexo = ? AND excluido_em IS NULL", (int(id_anexo),))
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
            ch, _ = self._ch_acesso(cursor, user, int(row[0]))
            if ch["status"] in rg.STATUS_FINAIS and not user.has_permission("chamados.configurar"):
                raise _http(status.HTTP_409_CONFLICT, "Anexos de chamados encerrados não podem ser apagados.")
            if row[2] != uid and not user.has_permission("chamados.atender"):
                raise _http(status.HTTP_403_FORBIDDEN, "Você só pode remover anexos que enviou.")
            cursor.execute("UPDATE dbo.chamado_anexos SET excluido_em = ?, excluido_por = ? WHERE id_anexo = ?", (agora_utc(), uid, int(id_anexo)))
            self._ch_evento(cursor, ch["id_chamado"], "anexo", user=user, conteudo=f"Anexo removido: {normalize_text(row[1])}.")
            conn.commit()
            return {"success": True}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------ buscas
    def ch_buscar_agentes(self, user, operacao: str, q: str, limite: int = 10) -> list[dict]:
        termo = normalize_text(q)
        if len(termo) < 2:
            return []
        conn = self._connect()
        try:
            cursor = conn.cursor()
            chaves = [o["chave"] for o in self._ch_operacoes_do_usuario(cursor, user)]
            operacao = normalize_text(operacao)
            if operacao not in chaves:
                raise _http(status.HTTP_403_FORBIDDEN, "Você não pertence a esta operação.")
            like = f"%{termo}%"
            cursor.execute(
                f"SELECT TOP ({clamp_limit(limite, 10, 20)}) u.id_usuario, LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))), u.email "
                "FROM dbo.usuarios u WHERE u.perfil_id = ? AND u.status = 'Ativo' "
                "AND EXISTS (SELECT 1 FROM dbo.usuarios_operacoes uo WHERE uo.id_usuario = u.id_usuario AND uo.operacao = ?) "
                "AND (u.nome LIKE ? OR u.sobrenome LIKE ? OR u.email LIKE ? OR (ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,'')) LIKE ?) ORDER BY u.nome",
                (ROLE_OPERATOR, operacao, like, like, like, like))
            return [{"id": int(r[0]), "nome": normalize_text(r[1]), "email": normalize_text(r[2])} for r in cursor.fetchall()]
        finally:
            conn.close()

    def ch_buscar_atendentes(self, q: str = "", limite: int = 20) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            like = f"%{normalize_text(q)}%"
            cursor.execute(
                f"SELECT TOP ({clamp_limit(limite, 20, 50)}) u.id_usuario, LTRIM(RTRIM(ISNULL(u.nome,'') + ' ' + ISNULL(u.sobrenome,''))), u.email "
                "FROM dbo.usuarios u WHERE u.status = 'Ativo' "
                "AND EXISTS (SELECT 1 FROM dbo.perfil_permissoes p WHERE p.id_perfil = u.perfil_id AND p.chave_permissao = 'chamados.atender' AND p.permitido = 1) "
                "AND (u.nome LIKE ? OR u.sobrenome LIKE ? OR u.email LIKE ?) ORDER BY u.nome", (like, like, like))
            return [{"id": int(r[0]), "nome": normalize_text(r[1]), "email": normalize_text(r[2])} for r in cursor.fetchall()]
        finally:
            conn.close()

    # ------------------------------------------------------------------ jobs
    def ch_processar_prazos(self) -> dict:
        """Roda a cada 15 min. Idempotente: encerra Resolvidos vencidos, avisa SLA estourado/vencendo e remove fisicamente anexos
        apagados há mais que a retenção. Chamados aguardando o solicitante (SLA pausado) não entram."""
        agora = agora_utc()
        resultado = {"encerrados": 0, "sla_vencidos": 0, "sla_a_vencer": 0, "parados": 0, "anexos_removidos": 0}
        emails: list[tuple[str, str, str]] = []  # (tipo, assunto, corpo): enviados depois do commit; falha de SMTP nunca desfaz o job
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cfg = self._ch_config(cursor)
            corte = agora - timedelta(hours=cfg["encerramento_auto_horas"])
            cursor.execute("SELECT id_chamado FROM dbo.chamados WHERE status = 'resolvido' AND resolvido_em <= ?", (corte,))
            for (idc,) in cursor.fetchall():
                try:
                    ch = self._ch_aplicar_status(cursor, self._ch_carregar(cursor, int(idc)), rg.ENCERRADO, rg.ATOR_SISTEMA, None,
                                                 conteudo=f"Encerrado automaticamente: sem validação em {int(cfg['encerramento_auto_horas'])} h.", automatico=True)
                    self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} encerrado automaticamente", mensagem="Não houve validação no prazo.", para="solicitante")
                    conn.commit()
                    resultado["encerrados"] += 1
                except HTTPException:
                    conn.rollback()
            cursor.execute("SELECT id_chamado FROM dbo.chamados WHERE status IN ('aberto','em_andamento') AND prazo_sla < ? AND sla_vencido_notificado_em IS NULL", (agora,))
            for (idc,) in cursor.fetchall():
                cursor.execute("UPDATE dbo.chamados SET sla_vencido_notificado_em = ? WHERE id_chamado = ? AND sla_vencido_notificado_em IS NULL", (agora, int(idc)))
                if cursor.rowcount:
                    ch = self._ch_carregar(cursor, int(idc))
                    self._ch_evento(cursor, ch["id_chamado"], "sistema", conteudo="SLA estourado.")
                    self._ch_notificar(cursor, ch, titulo=f"SLA estourado: chamado #{ch['numero']}", mensagem=ch["titulo"], para="ti_todos")
                    emails.append(("sla_vencido", f"SLA estourado: chamado #{ch['numero']}", f"{ch['titulo']} ({ch['operacao']}) passou do prazo de SLA."))
                    resultado["sla_vencidos"] += 1
            conn.commit()
            cursor.execute("SELECT id_chamado FROM dbo.chamados WHERE status IN ('aberto','em_andamento') AND prazo_sla >= ? AND prazo_sla < ? "
                           "AND sla_aviso_notificado_em IS NULL", (agora, agora + timedelta(hours=cfg["lembrete_sla_horas_antes"])))
            for (idc,) in cursor.fetchall():
                cursor.execute("UPDATE dbo.chamados SET sla_aviso_notificado_em = ? WHERE id_chamado = ? AND sla_aviso_notificado_em IS NULL", (agora, int(idc)))
                if cursor.rowcount:
                    ch = self._ch_carregar(cursor, int(idc))
                    horas = f"{cfg['lembrete_sla_horas_antes']:g}"
                    self._ch_notificar(cursor, ch, titulo=f"SLA vence em menos de {horas} h: chamado #{ch['numero']}", mensagem=ch["titulo"], para="ti_todos")
                    emails.append(("sla_proximo", f"SLA perto de estourar: chamado #{ch['numero']}",
                                   f"{ch['titulo']} ({ch['operacao']}) vence em menos de {horas} h."))
                    resultado["sla_a_vencer"] += 1
            conn.commit()
            # Chamados abertos/em andamento sem nenhuma movimentação há `lembrete_parado_horas`: um aviso por período de inatividade.
            parado_desde = agora - timedelta(hours=cfg["lembrete_parado_horas"])
            cursor.execute("SELECT id_chamado FROM dbo.chamados WHERE status IN ('aberto','em_andamento') AND atualizado_em < ? "
                           "AND (parado_notificado_em IS NULL OR parado_notificado_em < atualizado_em)", (parado_desde,))
            for (idc,) in cursor.fetchall():
                cursor.execute("UPDATE dbo.chamados SET parado_notificado_em = ? WHERE id_chamado = ?", (agora, int(idc)))
                ch = self._ch_carregar(cursor, int(idc))
                self._ch_notificar(cursor, ch, titulo=f"Chamado #{ch['numero']} parado há dias", mensagem=ch["titulo"], para="ti_todos")
                emails.append(("parado", f"Chamado parado: #{ch['numero']}",
                               f"{ch['titulo']} ({ch['operacao']}) está sem movimentação há mais de {cfg['lembrete_parado_horas']:g} h e continua em aberto."))
                resultado["parados"] += 1
            conn.commit()
            retencao = agora - timedelta(days=cfg["anexo_retencao_exclusao_dias"])
            cursor.execute("SELECT TOP 200 id_anexo, chave_storage FROM dbo.chamado_anexos WHERE excluido_em IS NOT NULL AND excluido_em < ? AND chave_storage <> ''", (retencao,))
            provider = st.provider_padrao(self.settings)
            for idx, chave in cursor.fetchall():
                provider.delete(normalize_text(chave))
                cursor.execute("UPDATE dbo.chamado_anexos SET chave_storage = '' WHERE id_anexo = ?", (int(idx),))
                resultado["anexos_removidos"] += 1
            conn.commit()
            for tipo, assunto, corpo in emails:
                self._ch_enviar_email(tipo, assunto, corpo)
            return resultado
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

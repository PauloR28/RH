"""WFM — aprovação da escala antes da publicação e tipos de escala do setor de TI. Mixin do DatabaseRepository.

Fluxo: RASCUNHO -> (enviar) EM_APROVACAO -> (aprovar) APROVADA -> (publicar). Declinar exige justificativa e
devolve a escala a RASCUNHO para quem a montou. A aprovação vale para um conteúdo exato: guarda o hash do
snapshot da escala; qualquer alteração depois (edição, troca aprovada) invalida e a escala volta a ser
rascunho. Nunca se aprova a própria escala, exceto o Analista de TI (gestor único do setor, decisão do RH).
Período fechado dispensa o fluxo: correção é publicada pelo Gestor/RH com justificativa (já auditada).
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_ANALISTA_TI, ROLE_MANAGER, ROLE_SUPERVISOR
from ..services import wfm_scope
from ..services.helpers import normalize_text
from .wfm_escala import _exigir_ano_mes

RASCUNHO, EM_APROVACAO, APROVADA = "RASCUNHO", "EM_APROVACAO", "APROVADA"


def hash_snapshot(snapshot: dict) -> str:
    chave = sorted(
        (i["id_operador"], i["data"], i["id_turno"], i.get("entrada_ajuste") or "", i.get("saida_ajuste") or "")
        for i in snapshot["itens"]
    )
    return hashlib.sha256(json.dumps(chave).encode("utf-8")).hexdigest()


def _slug(nome: str) -> str:
    sem_acento = "".join(c for c in unicodedata.normalize("NFD", nome) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]+", "-", sem_acento.upper()).strip("-")[:40]


def _http(codigo: int, detalhe: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


class WfmAprovacaoRepositoryMixin:
    # ------------------------------------------------------------------
    # Estado efetivo e resumo para a tela
    # ------------------------------------------------------------------
    def _wfm_aprov_efetivo(self, cab: dict, snapshot: dict) -> dict:
        """Estado de aprovação considerando o conteúdo atual: aprovada/enviada com o conteúdo alterado = rascunho."""
        ap = dict(cab["aprovacao"])
        ap["invalidada"] = False
        if ap["estado"] in (EM_APROVACAO, APROVADA) and ap.get("hash") != hash_snapshot(snapshot):
            ap["estado"] = RASCUNHO
            ap["invalidada"] = True
        return ap

    def _wfm_aprovacao_resumo(self, user, operacao: str, cab: dict, snapshot: dict, aprovadores: dict | None = None) -> dict:
        ap = self._wfm_aprov_efetivo(cab, snapshot)
        ids = [i["id_operador"] for i in snapshot["itens"]]
        com_itens = bool(ids)
        pode_aprovar_perfil, _ = wfm_scope.pode_aprovar_escala(
            perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao,
            id_enviou=ap.get("enviado_por"), ids_na_escala=ids, aprovadores=aprovadores,
        )
        tem_aprovar = user.has_permission("wfm.escala.aprovar") and user.perfil != ROLE_ADMIN
        fechada = cab["fechada"]
        estado = ap["estado"]
        return {
            "estado": estado,
            "enviado_por": ap.get("enviado_por_nome"),
            "enviado_em": ap.get("enviado_em"),
            "decidido_por": ap.get("decidido_por"),
            "decidido_em": ap.get("decidido_em"),
            "motivo": ap.get("motivo"),
            "declinada": estado == RASCUNHO and bool(ap.get("motivo")) and not ap["invalidada"],
            "invalidada": ap["invalidada"],
            "exige": not fechada,
            "aprovadores_configurados": bool(aprovadores and (aprovadores.get("perfis") or aprovadores.get("usuarios"))),
            "pode_enviar": (
                not fechada and com_itens and estado == RASCUNHO and user.has_permission("wfm.escala.editar") and user.perfil != ROLE_ADMIN
            ),
            "pode_aprovar": (
                not fechada and com_itens and tem_aprovar and pode_aprovar_perfil
                and (estado == EM_APROVACAO or (estado == RASCUNHO and user.perfil == ROLE_ANALISTA_TI))
            ),
            "pode_declinar": not fechada and tem_aprovar and pode_aprovar_perfil and estado == EM_APROVACAO,
            "pode_cancelar": (
                not fechada and estado == EM_APROVACAO
                and (user.id_usuario == ap.get("enviado_por") or (tem_aprovar and pode_aprovar_perfil))
            ),
        }

    # ------------------------------------------------------------------
    # Configuração da escala: nome e quem aprova
    # ------------------------------------------------------------------
    def _wfm_aprovadores(self, cursor, operacao: str) -> dict:
        cursor.execute("SELECT tipo, valor FROM dbo.wfm_aprovadores WHERE operacao = ?", (operacao,))
        perfis, usuarios = [], []
        for tipo, valor in cursor.fetchall():
            if normalize_text(tipo) == "PERFIL":
                perfis.append(normalize_text(valor))
            elif normalize_text(valor).isdigit():
                usuarios.append(int(valor))
        return {"perfis": perfis, "usuarios": usuarios}

    def _wfm_nome_escala(self, cursor, operacao: str) -> str | None:
        cursor.execute("SELECT nome_escala FROM dbo.wfm_operacao_config WHERE operacao = ?", (operacao,))
        row = cursor.fetchone()
        return normalize_text(row[0]) or None if row else None

    def _wfm_candidatos_aprovador(self, cursor, operacao: str) -> list[dict]:
        """Quem pode ser aprovador: Supervisores/Analista de TI vinculados à operação e os Gestores (RH)."""
        cursor.execute(
            """
            SELECT DISTINCT u.id_usuario, u.nome, u.sobrenome, u.perfil_id FROM dbo.usuarios u
            LEFT JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario AND uo.operacao = ?
            WHERE ISNULL(u.status, 'Ativo') = 'Ativo' AND (
                u.perfil_id = ? OR (u.perfil_id IN (?, ?) AND uo.operacao IS NOT NULL))
            ORDER BY u.nome, u.sobrenome
            """,
            (wfm_scope.operacao_base(operacao), ROLE_MANAGER, ROLE_SUPERVISOR, ROLE_ANALISTA_TI),
        )
        return [{"id_usuario": int(r[0]), "nome": f"{normalize_text(r[1])} {normalize_text(r[2])}".strip(), "perfil": normalize_text(r[3])} for r in cursor.fetchall()]

    def wfm_get_config_escala(self, user, operacao: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute("SELECT ativa, id_contrato, troca_antecedencia_dias FROM dbo.wfm_operacao_config WHERE operacao = ?", (operacao,))
            cfg = cursor.fetchone()
            ativa, id_contrato = (bool(cfg[0]), cfg[1]) if cfg else (True, None)
            troca_dias = int(cfg[2]) if cfg and cfg[2] is not None else 3
            id_tipo = None
            if wfm_scope.eh_tipo_escala(operacao):
                cursor.execute("SELECT id_tipo, ativo FROM dbo.wfm_tipos_escala WHERE chave = ?", (operacao,))
                tipo = cursor.fetchone()
                if tipo:
                    id_tipo, ativa = int(tipo[0]), bool(tipo[1])
            cursor.execute("SELECT id_contrato, codigo, nome FROM dbo.wfm_contratos WHERE operacao = ? AND ativo = 1 ORDER BY codigo", (operacao,))
            contratos = [{"id_contrato": int(r[0]), "codigo": normalize_text(r[1]), "nome": normalize_text(r[2])} for r in cursor.fetchall()]
            pode_criar = wfm_scope.pode_criar_escala(user.perfil) and user.has_permission("wfm.escala.criar")
            return {
                "operacao": operacao,
                "nome_escala": self._wfm_nome_escala(cursor, operacao),
                "aprovadores": self._wfm_aprovadores(cursor, operacao),
                "candidatos": self._wfm_candidatos_aprovador(cursor, operacao),
                "pode_editar": wfm_scope.pode_editar_cadastros(user.perfil) and user.has_permission("wfm.cadastros.editar"),
                "ativa": ativa,
                "id_contrato": int(id_contrato) if id_contrato else None,
                "troca_antecedencia_dias": troca_dias,
                "contratos": contratos,
                "principal": id_tipo is None,
                "id_tipo": id_tipo,
                "pode_gerir": pode_criar,
                "operacoes_destino": self._wfm_operacoes_criacao(cursor, user) if pode_criar else [],
            }
        finally:
            conn.close()

    def wfm_save_config_escala(
        self, user, operacao: str, nome_escala: str, perfis: list[str], usuarios: list[int], *, ip: str = "",
        ativa: bool | None = None, id_contrato: int | None = None, alterar_contrato: bool = False,
        troca_antecedencia_dias: int | None = None,
    ) -> dict:
        if not (wfm_scope.pode_editar_cadastros(user.perfil) and user.has_permission("wfm.cadastros.editar")):
            raise _http(status.HTTP_403_FORBIDDEN, "Sem permissão para configurar a escala.")
        nome_escala = normalize_text(nome_escala)[:120] or None
        perfis = sorted({normalize_text(p) for p in perfis or []})
        if any(p not in (ROLE_SUPERVISOR, ROLE_MANAGER, ROLE_ANALISTA_TI) for p in perfis):
            raise _http(status.HTTP_400_BAD_REQUEST, "Perfil de aprovador inválido (use Supervisor ou Gestor).")
        usuarios = sorted({int(u) for u in usuarios or []})
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True, permitir_inativa=True)
            gere = wfm_scope.pode_criar_escala(user.perfil) and user.has_permission("wfm.escala.criar")
            if (ativa is not None or alterar_contrato) and not gere:
                raise _http(status.HTTP_403_FORBIDDEN, "Sem permissão para ativar/desativar a escala ou trocar a jornada.")
            validos = {c["id_usuario"] for c in self._wfm_candidatos_aprovador(cursor, operacao)}
            if any(u not in validos for u in usuarios):
                raise _http(status.HTTP_400_BAD_REQUEST, "Há usuário que não pode aprovar esta escala (precisa ser Supervisor/Gestor da operação).")
            antes = {"nome_escala": self._wfm_nome_escala(cursor, operacao), "aprovadores": self._wfm_aprovadores(cursor, operacao)}
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config WITH (UPDLOCK, HOLDLOCK) WHERE operacao = ?) "
                "INSERT INTO dbo.wfm_operacao_config (operacao, atualizado_por) VALUES (?, ?)",
                (operacao, operacao, autor),
            )
            cursor.execute(
                "UPDATE dbo.wfm_operacao_config SET nome_escala = ?, atualizado_por = ?, atualizado_em = GETDATE() WHERE operacao = ?",
                (nome_escala, autor, operacao),
            )
            if troca_antecedencia_dias is not None:
                cursor.execute("UPDATE dbo.wfm_operacao_config SET troca_antecedencia_dias = ? WHERE operacao = ?", (int(troca_antecedencia_dias), operacao))
            if alterar_contrato:
                if id_contrato:
                    cursor.execute("SELECT 1 FROM dbo.wfm_contratos WHERE id_contrato = ? AND operacao = ? AND ativo = 1", (int(id_contrato), operacao))
                    if not cursor.fetchone():
                        raise _http(status.HTTP_400_BAD_REQUEST, "Jornada inválida ou inativa para esta escala.")
                cursor.execute("UPDATE dbo.wfm_operacao_config SET id_contrato = ? WHERE operacao = ?", (int(id_contrato) if id_contrato else None, operacao))
            if wfm_scope.eh_tipo_escala(operacao):
                cursor.execute("SELECT id_tipo, nome, operacao_base, ativo FROM dbo.wfm_tipos_escala WHERE chave = ?", (operacao,))
                tipo = cursor.fetchone()
                if tipo and nome_escala and normalize_text(tipo[1]) != nome_escala:
                    cursor.execute("SELECT 1 FROM dbo.wfm_tipos_escala t WHERE t.nome = ? AND t.operacao_base = ? AND t.id_tipo <> ? AND NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config oc WHERE oc.operacao = t.chave AND oc.excluida = 1)", (nome_escala, tipo[2], tipo[0]))
                    if cursor.fetchone():
                        raise _http(status.HTTP_409_CONFLICT, "Já existe uma escala com este nome nesta operação.")
                    cursor.execute("UPDATE dbo.wfm_tipos_escala SET nome = ?, atualizado_em = GETDATE() WHERE id_tipo = ?", (nome_escala, tipo[0]))
                if tipo and ativa is not None and bool(tipo[3]) != bool(ativa):
                    cursor.execute("UPDATE dbo.wfm_tipos_escala SET ativo = ?, atualizado_em = GETDATE() WHERE id_tipo = ?", (1 if ativa else 0, tipo[0]))
            elif ativa is not None:
                cursor.execute("UPDATE dbo.wfm_operacao_config SET ativa = ? WHERE operacao = ?", (1 if ativa else 0, operacao))
            cursor.execute("DELETE FROM dbo.wfm_aprovadores WHERE operacao = ?", (operacao,))
            for valor in perfis:
                cursor.execute("INSERT INTO dbo.wfm_aprovadores (operacao, tipo, valor, atualizado_por) VALUES (?, 'PERFIL', ?, ?)", (operacao, valor, autor))
            for valor in usuarios:
                cursor.execute("INSERT INTO dbo.wfm_aprovadores (operacao, tipo, valor, atualizado_por) VALUES (?, 'USUARIO', ?, ?)", (operacao, str(valor), autor))
            self.wfm_audit(cursor, user, operacao=operacao, acao="configurar_escala", entidade="escala_config", entidade_id=operacao,
                           antes=antes, depois={"nome_escala": nome_escala, "aprovadores": {"perfis": perfis, "usuarios": usuarios},
                                                              **({"ativa": bool(ativa)} if ativa is not None else {}),
                                                              **({"id_contrato": id_contrato} if alterar_contrato else {}),
                                                              **({"troca_antecedencia_dias": troca_antecedencia_dias} if troca_antecedencia_dias is not None else {})}, ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def wfm_resumo_escalas(self, user, ano_mes: str) -> list[dict]:
        """Uma linha por escala (operação/tipo) que o usuário enxerga, para trocar de escala sem sair da tela."""
        ano_mes = _exigir_ano_mes(ano_mes)
        contexto = self.wfm_contexto(user)
        chaves = [o["chave"] for o in contexto["operacoes"]]
        if not chaves:
            return []
        marc = ",".join("?" for _ in chaves)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT operacao, nome_escala FROM dbo.wfm_operacao_config WHERE operacao IN ({marc})", tuple(chaves))
            nomes = {normalize_text(r[0]): normalize_text(r[1]) for r in cursor.fetchall() if r[1]}
            cursor.execute(
                f"SELECT operacao, versao_publicada, fechada, aprov_estado, aprov_motivo FROM dbo.wfm_escalas WHERE ano_mes = ? AND operacao IN ({marc})",
                (ano_mes, *chaves),
            )
            cabs = {normalize_text(r[0]): r for r in cursor.fetchall()}
            cursor.execute(
                f"SELECT operacao, COUNT(DISTINCT id_operador) FROM dbo.wfm_escala_itens WHERE ano_mes = ? AND operacao IN ({marc}) GROUP BY operacao",
                (ano_mes, *chaves),
            )
            escalados = {normalize_text(r[0]): int(r[1]) for r in cursor.fetchall()}
        finally:
            conn.close()
        out = []
        for o in contexto["operacoes"]:
            cab = cabs.get(o["chave"])
            out.append({
                "chave": o["chave"], "nome": nomes.get(o["chave"]) or o["nome"], "operacao": o["nome"],
                "escalados": escalados.get(o["chave"], 0),
                "versao_publicada": int(cab[1]) if cab else 0,
                "fechada": bool(cab[2]) if cab else False,
                "aprovacao": (normalize_text(cab[3]) or "RASCUNHO") if cab else "RASCUNHO",
                "declinada": bool(cab and cab[4]),
            })
        return out

    # ------------------------------------------------------------------
    # Ações do fluxo
    # ------------------------------------------------------------------
    def _wfm_aprov_contexto(self, user, operacao: str, ano_mes: str, *, escrita: bool = True):
        if user.perfil == ROLE_ADMIN:
            raise _http(status.HTTP_403_FORBIDDEN, "O Administrador não participa da aprovação de escalas.")
        ano_mes = _exigir_ano_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=escrita, escala=True)
            cab = self._wfm_cabecalho(cursor, operacao, ano_mes, criar=True)
            if cab["fechada"]:
                raise _http(status.HTTP_409_CONFLICT, "Período fechado: correções são publicadas direto pelo Gestor/RH, com justificativa.")
            snapshot = self._wfm_snapshot(cursor, operacao, ano_mes)
        except BaseException:
            conn.close()
            raise
        return conn, cursor, operacao, ano_mes, cab, snapshot

    def wfm_enviar_aprovacao(self, user, operacao: str, ano_mes: str, *, ip: str = "") -> dict:
        conn, cursor, operacao, ano_mes, cab, snapshot = self._wfm_aprov_contexto(user, operacao, ano_mes)
        try:
            if not snapshot["itens"]:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A escala está vazia: nada a enviar para aprovação.")
            ap = self._wfm_aprov_efetivo(cab, snapshot)
            if ap["estado"] == EM_APROVACAO:
                raise _http(status.HTTP_409_CONFLICT, "Esta escala já está aguardando aprovação.")
            if ap["estado"] == APROVADA:
                raise _http(status.HTTP_409_CONFLICT, "Esta escala já está aprovada: publique-a.")
            resumo = self._wfm_resumo_violacoes(self._wfm_violacoes(cursor, operacao, ano_mes, self._wfm_todos_operadores(cursor, operacao)))
            if resumo["bloqueio_duro"]:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Existe violação de lei que nenhum perfil pode publicar. Corrija a escala antes de enviar.")
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "UPDATE dbo.wfm_escalas SET aprov_estado = ?, aprov_enviado_por = ?, aprov_enviado_nome = ?, aprov_enviado_em = GETDATE(), "
                "aprov_decidido_por = NULL, aprov_decidido_em = NULL, aprov_motivo = NULL, aprov_hash = ?, atualizado_em = GETDATE() "
                "WHERE operacao = ? AND ano_mes = ?",
                (EM_APROVACAO, user.id_usuario, autor, hash_snapshot(snapshot), operacao, ano_mes),
            )
            self.wfm_audit(cursor, user, operacao=operacao, acao="enviar_aprovacao", entidade="escala", entidade_id=ano_mes,
                           antes={"estado": ap["estado"]}, depois={"estado": EM_APROVACAO, "itens": len(snapshot["itens"])}, ip=ip)
            conn.commit()
            return {"success": True, "estado": EM_APROVACAO}
        finally:
            conn.close()

    def wfm_aprovar_escala(self, user, operacao: str, ano_mes: str, *, ip: str = "") -> dict:
        conn, cursor, operacao, ano_mes, cab, snapshot = self._wfm_aprov_contexto(user, operacao, ano_mes)
        try:
            permitido, motivo = wfm_scope.pode_aprovar_escala(
                perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao,
                id_enviou=cab["aprovacao"].get("enviado_por"), ids_na_escala=[i["id_operador"] for i in snapshot["itens"]],
                aprovadores=self._wfm_aprovadores(cursor, operacao),
            )
            if not permitido:
                raise _http(status.HTTP_403_FORBIDDEN, motivo)
            if not snapshot["itens"]:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A escala está vazia: nada a aprovar.")
            ap = self._wfm_aprov_efetivo(cab, snapshot)
            direta = ap["estado"] == RASCUNHO and user.perfil == ROLE_ANALISTA_TI  # gestor único do TI aprova a própria
            if ap["estado"] == APROVADA:
                raise _http(status.HTTP_409_CONFLICT, "Esta escala já está aprovada.")
            if ap["estado"] != EM_APROVACAO and not direta:
                detalhe = "A escala foi alterada depois do envio: reenvie para aprovação." if ap["invalidada"] else "A escala ainda não foi enviada para aprovação."
                raise _http(status.HTTP_409_CONFLICT, detalhe)
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "UPDATE dbo.wfm_escalas SET aprov_estado = ?, aprov_decidido_por = ?, aprov_decidido_em = GETDATE(), aprov_motivo = NULL, aprov_hash = ?, "
                "aprov_enviado_por = ISNULL(aprov_enviado_por, ?), aprov_enviado_nome = ISNULL(aprov_enviado_nome, ?), aprov_enviado_em = ISNULL(aprov_enviado_em, GETDATE()), "
                "atualizado_em = GETDATE() WHERE operacao = ? AND ano_mes = ?",
                (APROVADA, autor, hash_snapshot(snapshot), user.id_usuario, autor, operacao, ano_mes),
            )
            self.wfm_audit(cursor, user, operacao=operacao, acao="aprovar_escala", entidade="escala", entidade_id=ano_mes,
                           antes={"estado": ap["estado"]}, depois={"estado": APROVADA, "autoaprovada": direta}, ip=ip)
            conn.commit()
        finally:
            conn.close()
        # Aprovada = publicada: quem aprova publica a versão na mesma ação (o histórico mostra quem aprovou).
        # Se a publicação não for possível (ex.: violação que o aprovador não pode publicar), a aprovação vale e
        # a resposta traz o aviso para publicar manualmente.
        try:
            pub = self.wfm_publicar(user, operacao, ano_mes, ip=ip)
            return {"success": True, "estado": APROVADA, "publicada": True, "versao": pub["versao"]}
        except HTTPException as exc:
            detalhe = exc.detail.get("mensagem") if isinstance(exc.detail, dict) else exc.detail
            return {"success": True, "estado": APROVADA, "publicada": False, "aviso": detalhe}

    def wfm_declinar_escala(self, user, operacao: str, ano_mes: str, justificativa: str, *, ip: str = "") -> dict:
        justificativa = normalize_text(justificativa)
        if len(justificativa) < 3:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe a justificativa do declínio.")
        conn, cursor, operacao, ano_mes, cab, snapshot = self._wfm_aprov_contexto(user, operacao, ano_mes)
        try:
            ap = self._wfm_aprov_efetivo(cab, snapshot)
            if ap["estado"] != EM_APROVACAO:
                raise _http(status.HTTP_409_CONFLICT, "Não há envio pendente de aprovação nesta escala.")
            permitido, motivo = wfm_scope.pode_aprovar_escala(
                perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes, operacao=operacao,
                id_enviou=cab["aprovacao"].get("enviado_por"), ids_na_escala=[i["id_operador"] for i in snapshot["itens"]],
                aprovadores=self._wfm_aprovadores(cursor, operacao),
            )
            if not permitido or not user.has_permission("wfm.escala.aprovar"):
                raise _http(status.HTTP_403_FORBIDDEN, motivo or "Você não pode declinar esta escala.")
            autor = normalize_text(user.nome) or user.username
            # Volta a rascunho, ainda apontando quem a enviou: é essa pessoa que corrige e reenvia.
            cursor.execute(
                "UPDATE dbo.wfm_escalas SET aprov_estado = ?, aprov_decidido_por = ?, aprov_decidido_em = GETDATE(), aprov_motivo = ?, aprov_hash = NULL, "
                "atualizado_em = GETDATE() WHERE operacao = ? AND ano_mes = ?",
                (RASCUNHO, autor, justificativa[:400], operacao, ano_mes),
            )
            self.wfm_audit(cursor, user, operacao=operacao, acao="declinar_escala", entidade="escala", entidade_id=ano_mes,
                           antes={"estado": EM_APROVACAO}, depois={"estado": RASCUNHO, "enviado_por": cab["aprovacao"].get("enviado_por_nome")},
                           justificativa=justificativa, ip=ip)
            conn.commit()
            return {"success": True, "estado": RASCUNHO}
        finally:
            conn.close()

    def wfm_cancelar_envio(self, user, operacao: str, ano_mes: str, *, ip: str = "") -> dict:
        conn, cursor, operacao, ano_mes, cab, snapshot = self._wfm_aprov_contexto(user, operacao, ano_mes)
        try:
            ap = self._wfm_aprov_efetivo(cab, snapshot)
            if ap["estado"] != EM_APROVACAO:
                raise _http(status.HTTP_409_CONFLICT, "Não há envio pendente de aprovação nesta escala.")
            resumo = self._wfm_aprovacao_resumo(user, operacao, cab, snapshot, self._wfm_aprovadores(cursor, operacao))
            if not resumo["pode_cancelar"]:
                raise _http(status.HTTP_403_FORBIDDEN, "Somente quem enviou (ou um aprovador) cancela o envio.")
            cursor.execute(
                "UPDATE dbo.wfm_escalas SET aprov_estado = ?, aprov_hash = NULL, aprov_motivo = NULL, atualizado_em = GETDATE() WHERE operacao = ? AND ano_mes = ?",
                (RASCUNHO, operacao, ano_mes),
            )
            self.wfm_audit(cursor, user, operacao=operacao, acao="cancelar_envio_aprovacao", entidade="escala", entidade_id=ano_mes,
                           antes={"estado": EM_APROVACAO}, depois={"estado": RASCUNHO}, ip=ip)
            conn.commit()
            return {"success": True, "estado": RASCUNHO}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Tipos de escala do setor de TI (Analista de TI e Administrador)
    # ------------------------------------------------------------------
    def wfm_list_tipos_escala(self, user, operacao_base: str = "TI") -> list[dict]:
        base = normalize_text(operacao_base) or "TI"
        if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, base):
            raise _http(status.HTTP_403_FORBIDDEN, "Esta operação está fora do seu escopo de acesso.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id_tipo, operacao_base, chave, nome, descricao, ativo FROM dbo.wfm_tipos_escala t WHERE operacao_base = ? "
                "AND NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config oc WHERE oc.operacao = t.chave AND oc.excluida = 1) ORDER BY nome",
                (base,),
            )
            return [
                {"id_tipo": int(r[0]), "operacao_base": normalize_text(r[1]), "chave": normalize_text(r[2]), "nome": normalize_text(r[3]),
                 "descricao": normalize_text(r[4]) or None, "ativo": bool(r[5])}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def wfm_save_tipo_escala(self, user, data: dict, id_tipo: int | None = None, *, ip: str = "", autorizado: bool = False) -> dict:
        if not autorizado and not wfm_scope.pode_editar_tipos_escala(user.perfil):
            raise _http(status.HTTP_403_FORBIDDEN, "Somente o Analista de TI (Gestor de TI) cadastra tipos de escala.")
        nome = normalize_text(data.get("nome"))
        if not nome:
            raise _http(status.HTTP_400_BAD_REQUEST, "Informe o nome da escala.")
        descricao = normalize_text(data.get("descricao")) or None
        ativo = 1 if data.get("ativo", True) else 0
        conn = self._connect()
        try:
            cursor = conn.cursor()
            autor = normalize_text(user.nome) or user.username
            if id_tipo:
                cursor.execute("SELECT chave, nome, descricao, ativo, operacao_base FROM dbo.wfm_tipos_escala WHERE id_tipo = ?", (int(id_tipo),))
                row = cursor.fetchone()
                if not row:
                    raise _http(status.HTTP_404_NOT_FOUND, "Tipo de escala não encontrado.")
                chave = normalize_text(row[0])
                if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, chave):
                    raise _http(status.HTTP_403_FORBIDDEN, "Esta operação está fora do seu escopo de acesso.")
                cursor.execute("SELECT 1 FROM dbo.wfm_tipos_escala t WHERE t.nome = ? AND t.operacao_base = ? AND t.id_tipo <> ? AND NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config oc WHERE oc.operacao = t.chave AND oc.excluida = 1)", (nome, row[4], int(id_tipo)))
                if cursor.fetchone():
                    raise _http(status.HTTP_409_CONFLICT, "Já existe um tipo de escala com este nome.")
                cursor.execute(
                    "UPDATE dbo.wfm_tipos_escala SET nome = ?, descricao = ?, ativo = ?, atualizado_em = GETDATE() WHERE id_tipo = ?",
                    (nome, descricao, ativo, int(id_tipo)),
                )
                self.wfm_audit(cursor, user, operacao=chave, acao="salvar_tipo_escala", entidade="tipo_escala", entidade_id=id_tipo,
                               antes={"nome": normalize_text(row[1]), "ativo": bool(row[3])}, depois={"nome": nome, "ativo": bool(ativo)}, ip=ip)
                resolved = int(id_tipo)
            else:
                base = normalize_text(data.get("operacao_base")) or "TI"
                if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, base):
                    raise _http(status.HTTP_403_FORBIDDEN, "Esta operação está fora do seu escopo de acesso.")
                cursor.execute("SELECT chave FROM dbo.operacoes WHERE chave = ?", (base,))
                existente = cursor.fetchone()
                if not existente:
                    raise _http(status.HTTP_404_NOT_FOUND, "Operação não encontrada.")
                slug = _slug(nome)[: max(1, 60 - len(normalize_text(existente[0])) - len(wfm_scope.SEPARADOR_TIPO))].strip("-")
                if not slug:
                    raise _http(status.HTTP_400_BAD_REQUEST, "Nome inválido: use letras ou números.")
                prefixo = f"{normalize_text(existente[0])}{wfm_scope.SEPARADOR_TIPO}"
                cursor.execute("SELECT 1 FROM dbo.wfm_tipos_escala t WHERE t.operacao_base = ? AND t.nome = ? AND NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config oc WHERE oc.operacao = t.chave AND oc.excluida = 1)", (base, nome))
                if cursor.fetchone():
                    raise _http(status.HTTP_409_CONFLICT, "Já existe uma escala com este nome.")
                # A chave de uma escala excluída (logicamente) continua reservada para o histórico: a nova ganha outra.
                chave, n = f"{prefixo}{slug}", 1
                while True:
                    cursor.execute("SELECT 1 FROM dbo.wfm_tipos_escala WHERE chave = ?", (chave,))
                    if not cursor.fetchone():
                        break
                    n += 1
                    sufixo = f"-{n}"
                    chave = f"{prefixo}{slug[: 60 - len(prefixo) - len(sufixo)]}{sufixo}"
                cursor.execute(
                    "INSERT INTO dbo.wfm_tipos_escala (operacao_base, chave, nome, descricao, ativo, criado_por) OUTPUT INSERTED.id_tipo VALUES (?, ?, ?, ?, ?, ?)",
                    (normalize_text(existente[0]), chave, nome, descricao, ativo, autor),
                )
                resolved = int(cursor.fetchone()[0])
                self.wfm_audit(cursor, user, operacao=chave, acao="criar_tipo_escala", entidade="tipo_escala", entidade_id=resolved,
                               depois={"nome": nome, "chave": chave}, ip=ip)
            conn.commit()
            return {"success": True, "id_tipo": resolved, "chave": chave}
        finally:
            conn.close()

    def wfm_excluir_tipo_escala(self, user, id_tipo: int, *, ip: str = "", autorizado: bool = False) -> dict:
        """Exclui o tipo de escala só se nunca foi usado (sem itens, versões publicadas, trocas ou presenças);
        com histórico, apenas desativa (o histórico publicado é imutável)."""
        if not autorizado and not wfm_scope.pode_editar_tipos_escala(user.perfil):
            raise _http(status.HTTP_403_FORBIDDEN, "Somente o Analista de TI (Gestor de TI) exclui tipos de escala.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT chave, nome FROM dbo.wfm_tipos_escala WHERE id_tipo = ?", (int(id_tipo),))
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Tipo de escala não encontrado.")
            chave, nome = normalize_text(row[0]), normalize_text(row[1])
            if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, chave):
                raise _http(status.HTTP_403_FORBIDDEN, "Esta operação está fora do seu escopo de acesso.")
            for tabela in ("wfm_escala_itens", "wfm_escala_versoes", "wfm_trocas", "wfm_presencas", "wfm_atestados", "wfm_horas_extras", "wfm_pausas"):
                cursor.execute(f"SELECT TOP 1 1 FROM dbo.{tabela} WHERE operacao = ?", (chave,))
                if cursor.fetchone():
                    raise _http(status.HTTP_409_CONFLICT, "Este tipo de escala já tem histórico e não pode ser excluído: desative-o.")
            for tabela in ("wfm_calendario_especial", "wfm_usuario_skills", "wfm_skills", "wfm_operador_contratos", "wfm_turnos", "wfm_contratos", "wfm_operacao_config", "wfm_aprovadores", "wfm_escalas"):
                cursor.execute(f"DELETE FROM dbo.{tabela} WHERE operacao = ?", (chave,))
            cursor.execute("DELETE FROM dbo.wfm_tipos_escala WHERE id_tipo = ?", (int(id_tipo),))
            self.wfm_audit(cursor, user, operacao=chave, acao="excluir_tipo_escala", entidade="tipo_escala", entidade_id=id_tipo,
                           antes={"nome": nome, "chave": chave}, ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

"""Equipes na Tecnologia (24/nov/2026): administrar as equipes de todas as operações e mover operadores entre elas.

Mixin do DatabaseRepository, SQL puro (pyodbc). A equipe é `dbo.equipes_operacao` (nome por operação) com um supervisor
RESPONSÁVEL (`id_supervisor`, recebe as pendências) e um APOIO opcional (`id_apoio`, não recebe pendências). Cada operador
fica em UMA equipe (`usuarios.id_equipe`).

Mover operador muda tudo junto, numa transação só (regra do Paulo, 24/11):
  * cadastro: `usuarios.id_equipe` e o vínculo `usuarios_supervisores` (só o responsável da equipe nova);
  * EM ABERTO passa para o novo supervisor: monitorias esperando feedback/reanálise e trocas esperando aprovação (já seguem
    o vínculo atual), planos de ação não concluídos (responsável gravado) e a escala de AMANHÃ em diante (turno do novo
    supervisor com o mesmo horário; sem par, quem move escolhe o turno);
  * HISTÓRICO nunca muda: monitorias finalizadas, trocas decididas, escala até hoje, versões publicadas, avisos e logs.

Escopo (sempre no servidor): Administrador vê e mexe em todas as operações; Control Desk/Gestor nas operações dele;
Supervisor só move operadores da equipe em que é responsável, para outra equipe da mesma operação.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime

from fastapi import HTTPException, status

from ..alcance import EQUIPE, alcance
from ..rbac import ROLE_OPERATOR, ROLE_SUPERVISOR, papel
from ..services import monitoria_workflow as wf
from ..services import wfm_trocas as regras_troca
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_scope import operacoes_permitidas
from ..services.wfm_historico import FUSO_BRASIL
from .equipes_admin_schema import ensure_equipes_admin_schema
from .monitoria_schema import SQL_MONITORIA_NAO_EXCLUIDA

# Monitorias que esperam o supervisor (feedback, contestação e reanálise).
STATUS_MONITORIA_ABERTA_FEEDBACK = (wf.FEEDBACK_PENDENTE,)
STATUS_MONITORIA_ABERTA_CONTESTACAO = (wf.CONTESTADA, wf.REANALISE)
TROCAS_ABERTAS = (regras_troca.AGUARDANDO_B, regras_troca.AGUARDANDO_APROVACAO)
PLANO_CONCLUIDO = "CONCLUIDO"
LIMITE_OPERADORES_POR_MOVIMENTO = 200


def _http(codigo: int, detalhe) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


def _nome(row: dict, prefixo: str = "") -> str:
    return " ".join(p for p in (normalize_text(row.get(f"{prefixo}nome")), normalize_text(row.get(f"{prefixo}sobrenome"))) if p)


def _marcadores(itens) -> str:
    return ",".join("?" for _ in itens)


def _hoje() -> date:
    return datetime.now(FUSO_BRASIL).date()


def _rotulo_turno(t: dict) -> str:
    horario = f" {normalize_text(t.get('entrada'))}–{normalize_text(t.get('saida'))}" if t.get("entrada") and t.get("saida") else ""
    dono = f" · {t['dono']}" if t.get("dono") else ""
    return f"{normalize_text(t.get('codigo'))}{horario}{dono}"


class EquipesAdminRepositoryMixin:
    # ------------------------------------------------------------------
    # Escopo
    # ------------------------------------------------------------------
    @staticmethod
    def _eqa_eh_supervisor(user) -> bool:
        return alcance(user.perfil).wfm == EQUIPE

    @staticmethod
    def _eqa_permitidas(user):
        """`None` = todas as operações."""
        if alcance(user.perfil).total:
            return None
        return operacoes_permitidas(user.perfil, user.operacoes)

    def _eqa_exigir_operacao(self, user, operacao: str) -> None:
        permitidas = self._eqa_permitidas(user)
        if permitidas is not None and normalize_text(operacao) not in permitidas:
            raise _http(status.HTTP_403_FORBIDDEN, "Esta operação está fora do seu acesso.")

    def _eqa_equipe(self, cursor, id_equipe: int) -> dict:
        cursor.execute(
            """
            SELECT e.id_equipe, e.operacao, e.nome, e.ativo, e.id_supervisor, e.id_apoio,
                   s.nome AS sup_nome, s.sobrenome AS sup_sobrenome
            FROM dbo.equipes_operacao e LEFT JOIN dbo.usuarios s ON s.id_usuario = e.id_supervisor
            WHERE e.id_equipe = ?
            """,
            (int(id_equipe),),
        )
        linhas = rows_to_dicts(cursor, cursor.fetchall())
        if not linhas:
            raise _http(status.HTTP_404_NOT_FOUND, "Equipe não encontrada.")
        e = linhas[0]
        return {
            "id_equipe": int(e["id_equipe"]), "operacao": normalize_text(e["operacao"]), "nome": normalize_text(e["nome"]),
            "ativo": bool(e["ativo"]), "id_supervisor": int(e["id_supervisor"]) if e.get("id_supervisor") else None,
            "id_apoio": int(e["id_apoio"]) if e.get("id_apoio") else None, "supervisor_nome": _nome(e, "sup_"),
        }

    def _eqa_supervisores(self, cursor, operacoes=None) -> dict[str, list[dict]]:
        """Supervisores ativos por operação (para os campos Responsável e Apoio)."""
        cursor.execute(
            "SELECT u.id_usuario, u.nome, u.sobrenome, u.perfil_id, uo.operacao FROM dbo.usuarios u "
            "JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario WHERE ISNULL(u.status, 'Ativo') = 'Ativo' ORDER BY u.nome, u.sobrenome"
        )
        saida: dict[str, list[dict]] = {}
        for r in rows_to_dicts(cursor, cursor.fetchall()):
            if papel(r["perfil_id"]) != ROLE_SUPERVISOR:
                continue
            op = normalize_text(r["operacao"])
            if operacoes is not None and op not in operacoes:
                continue
            saida.setdefault(op, []).append({"id_usuario": int(r["id_usuario"]), "nome": _nome(r)})
        return saida

    # ------------------------------------------------------------------
    # Lista e membros
    # ------------------------------------------------------------------
    def eqa_listar(self, user, operacao: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_equipes_admin_schema(cursor)
            conn.commit()
            permitidas = self._eqa_permitidas(user)
            cursor.execute(
                """
                SELECT e.id_equipe, e.operacao, o.nome AS operacao_nome, e.nome, e.ativo, e.id_supervisor, e.id_apoio,
                       s.nome AS sup_nome, s.sobrenome AS sup_sobrenome, a.nome AS apo_nome, a.sobrenome AS apo_sobrenome,
                       (SELECT COUNT(*) FROM dbo.usuarios u WHERE u.id_equipe = e.id_equipe AND ISNULL(u.status, 'Ativo') = 'Ativo'
                          AND (e.id_supervisor IS NULL OR u.id_usuario <> e.id_supervisor)) AS membros
                FROM dbo.equipes_operacao e
                LEFT JOIN dbo.operacoes o ON o.chave = e.operacao
                LEFT JOIN dbo.usuarios s ON s.id_usuario = e.id_supervisor
                LEFT JOIN dbo.usuarios a ON a.id_usuario = e.id_apoio
                ORDER BY o.nome, e.nome
                """
            )
            linhas = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT id_supervisor, operacao, codigo FROM dbo.wfm_turnos WHERE ativo = 1 AND tipo = 'TRABALHO' AND id_supervisor IS NOT NULL ORDER BY codigo")
            turnos: dict[tuple[int, str], list[str]] = {}
            for id_sup, op, codigo in cursor.fetchall():
                turnos.setdefault((int(id_sup), normalize_text(op)), []).append(normalize_text(codigo))
            equipes = []
            for r in linhas:
                op = normalize_text(r["operacao"])
                if permitidas is not None and op not in permitidas:
                    continue
                if operacao and op != normalize_text(operacao):
                    continue
                id_sup = int(r["id_supervisor"]) if r.get("id_supervisor") else None
                equipes.append({
                    "id_equipe": int(r["id_equipe"]), "operacao": op, "operacao_nome": normalize_text(r.get("operacao_nome")) or op,
                    "nome": normalize_text(r["nome"]), "ativo": bool(r["ativo"]),
                    "id_supervisor": id_sup, "supervisor_nome": _nome(r, "sup_"),
                    "id_apoio": int(r["id_apoio"]) if r.get("id_apoio") else None, "apoio_nome": _nome(r, "apo_"),
                    "membros": int(r.get("membros") or 0),
                    "turnos": turnos.get((id_sup, op), []) if id_sup else [],
                })
            eh_sup = self._eqa_eh_supervisor(user)
            return {
                "equipes": equipes,
                "supervisores": self._eqa_supervisores(cursor, permitidas),
                "eu": {"id_usuario": user.id_usuario, "eh_supervisor": eh_sup},
                "pode": {
                    "administrar": user.has_permission("equipes.administrar") and not eh_sup,
                    "mover": user.has_permission("equipes.mover"),
                    "exportar": user.has_permission("equipes.exportar"),
                },
            }
        finally:
            conn.close()

    def eqa_membros(self, user, id_equipe: int) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            equipe = self._eqa_equipe(cursor, id_equipe)
            self._eqa_exigir_operacao(user, equipe["operacao"])
            cursor.execute(
                "SELECT id_usuario, nome, sobrenome, email, perfil_id FROM dbo.usuarios WHERE id_equipe = ? AND ISNULL(status, 'Ativo') = 'Ativo' "
                "ORDER BY nome, sobrenome",
                (int(id_equipe),),
            )
            linhas = [r for r in rows_to_dicts(cursor, cursor.fetchall()) if papel(r["perfil_id"]) == ROLE_OPERATOR]
            turnos = self._eq_turnos_da_escala(cursor, [int(r["id_usuario"]) for r in linhas]) if linhas else {}
            return [
                {"id_usuario": int(r["id_usuario"]), "nome": _nome(r), "email": normalize_text(r.get("email")), "turno": turnos.get(int(r["id_usuario"])) or ""}
                for r in linhas
            ]
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Criar / editar
    # ------------------------------------------------------------------
    def eqa_salvar(self, user, dados: dict, id_equipe: int | None = None, *, ip: str = "") -> dict:
        nome = normalize_text(dados.get("nome"))
        operacao = normalize_text(dados.get("operacao"))
        id_sup = int(dados.get("id_supervisor") or 0) or None
        id_apoio = int(dados.get("id_apoio") or 0) or None
        ativo = bool(dados.get("ativo", True))
        if not nome or len(nome) > 80:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o nome da equipe (até 80 caracteres).")
        if id_apoio and id_apoio == id_sup:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O apoio precisa ser outra pessoa, não o responsável.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_equipes_admin_schema(cursor)
            anterior = self._eqa_equipe(cursor, id_equipe) if id_equipe else None
            if anterior:
                operacao = anterior["operacao"]  # a operação da equipe não muda (mova os operadores)
            if not operacao:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha a operação da equipe.")
            self._eqa_exigir_operacao(user, operacao)
            sups = {s["id_usuario"] for s in self._eqa_supervisores(cursor).get(operacao, [])}
            for rotulo, pessoa in (("responsável", id_sup), ("de apoio", id_apoio)):
                if pessoa and pessoa not in sups:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"O supervisor {rotulo} precisa ser um supervisor ativo desta operação.")
            cursor.execute(
                "SELECT TOP 1 1 FROM dbo.equipes_operacao WHERE operacao = ? AND LOWER(nome) = LOWER(?) AND id_equipe <> ?",
                (operacao, nome, int(id_equipe or 0)),
            )
            if cursor.fetchone():
                raise _http(status.HTTP_409_CONFLICT, "Já existe uma equipe com este nome nesta operação.")
            membros = 0
            if anterior:
                cursor.execute(
                    "SELECT COUNT(*) FROM dbo.usuarios WHERE id_equipe = ? AND ISNULL(status, 'Ativo') = 'Ativo' AND id_usuario <> ?",
                    (int(id_equipe), int(anterior["id_supervisor"] or 0)),
                )
                membros = int(cursor.fetchone()[0])
                if membros and not ativo:
                    raise _http(status.HTTP_409_CONFLICT, "Só dá para desativar uma equipe vazia. Mova os operadores antes.")
                if membros and anterior["id_supervisor"] and id_sup != anterior["id_supervisor"]:
                    raise _http(
                        status.HTTP_409_CONFLICT,
                        "Esta equipe tem operadores. Para trocar o responsável, crie a equipe do novo supervisor e mova os operadores: "
                        "assim as pendências e a escala acompanham.",
                    )
                cursor.execute(
                    "UPDATE dbo.equipes_operacao SET nome = ?, ativo = ?, id_supervisor = ?, id_apoio = ?, atualizado_em = GETDATE() WHERE id_equipe = ?",
                    (nome, 1 if ativo else 0, id_sup, id_apoio, int(id_equipe)),
                )
                alvo = int(id_equipe)
            else:
                cursor.execute(
                    "INSERT INTO dbo.equipes_operacao (operacao, nome, ativo, id_supervisor, id_apoio) OUTPUT INSERTED.id_equipe VALUES (?, ?, ?, ?, ?)",
                    (operacao, nome, 1 if ativo else 0, id_sup, id_apoio),
                )
                alvo = int(cursor.fetchone()[0])
            if id_sup:
                # A equipe do supervisor no cadastro (usada na escala para mostrar a equipe do turno).
                cursor.execute("UPDATE dbo.usuarios SET id_equipe = ?, atualizado_em = GETDATE() WHERE id_usuario = ?", (alvo, id_sup))
            self.mon_log(
                cursor, user, acao="equipe_editar" if anterior else "equipe_criar", operacao=operacao, modulo="Equipes",
                entidade="equipe", entidade_id=alvo, anterior=anterior,
                posterior={"nome": nome, "ativo": ativo, "id_supervisor": id_sup, "id_apoio": id_apoio}, ip=ip,
            )
            conn.commit()
            return self._eqa_equipe(cursor, alvo)
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Exportar
    # ------------------------------------------------------------------
    def eqa_exportar_csv(self, user, operacao: str = "") -> str:
        dados = self.eqa_listar(user, operacao)
        ids = [e["id_equipe"] for e in dados["equipes"]]
        membros: dict[int, list[dict]] = {}
        if ids:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    f"SELECT id_equipe, id_usuario, nome, sobrenome, email, perfil_id FROM dbo.usuarios WHERE id_equipe IN ({_marcadores(ids)}) "  # nosec B608
                    "AND ISNULL(status, 'Ativo') = 'Ativo' ORDER BY nome, sobrenome",
                    tuple(ids),
                )
                for r in rows_to_dicts(cursor, cursor.fetchall()):
                    if papel(r["perfil_id"]) == ROLE_OPERATOR:
                        membros.setdefault(int(r["id_equipe"]), []).append(r)
            finally:
                conn.close()
        saida = io.StringIO()
        escrita = csv.writer(saida, delimiter=";")
        escrita.writerow(["Operação", "Equipe", "Situação", "Supervisor responsável", "Apoio", "Turnos", "Operador", "E-mail"])
        for e in dados["equipes"]:
            base = [e["operacao_nome"], e["nome"], "Ativa" if e["ativo"] else "Desativada", e["supervisor_nome"], e["apoio_nome"], " · ".join(e["turnos"])]
            pessoas = membros.get(e["id_equipe"]) or [None]
            for p in pessoas:
                escrita.writerow([*base, _nome(p) if p else "", normalize_text(p.get("email")) if p else ""])
        return "﻿" + saida.getvalue()

    # ------------------------------------------------------------------
    # Mover operadores
    # ------------------------------------------------------------------
    def _eqa_validar_movimento(self, cursor, user, ids: list[int], id_destino: int) -> tuple[dict, list[dict]]:
        ids = sorted({int(i) for i in ids if int(i or 0) > 0})
        if not ids:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Marque ao menos um operador.")
        if len(ids) > LIMITE_OPERADORES_POR_MOVIMENTO:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Mova no máximo {LIMITE_OPERADORES_POR_MOVIMENTO} operadores por vez.")
        destino = self._eqa_equipe(cursor, id_destino)
        self._eqa_exigir_operacao(user, destino["operacao"])
        if not destino["ativo"]:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A equipe de destino está desativada.")
        if not destino["id_supervisor"]:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A equipe de destino não tem supervisor responsável. Edite a equipe antes.")
        cursor.execute(
            f"""
            SELECT u.id_usuario, u.nome, u.sobrenome, u.perfil_id, u.id_equipe, e.id_supervisor, e.nome AS equipe_nome
            FROM dbo.usuarios u LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
            WHERE u.id_usuario IN ({_marcadores(ids)})
            """,  # nosec B608
            tuple(ids),
        )
        pessoas = rows_to_dicts(cursor, cursor.fetchall())
        if len(pessoas) != len(ids) or any(papel(p["perfil_id"]) != ROLE_OPERATOR for p in pessoas):
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Só operadores podem ser movidos entre equipes.")
        cursor.execute(f"SELECT id_usuario, operacao FROM dbo.usuarios_operacoes WHERE id_usuario IN ({_marcadores(ids)})", tuple(ids))  # nosec B608
        ops: dict[int, set[str]] = {}
        for id_u, op in cursor.fetchall():
            ops.setdefault(int(id_u), set()).add(normalize_text(op))
        eh_sup = self._eqa_eh_supervisor(user)
        for p in pessoas:
            if destino["operacao"] not in ops.get(int(p["id_usuario"]), set()):
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{_nome(p)} não está na operação da equipe de destino.")
            if p.get("id_equipe") and int(p["id_equipe"]) == destino["id_equipe"]:
                raise _http(status.HTTP_409_CONFLICT, f"{_nome(p)} já está nesta equipe.")
            if eh_sup and int(p.get("id_supervisor") or 0) != int(user.id_usuario or -1):
                raise _http(status.HTTP_403_FORBIDDEN, "Você só pode mover operadores da equipe em que é o responsável.")
        return destino, pessoas

    def _eqa_turnos_a_trocar(self, cursor, ids: list[int], destino: dict) -> list[dict]:
        """Turnos de outro supervisor na escala de AMANHÃ em diante, com o turno igual do supervisor de destino (se houver)."""
        amanha = date.fromordinal(_hoje().toordinal() + 1)
        cursor.execute(
            f"""
            SELECT t.id_turno, t.codigo, t.nome, t.tipo, t.entrada, t.saida, t.id_supervisor, s.nome AS dono_nome, s.sobrenome AS dono_sobrenome,
                   COUNT(*) AS dias, COUNT(DISTINCT i.id_operador) AS pessoas
            FROM dbo.wfm_escala_itens i
            JOIN dbo.wfm_turnos t ON t.id_turno = i.id_turno
            LEFT JOIN dbo.usuarios s ON s.id_usuario = t.id_supervisor
            WHERE i.id_operador IN ({_marcadores(ids)}) AND i.data >= ? AND t.id_supervisor IS NOT NULL AND t.id_supervisor <> ?
            GROUP BY t.id_turno, t.codigo, t.nome, t.tipo, t.entrada, t.saida, t.id_supervisor, s.nome, s.sobrenome
            ORDER BY t.codigo
            """,  # nosec B608
            (*ids, amanha, destino["id_supervisor"]),
        )
        antigos = rows_to_dicts(cursor, cursor.fetchall())
        if not antigos:
            return []
        cursor.execute(
            "SELECT id_turno, codigo, nome, tipo, entrada, saida FROM dbo.wfm_turnos WHERE ativo = 1 AND id_supervisor = ? AND operacao = ? ORDER BY codigo",
            (destino["id_supervisor"], destino["operacao"]),
        )
        do_destino = rows_to_dicts(cursor, cursor.fetchall())
        saida = []
        for t in antigos:
            t["dono"] = _nome(t, "dono_")
            mesmo_tipo = [d for d in do_destino if normalize_text(d["tipo"]) == normalize_text(t["tipo"])]
            igual = next(
                (d for d in mesmo_tipo if normalize_text(d["entrada"]) == normalize_text(t["entrada"]) and normalize_text(d["saida"]) == normalize_text(t["saida"])),
                None,
            )
            saida.append({
                "id_turno": int(t["id_turno"]), "rotulo": _rotulo_turno(t), "dias": int(t["dias"]), "pessoas": int(t["pessoas"]),
                "id_destino_auto": int(igual["id_turno"]) if igual else None,
                "opcoes": [{"id_turno": int(d["id_turno"]), "rotulo": _rotulo_turno({**d, "dono": destino["supervisor_nome"]})} for d in mesmo_tipo],
            })
        return saida

    def _eqa_contagens(self, cursor, ids: list[int]) -> dict:
        m = _marcadores(ids)
        cont: dict[str, int] = {}
        for chave, estados in (("monitorias_feedback", STATUS_MONITORIA_ABERTA_FEEDBACK), ("monitorias_contestacao", STATUS_MONITORIA_ABERTA_CONTESTACAO)):
            cursor.execute(
                f"SELECT COUNT(*) FROM dbo.monitorias m JOIN dbo.monitoria_estado s ON s.id_monitoria = m.id_monitoria "  # nosec B608
                f"WHERE m.id_operador IN ({m}) AND s.status IN ({_marcadores(estados)}) AND {SQL_MONITORIA_NAO_EXCLUIDA}",
                (*ids, *estados),
            )
            cont[chave] = int(cursor.fetchone()[0])
        cursor.execute(
            f"SELECT COUNT(*) FROM dbo.wfm_trocas WHERE estado IN ({_marcadores(TROCAS_ABERTAS)}) AND (id_solicitante IN ({m}) OR id_alvo IN ({m}))",  # nosec B608
            (*TROCAS_ABERTAS, *ids, *ids),
        )
        cont["trocas"] = int(cursor.fetchone()[0])
        cursor.execute(f"SELECT COUNT(*) FROM dbo.monitoria_planos WHERE id_operador IN ({m}) AND status <> ?", (*ids, PLANO_CONCLUIDO))  # nosec B608
        cont["planos"] = int(cursor.fetchone()[0])
        amanha = date.fromordinal(_hoje().toordinal() + 1)
        cursor.execute(f"SELECT COUNT(*), COUNT(DISTINCT id_operador) FROM dbo.wfm_escala_itens WHERE id_operador IN ({m}) AND data >= ?", (*ids, amanha))  # nosec B608
        dias, pessoas = cursor.fetchone()
        cont["escala_dias"], cont["escala_pessoas"] = int(dias or 0), int(pessoas or 0)
        cont["escala_desde"] = amanha.isoformat()
        return cont

    def eqa_previa(self, user, ids: list[int], id_destino: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            destino, pessoas = self._eqa_validar_movimento(cursor, user, ids, id_destino)
            ids_ok = [int(p["id_usuario"]) for p in pessoas]
            return {
                "destino": destino,
                "operadores": [{"id_usuario": int(p["id_usuario"]), "nome": _nome(p), "equipe": normalize_text(p.get("equipe_nome"))} for p in pessoas],
                "contagens": self._eqa_contagens(cursor, ids_ok),
                "turnos": self._eqa_turnos_a_trocar(cursor, ids_ok, destino),
            }
        finally:
            conn.close()

    def eqa_mover(self, user, ids: list[int], id_destino: int, turnos: dict | None = None, *, ip: str = "") -> dict:
        escolhidos = {int(k): int(v) for k, v in (turnos or {}).items() if int(v or 0) > 0}
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_equipes_admin_schema(cursor)
            destino, pessoas = self._eqa_validar_movimento(cursor, user, ids, id_destino)
            ids_ok = [int(p["id_usuario"]) for p in pessoas]
            contagens = self._eqa_contagens(cursor, ids_ok)
            mapa: dict[int, int] = {}
            faltando = []
            for t in self._eqa_turnos_a_trocar(cursor, ids_ok, destino):
                validos = {o["id_turno"] for o in t["opcoes"]}
                novo = escolhidos.get(t["id_turno"]) or t["id_destino_auto"]
                if not novo or novo not in validos:
                    faltando.append(t["rotulo"])
                    continue
                mapa[t["id_turno"]] = novo
            if faltando:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha o turno do novo supervisor para: " + "; ".join(faltando) + ".")
            autor = normalize_text(getattr(user, "nome", "")) or getattr(user, "username", "") or "sistema"
            id_sup = destino["id_supervisor"]
            marc = _marcadores(ids_ok)

            # 1) Cadastro: equipe e supervisor (só o responsável; o apoio não recebe pendências).
            cursor.execute(f"SELECT id_operador, id_supervisor FROM dbo.usuarios_supervisores WHERE id_operador IN ({marc})", tuple(ids_ok))  # nosec B608
            sups_antes: dict[int, list[int]] = {}
            for id_op, id_s in cursor.fetchall():
                sups_antes.setdefault(int(id_op), []).append(int(id_s))
            cursor.execute(f"UPDATE dbo.usuarios SET id_equipe = ?, atualizado_em = GETDATE() WHERE id_usuario IN ({marc})", (destino["id_equipe"], *ids_ok))  # nosec B608
            cursor.execute(f"DELETE FROM dbo.usuarios_supervisores WHERE id_operador IN ({marc})", tuple(ids_ok))  # nosec B608
            for id_op in ids_ok:
                cursor.execute("INSERT INTO dbo.usuarios_supervisores (id_operador, id_supervisor) VALUES (?, ?)", (id_op, id_sup))

            # 2) e 3) Em aberto: planos de ação e escala de amanhã em diante (histórico fica).
            trocados = self._eqa_migrar_aberto(cursor, user, ids_ok, id_sup, destino["supervisor_nome"], destino["nome"], mapa, autor=autor, ip=ip)

            self.mon_log(
                cursor, user, acao="equipe_mover", operacao=destino["operacao"], modulo="Equipes", entidade="equipe",
                entidade_id=destino["id_equipe"],
                anterior={"operadores": {str(p["id_usuario"]): {"id_equipe": p.get("id_equipe"), "supervisores": sups_antes.get(int(p["id_usuario"]), [])} for p in pessoas}},
                posterior={"id_equipe": destino["id_equipe"], "id_supervisor": id_sup, "turnos": {str(k): v for k, v in mapa.items()}},
                detalhes={"operadores": [_nome(p) for p in pessoas], "contagens": contagens, "dias_escala_trocados": trocados}, ip=ip,
            )
            conn.commit()
            return {"success": True, "movidos": len(ids_ok), "destino": destino, "contagens": contagens, "dias_escala_trocados": trocados}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _eqa_migrar_aberto(self, cursor, user, ids: list[int], id_sup: int, sup_nome: str, equipe_nome: str, mapa: dict[int, int], *, autor: str, ip: str = "") -> int:
        """Passa para o novo supervisor o que está EM ABERTO dos operadores: planos de ação não concluídos e a escala de
        amanhã em diante (turno antigo -> turno de `mapa`). Monitorias e trocas pendentes seguem o vínculo atual sozinhas.
        Devolve quantos dias da escala mudaram. Nada até hoje é alterado."""
        marc = _marcadores(ids)
        cursor.execute(
            f"SELECT id_plano, status FROM dbo.monitoria_planos WHERE id_operador IN ({marc}) AND status <> ? AND ISNULL(id_responsavel, 0) <> ?",  # nosec B608
            (*ids, PLANO_CONCLUIDO, int(id_sup)),
        )
        for id_plano, st in cursor.fetchall():
            cursor.execute("UPDATE dbo.monitoria_planos SET id_responsavel = ?, responsavel_nome = ? WHERE id_plano = ?", (id_sup, sup_nome, int(id_plano)))
            cursor.execute(
                "INSERT INTO dbo.monitoria_plano_historico (id_plano, evento, status_novo, detalhe, por) VALUES (?, 'responsavel', ?, ?, ?)",
                (int(id_plano), normalize_text(st), f"Operador mudou para a equipe {equipe_nome}: responsável agora é {sup_nome}.", autor),
            )
        if not mapa:
            return 0
        amanha = date.fromordinal(_hoje().toordinal() + 1)
        cursor.execute(
            f"SELECT id_item, operacao, id_operador, data, id_turno FROM dbo.wfm_escala_itens WHERE id_operador IN ({marc}) AND data >= ? "  # nosec B608
            f"AND id_turno IN ({_marcadores(mapa)})",
            (*ids, amanha, *mapa.keys()),
        )
        trocados: dict[tuple[int, str], int] = {}
        por_op: dict[tuple[str, int], list] = {}
        for id_item, op, id_op, dia, id_turno in cursor.fetchall():
            novo = mapa[int(id_turno)]
            cursor.execute(
                "UPDATE dbo.wfm_escala_itens SET id_turno = ?, versao_linha = versao_linha + 1, atualizado_por = ?, atualizado_em = GETDATE() WHERE id_item = ?",
                (novo, autor, int(id_item)),
            )
            dia_iso = dia.isoformat() if hasattr(dia, "isoformat") else str(dia)
            trocados[(int(id_op), dia_iso)] = novo
            por_op.setdefault((normalize_text(op), int(id_op)), []).append({"de": int(id_turno), "para": novo})
        for (op, id_op), mudancas in por_op.items():
            self.wfm_audit(
                cursor, user, operacao=op, acao="mudar_equipe", entidade="escala_item", entidade_id=str(id_op),
                antes={"turnos": sorted({m["de"] for m in mudancas})},
                depois={"turnos": sorted({m["para"] for m in mudancas}), "equipe": equipe_nome, "dias": len(mudancas)},
                justificativa=f"Mudança de equipe para {equipe_nome} ({sup_nome}).", ip=ip,
            )
        self._eqa_acertar_trocas_abertas(cursor, ids, trocados)
        return len(trocados)

    def eqa_sincronizar_operadores(self, cursor, user, antes: dict[int, dict], *, ip: str = "") -> dict:
        """Chamado pelas OUTRAS telas que mudam equipe ou supervisor de operador (cadastro do usuário, transferir supervisão,
        Equipes do supervisor). `antes` = {id_operador: {"id_equipe": ..., "supervisores": [...]}} lido ANTES da mudança.

        Deixa equipe e supervisor coerentes (regra de 24/11: 1 equipe por operador, o responsável da equipe é o supervisor)
        e passa o que está em aberto para o novo responsável. A escala só troca para turno com o MESMO horário; o que não
        tiver par fica como está e volta em `turnos_sem_par` (a tela Equipes da Tecnologia resolve escolhendo o turno)."""
        ensure_equipes_admin_schema(cursor)
        autor = normalize_text(getattr(user, "nome", "")) or getattr(user, "username", "") or "sistema"
        sem_par = 0
        for id_op, prev in antes.items():
            cursor.execute(
                "SELECT u.id_equipe, u.perfil_id, e.id_supervisor, e.nome FROM dbo.usuarios u LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe "
                "WHERE u.id_usuario = ?",
                (int(id_op),),
            )
            linha = cursor.fetchone()
            if not linha or papel(linha[1]) != ROLE_OPERATOR:
                continue
            id_equipe, resp_equipe, nome_equipe = (int(linha[0]) if linha[0] else None), (int(linha[2]) if linha[2] else None), normalize_text(linha[3])
            cursor.execute("SELECT id_supervisor FROM dbo.usuarios_supervisores WHERE id_operador = ?", (int(id_op),))
            sups = [int(r[0]) for r in cursor.fetchall()]
            mudou_equipe = id_equipe != prev.get("id_equipe")
            if mudou_equipe and resp_equipe and sups != [resp_equipe]:
                # Mudou a equipe: o responsável da equipe nova passa a ser o supervisor.
                cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ?", (int(id_op),))
                cursor.execute("INSERT INTO dbo.usuarios_supervisores (id_operador, id_supervisor) VALUES (?, ?)", (int(id_op), resp_equipe))
                sups = [resp_equipe]
            novo = sups[0] if sups else None
            if not novo or novo in (prev.get("supervisores") or []):
                continue
            if not mudou_equipe and resp_equipe != novo:
                # Mudou só o supervisor: a equipe passa a ser a do novo supervisor na mesma operação (se ele tiver uma).
                cursor.execute(
                    "SELECT TOP 1 e.id_equipe, e.nome FROM dbo.equipes_operacao e JOIN dbo.usuarios_operacoes uo ON uo.operacao = e.operacao AND uo.id_usuario = ? "
                    "WHERE e.id_supervisor = ? AND e.ativo = 1 ORDER BY e.id_equipe",
                    (int(id_op), novo),
                )
                eq = cursor.fetchone()
                if eq:
                    cursor.execute("UPDATE dbo.usuarios SET id_equipe = ?, atualizado_em = GETDATE() WHERE id_usuario = ?", (int(eq[0]), int(id_op)))
                    nome_equipe = normalize_text(eq[1])
            cursor.execute("SELECT nome, sobrenome FROM dbo.usuarios WHERE id_usuario = ?", (novo,))
            r = cursor.fetchone()
            sup_nome = " ".join(p for p in (normalize_text(r[0]), normalize_text(r[1])) if p) if r else ""
            mapa = {}
            for t in self._eqa_turnos_a_trocar_auto(cursor, [int(id_op)], novo):
                if t["id_destino_auto"]:
                    mapa[t["id_turno"]] = t["id_destino_auto"]
                else:
                    sem_par += t["dias"]
            self._eqa_migrar_aberto(cursor, user, [int(id_op)], novo, sup_nome, nome_equipe or sup_nome, mapa, autor=autor, ip=ip)
        return {"turnos_sem_par": sem_par}

    def _eqa_turnos_a_trocar_auto(self, cursor, ids: list[int], id_sup: int) -> list[dict]:
        """Como `_eqa_turnos_a_trocar`, mas o turno de destino é procurado na MESMA operação do item da escala."""
        amanha = date.fromordinal(_hoje().toordinal() + 1)
        cursor.execute(
            f"""
            SELECT DISTINCT t.id_turno, t.operacao, t.tipo, t.entrada, t.saida
            FROM dbo.wfm_escala_itens i JOIN dbo.wfm_turnos t ON t.id_turno = i.id_turno
            WHERE i.id_operador IN ({_marcadores(ids)}) AND i.data >= ? AND t.id_supervisor IS NOT NULL AND t.id_supervisor <> ?
            """,  # nosec B608
            (*ids, amanha, int(id_sup)),
        )
        antigos = rows_to_dicts(cursor, cursor.fetchall())
        saida = []
        for t in antigos:
            cursor.execute(
                "SELECT TOP 1 id_turno FROM dbo.wfm_turnos WHERE ativo = 1 AND id_supervisor = ? AND operacao = ? AND tipo = ? AND entrada = ? AND saida = ? ORDER BY id_turno",
                (int(id_sup), t["operacao"], t["tipo"], t["entrada"], t["saida"]),
            )
            par = cursor.fetchone()
            cursor.execute(
                f"SELECT COUNT(*) FROM dbo.wfm_escala_itens WHERE id_operador IN ({_marcadores(ids)}) AND data >= ? AND id_turno = ?",  # nosec B608
                (*ids, amanha, int(t["id_turno"])),
            )
            saida.append({"id_turno": int(t["id_turno"]), "id_destino_auto": int(par[0]) if par else None, "dias": int(cursor.fetchone()[0])})
        return saida

    @staticmethod
    def _eqa_acertar_trocas_abertas(cursor, ids: list[int], trocados: dict[tuple[int, str], int]) -> None:
        """Troca em aberto guarda a "foto" das células (turno + versão). Se a mudança de equipe trocou o turno de uma célula,
        a foto acompanha (o pedido continua valendo, agora com o turno do novo supervisor). Troca decidida não é tocada."""
        if not trocados:
            return
        m = _marcadores(ids)
        cursor.execute(
            f"SELECT id_troca, operacao, base_json FROM dbo.wfm_trocas WHERE estado IN ({_marcadores(TROCAS_ABERTAS)}) "  # nosec B608
            f"AND (id_solicitante IN ({m}) OR id_alvo IN ({m}))",
            (*TROCAS_ABERTAS, *ids, *ids),
        )
        for id_troca, operacao, base_json in cursor.fetchall():
            base = json.loads(base_json or "[]")
            mudou = False
            for b in base:
                chave = (int(b.get("id_operador") or 0), str(b.get("data")))
                if chave in trocados:
                    cursor.execute(
                        "SELECT id_turno, versao_linha FROM dbo.wfm_escala_itens WHERE operacao = ? AND id_operador = ? AND data = ?",
                        (operacao, chave[0], date.fromisoformat(chave[1])),
                    )
                    atual = cursor.fetchone()
                    if atual:
                        b["id_turno"], b["versao_linha"] = int(atual[0]), int(atual[1])
                        mudou = True
            if mudou:
                cursor.execute(
                    "UPDATE dbo.wfm_trocas SET base_json = ?, atualizado_em = GETDATE() WHERE id_troca = ?",
                    (json.dumps(base, ensure_ascii=False), int(id_troca)),
                )

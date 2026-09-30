"""WFM — Turnos e Plantões (Fase 1): cadastros, contexto e auditoria.

Mixin do DatabaseRepository, SQL puro (pyodbc). Escala/publicação/presença estão
em `wfm_escala.py`. Toda operação filtra por `operacao` NO SERVIDOR e passa por
`services/wfm_scope.py`; esconder botão no front nunca é a única barreira.

SUPOSIÇÕES (pendentes de confirmação — ver resumo da Fase 1; versão mais restritiva):
  * Sem vínculo em `usuarios_operacoes`, perfis não globais não acessam nada.
  * Contratos/limites semeados abaixo são valores PADRÃO editáveis (Adm e Control
    Desk); a validação jurídica formal acontece antes de produção.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPERVISOR
from ..services import wfm_scope
from ..services.helpers import normalize_text, rows_to_dicts

CATEGORIAS_SKILL = ("IDIOMA", "PRODUTO", "RETENCAO", "OUTRO")
TIPOS_CONTRATO = ("ESTAGIARIO", "CLT", "TERCEIRO")
TIPOS_TURNO = ("TRABALHO", "FOLGA", "DSR")
TIPOS_EVENTO = ("FERIADO", "DATA_ESPECIAL", "DIA_ESPECIAL", "HORARIO_ESPECIAL")
TIPOS_PAUSA = ("DESCANSO", "REFEICAO", "LANCHE", "OUTRA")

# Padrões semeados por operação (editáveis). NR-17 (pausas) parametrizado por contrato.
_NR17_PADRAO = [
    {"a_partir_de_min": 300, "tipo": "DESCANSO", "quantidade": 2, "duracao_min": 10},
    {"a_partir_de_min": 300, "tipo": "REFEICAO", "quantidade": 1, "duracao_min": 20},
]
CONTRATOS_PADRAO = (
    ("EST4", "Estagiário 4h", "ESTAGIARIO", 240, 660, 6, None, True, []),
    ("EST6", "Estagiário 6h", "ESTAGIARIO", 360, 660, 6, None, True, []),
    ("CLT6", "CLT 6h", "CLT", 360, 660, 6, None, False, _NR17_PADRAO),
    ("CLT8", "CLT 8h", "CLT", 480, 660, 6, None, False, []),
    ("TERCEIRO", "Terceiro (contrato próprio)", "TERCEIRO", 480, 660, 6, None, False, []),
)
TURNOS_FIXOS_PADRAO = (
    ("FOLGA", "Folga", "FOLGA", "#94a3b8"),
    ("DSR", "Descanso semanal remunerado", "DSR", "#64748b"),
)


def _json(valor: Any) -> str | None:
    if valor is None:
        return None
    return valor if isinstance(valor, str) else json.dumps(valor, ensure_ascii=False, default=str)


def _hhmm_valido(valor: str | None) -> bool:
    if not valor or len(valor) != 5 or valor[2] != ":":
        return False
    try:
        hh, mm = int(valor[:2]), int(valor[3:])
    except ValueError:
        return False
    return 0 <= hh <= 23 and 0 <= mm <= 59


class WfmRepositoryMixin:
    # ------------------------------------------------------------------
    # Auditoria (append-only) e escopo
    # ------------------------------------------------------------------
    def wfm_audit(
        self,
        cursor,
        user,
        *,
        operacao: str,
        acao: str,
        entidade: str,
        entidade_id: Any = "",
        antes: Any = None,
        depois: Any = None,
        justificativa: str = "",
        ip: str = "",
    ) -> None:
        cursor.execute(
            """
            INSERT INTO dbo.wfm_auditoria
            (operacao, id_usuario, usuario_nome, perfil, acao, entidade, entidade_id,
             antes_json, depois_json, justificativa, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalize_text(operacao),
                getattr(user, "id_usuario", None),
                normalize_text(getattr(user, "nome", "")) or normalize_text(getattr(user, "username", "")) or "sistema",
                normalize_text(getattr(user, "perfil", "")) or "sistema",
                acao,
                entidade,
                str(entidade_id) if entidade_id != "" else None,
                _json(antes),
                _json(depois),
                normalize_text(justificativa)[:400] or None,
                ip or None,
            ),
        )

    def _wfm_exigir_operacao(self, cursor, user, operacao: str, *, escrita: bool = False) -> str:
        operacao = normalize_text(operacao)
        if not operacao:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a operação.")
        if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, operacao):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta operação está fora do seu escopo de acesso.")
        cursor.execute("SELECT ativo FROM dbo.operacoes WHERE chave = ?", (operacao,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operação não encontrada.")
        if escrita and not bool(row[0]):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A operação está inativa: nenhuma alteração é permitida.")
        self._wfm_garantir_padroes(cursor, operacao)
        return operacao

    def _wfm_equipe_ids(self, cursor, id_supervisor: int | None, operacao: str) -> set[int]:
        """Operadores da equipe de um supervisor NESTA operação (usuarios_supervisores)."""
        if not id_supervisor:
            return set()
        cursor.execute(
            """
            SELECT s.id_operador FROM dbo.usuarios_supervisores s
            JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = s.id_operador AND uo.operacao = ?
            WHERE s.id_supervisor = ?
            """,
            (operacao, int(id_supervisor)),
        )
        return {int(r[0]) for r in cursor.fetchall()}

    def _wfm_garantir_padroes(self, cursor, operacao: str) -> None:
        """Semeia contratos e turnos fixos (folga/DSR) da operação, sem sobrescrever."""
        cursor.execute("SELECT TOP 1 1 FROM dbo.wfm_contratos WHERE operacao = ?", (operacao,))
        if not cursor.fetchone():
            for codigo, nome, tipo, jornada, inter, dias, feriado, duro, pausas in CONTRATOS_PADRAO:
                cursor.execute(
                    """
                    INSERT INTO dbo.wfm_contratos (operacao, codigo, nome, tipo, jornada_diaria_max_min,
                        interjornada_min_min, max_dias_consecutivos, jornada_feriado_max_min,
                        jornada_bloqueio_duro, exigencias_pausa_json, atualizado_por)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sistema')
                    """,
                    (operacao, codigo, nome, tipo, jornada, inter, dias, feriado, 1 if duro else 0, _json(pausas)),
                )
        for codigo, nome, tipo, cor in TURNOS_FIXOS_PADRAO:
            cursor.execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.wfm_turnos WHERE operacao = ? AND codigo = ?) "
                "INSERT INTO dbo.wfm_turnos (operacao, codigo, nome, tipo, cor, atualizado_por) VALUES (?, ?, ?, ?, ?, 'sistema')",
                (operacao, codigo, operacao, codigo, nome, tipo, cor),
            )

    # ------------------------------------------------------------------
    # Contexto
    # ------------------------------------------------------------------
    def wfm_contexto(self, user) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT chave, nome, ativo FROM dbo.operacoes WHERE ativo = 1 ORDER BY nome")
            todas = [{"chave": normalize_text(r[0]), "nome": normalize_text(r[1])} for r in cursor.fetchall()]
        finally:
            conn.close()
        permitidas = wfm_scope.operacoes_permitidas(user.perfil, user.operacoes)
        operacoes = todas if permitidas is None else [o for o in todas if o["chave"] in permitidas]
        return {
            "perfil": user.perfil,
            "global": permitidas is None,
            "operacoes": operacoes,
            "id_usuario": user.id_usuario,
            "categorias_skill": list(CATEGORIAS_SKILL),
            "tipos_contrato": list(TIPOS_CONTRATO),
            "tipos_turno": list(TIPOS_TURNO),
            "tipos_evento": list(TIPOS_EVENTO),
            "tipos_pausa": list(TIPOS_PAUSA),
        }

    # ------------------------------------------------------------------
    # Contratos (Adm e Control Desk)
    # ------------------------------------------------------------------
    def wfm_list_contratos(self, user, operacao: str) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute(
                """
                SELECT id_contrato, codigo, nome, tipo, jornada_diaria_max_min, interjornada_min_min,
                       max_dias_consecutivos, jornada_feriado_max_min, jornada_bloqueio_duro,
                       exigencias_pausa_json, ativo
                FROM dbo.wfm_contratos WHERE operacao = ? ORDER BY tipo, codigo
                """,
                (operacao,),
            )
            itens = []
            for r in rows_to_dicts(cursor, cursor.fetchall()):
                r["jornada_bloqueio_duro"] = bool(r["jornada_bloqueio_duro"])
                r["ativo"] = bool(r["ativo"])
                try:
                    r["exigencias_pausa"] = json.loads(r.pop("exigencias_pausa_json") or "[]")
                except ValueError:
                    r["exigencias_pausa"] = []
                itens.append(r)
            return itens
        finally:
            conn.close()

    def wfm_save_contrato(self, user, data: dict, id_contrato: int | None = None, *, ip: str = "") -> dict:
        if not wfm_scope.pode_editar_contratos(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente Administrador e Control Desk editam contratos.")
        tipo = normalize_text(data.get("tipo")).upper()
        if tipo not in TIPOS_CONTRATO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de contrato inválido.")
        codigo = normalize_text(data.get("codigo")).upper()
        nome = normalize_text(data.get("nome"))
        if not codigo or not nome:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe código e nome do contrato.")
        exigencias = []
        for item in data.get("exigencias_pausa") or []:
            tipo_pausa = normalize_text(item.get("tipo")).upper()
            if tipo_pausa not in TIPOS_PAUSA:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de pausa obrigatória inválido.")
            exigencias.append(
                {
                    "a_partir_de_min": int(item.get("a_partir_de_min") or 0),
                    "tipo": tipo_pausa,
                    "quantidade": int(item.get("quantidade") or 0),
                    "duracao_min": int(item.get("duracao_min") or 0),
                }
            )
        valores = (
            nome,
            tipo,
            int(data["jornada_diaria_max_min"]),
            int(data["interjornada_min_min"]),
            int(data["max_dias_consecutivos"]),
            int(data["jornada_feriado_max_min"]) if data.get("jornada_feriado_max_min") not in (None, "") else None,
            1 if data.get("jornada_bloqueio_duro") else 0,
            _json(exigencias),
            1 if data.get("ativo", True) else 0,
        )
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, data.get("operacao", ""), escrita=True)
            anterior = None
            if id_contrato:
                cursor.execute(
                    "SELECT codigo, nome, tipo, jornada_diaria_max_min, interjornada_min_min, max_dias_consecutivos, "
                    "jornada_feriado_max_min, jornada_bloqueio_duro, exigencias_pausa_json, ativo "
                    "FROM dbo.wfm_contratos WHERE id_contrato = ? AND operacao = ?",
                    (int(id_contrato), operacao),
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contrato não encontrado nesta operação.")
                anterior = {k: (v if not isinstance(v, bool) else v) for k, v in zip(
                    ("codigo", "nome", "tipo", "jornada_diaria_max_min", "interjornada_min_min", "max_dias_consecutivos",
                     "jornada_feriado_max_min", "jornada_bloqueio_duro", "exigencias_pausa_json", "ativo"), row)}
                cursor.execute(
                    """
                    UPDATE dbo.wfm_contratos SET nome = ?, tipo = ?, jornada_diaria_max_min = ?, interjornada_min_min = ?,
                        max_dias_consecutivos = ?, jornada_feriado_max_min = ?, jornada_bloqueio_duro = ?,
                        exigencias_pausa_json = ?, ativo = ?, atualizado_por = ?, atualizado_em = GETDATE()
                    WHERE id_contrato = ? AND operacao = ?
                    """,
                    (*valores, normalize_text(user.nome) or user.username, int(id_contrato), operacao),
                )
                resolved = int(id_contrato)
            else:
                cursor.execute("SELECT TOP 1 1 FROM dbo.wfm_contratos WHERE operacao = ? AND codigo = ?", (operacao, codigo))
                if cursor.fetchone():
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe um contrato com este código nesta operação.")
                cursor.execute(
                    """
                    INSERT INTO dbo.wfm_contratos (operacao, codigo, nome, tipo, jornada_diaria_max_min, interjornada_min_min,
                        max_dias_consecutivos, jornada_feriado_max_min, jornada_bloqueio_duro, exigencias_pausa_json, ativo, atualizado_por)
                    OUTPUT INSERTED.id_contrato VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (operacao, codigo, *valores, normalize_text(user.nome) or user.username),
                )
                resolved = int(cursor.fetchone()[0])
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="salvar_contrato", entidade="contrato", entidade_id=resolved,
                antes=anterior, depois={"codigo": codigo, "nome": nome, "tipo": tipo, "limites": list(valores[2:8])}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_contrato": resolved}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Turnos-modelo (Adm, Control Desk, Supervisor)
    # ------------------------------------------------------------------
    def wfm_list_turnos(self, user, operacao: str) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute(
                "SELECT id_turno, codigo, nome, tipo, cor, entrada, saida, pausas_json, ativo "
                "FROM dbo.wfm_turnos WHERE operacao = ? ORDER BY tipo DESC, codigo",
                (operacao,),
            )
            itens = []
            for r in rows_to_dicts(cursor, cursor.fetchall()):
                r["ativo"] = bool(r["ativo"])
                try:
                    r["pausas"] = json.loads(r.pop("pausas_json") or "[]")
                except ValueError:
                    r["pausas"] = []
                itens.append(r)
            return itens
        finally:
            conn.close()

    def wfm_save_turno(self, user, data: dict, id_turno: int | None = None, *, ip: str = "") -> dict:
        if not wfm_scope.pode_editar_cadastros(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão para editar turnos.")
        tipo = normalize_text(data.get("tipo") or "TRABALHO").upper()
        if tipo not in TIPOS_TURNO:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de turno inválido.")
        codigo = normalize_text(data.get("codigo")).upper()
        nome = normalize_text(data.get("nome"))
        if not codigo or not nome:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe código e nome do turno.")
        entrada, saida = normalize_text(data.get("entrada")) or None, normalize_text(data.get("saida")) or None
        pausas: list[dict] = []
        if tipo == "TRABALHO":
            if not (_hhmm_valido(entrada) and _hhmm_valido(saida)) or entrada == saida:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe entrada e saída válidas (HH:MM).")
            for p in data.get("pausas") or []:
                tipo_pausa = normalize_text(p.get("tipo")).upper()
                if tipo_pausa not in TIPOS_PAUSA:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de pausa inválido.")
                pausas.append(
                    {
                        "offset_min": max(int(p.get("offset_min") or 0), 0),
                        "duracao_min": max(int(p.get("duracao_min") or 0), 1),
                        "tipo": tipo_pausa,
                    }
                )
        else:
            entrada = saida = None
        cor = normalize_text(data.get("cor")) or "#1f5fbf"
        if len(cor) not in (4, 7, 9) or not cor.startswith("#"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cor inválida (use #RRGGBB).")
        ativo = 1 if data.get("ativo", True) else 0
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, data.get("operacao", ""), escrita=True)
            anterior = None
            if id_turno:
                cursor.execute(
                    "SELECT codigo, nome, tipo, cor, entrada, saida, pausas_json, ativo FROM dbo.wfm_turnos "
                    "WHERE id_turno = ? AND operacao = ?",
                    (int(id_turno), operacao),
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turno não encontrado nesta operação.")
                anterior = dict(zip(("codigo", "nome", "tipo", "cor", "entrada", "saida", "pausas_json", "ativo"), row))
                anterior["ativo"] = bool(anterior["ativo"])
                codigo = normalize_text(anterior["codigo"])  # o código do turno nunca muda
                cursor.execute(
                    "UPDATE dbo.wfm_turnos SET nome = ?, tipo = ?, cor = ?, entrada = ?, saida = ?, pausas_json = ?, ativo = ?, "
                    "atualizado_por = ?, atualizado_em = GETDATE() WHERE id_turno = ? AND operacao = ?",
                    (nome, tipo, cor, entrada, saida, _json(pausas), ativo, normalize_text(user.nome) or user.username, int(id_turno), operacao),
                )
                resolved = int(id_turno)
            else:
                cursor.execute("SELECT TOP 1 1 FROM dbo.wfm_turnos WHERE operacao = ? AND codigo = ?", (operacao, codigo))
                if cursor.fetchone():
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe um turno com este código nesta operação.")
                cursor.execute(
                    "INSERT INTO dbo.wfm_turnos (operacao, codigo, nome, tipo, cor, entrada, saida, pausas_json, ativo, atualizado_por) "
                    "OUTPUT INSERTED.id_turno VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (operacao, codigo, nome, tipo, cor, entrada, saida, _json(pausas), ativo, normalize_text(user.nome) or user.username),
                )
                resolved = int(cursor.fetchone()[0])
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="salvar_turno", entidade="turno", entidade_id=resolved,
                antes=anterior, depois={"codigo": codigo, "nome": nome, "tipo": tipo, "entrada": entrada, "saida": saida, "ativo": bool(ativo)}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_turno": resolved}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Skills (idioma, produto, retenção)
    # ------------------------------------------------------------------
    def wfm_list_skills(self, user, operacao: str) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute(
                "SELECT id_skill, categoria, nome, ativo FROM dbo.wfm_skills WHERE operacao = ? ORDER BY categoria, nome",
                (operacao,),
            )
            return [
                {"id_skill": r[0], "categoria": normalize_text(r[1]), "nome": normalize_text(r[2]), "ativo": bool(r[3])}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def wfm_save_skill(self, user, data: dict, id_skill: int | None = None, *, ip: str = "") -> dict:
        if not wfm_scope.pode_editar_cadastros(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão para editar skills.")
        categoria = normalize_text(data.get("categoria")).upper()
        nome = normalize_text(data.get("nome"))
        if categoria not in CATEGORIAS_SKILL or not nome:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe categoria válida e nome da skill.")
        ativo = 1 if data.get("ativo", True) else 0
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, data.get("operacao", ""), escrita=True)
            cursor.execute(
                "SELECT TOP 1 1 FROM dbo.wfm_skills WHERE operacao = ? AND categoria = ? AND LOWER(nome) = LOWER(?) AND id_skill <> ?",
                (operacao, categoria, nome, int(id_skill or 0)),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe esta skill nesta operação.")
            if id_skill:
                cursor.execute(
                    "UPDATE dbo.wfm_skills SET categoria = ?, nome = ?, ativo = ? WHERE id_skill = ? AND operacao = ?",
                    (categoria, nome, ativo, int(id_skill), operacao),
                )
                if cursor.rowcount == 0:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill não encontrada nesta operação.")
                resolved = int(id_skill)
            else:
                cursor.execute(
                    "INSERT INTO dbo.wfm_skills (operacao, categoria, nome, ativo) OUTPUT INSERTED.id_skill VALUES (?, ?, ?, ?)",
                    (operacao, categoria, nome, ativo),
                )
                resolved = int(cursor.fetchone()[0])
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="salvar_skill", entidade="skill", entidade_id=resolved,
                depois={"categoria": categoria, "nome": nome, "ativo": bool(ativo)}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_skill": resolved}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Operadores: contrato vigente e skills
    # ------------------------------------------------------------------
    def _wfm_operador_da_operacao(self, cursor, operacao: str, id_operador: int) -> dict:
        cursor.execute(
            """
            SELECT u.id_usuario, u.nome, u.sobrenome FROM dbo.usuarios u
            JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario AND uo.operacao = ?
            WHERE u.id_usuario = ? AND u.perfil_id = ?
            """,
            (operacao, int(id_operador), ROLE_OPERATOR),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operador não encontrado nesta operação.")
        return {"id_usuario": int(row[0]), "nome": f"{normalize_text(row[1])} {normalize_text(row[2])}".strip()}

    def _wfm_exigir_edicao_do_operador(self, cursor, user, operacao: str, id_operador: int) -> None:
        equipe = self._wfm_equipe_ids(cursor, user.id_usuario, operacao) if user.perfil == ROLE_SUPERVISOR else set()
        if not wfm_scope.pode_editar_escala_de(
            perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
            operacao=operacao, id_operador=int(id_operador), equipe_supervisor=equipe,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Você não pode alterar este operador (fora da sua equipe/escopo ou conflito de interesse).",
            )

    def wfm_set_contrato_operador(
        self, user, operacao: str, id_operador: int, id_contrato: int, vigencia_ini, *, ip: str = ""
    ) -> dict:
        """Vincula um contrato ao operador a partir de `vigencia_ini`; encerra a vigência anterior no dia anterior."""
        from datetime import timedelta

        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_operador_da_operacao(cursor, operacao, id_operador)
            if user.perfil != ROLE_ADMIN:
                self._wfm_exigir_edicao_do_operador(cursor, user, operacao, id_operador)
            cursor.execute("SELECT codigo FROM dbo.wfm_contratos WHERE id_contrato = ? AND operacao = ? AND ativo = 1", (int(id_contrato), operacao))
            contrato = cursor.fetchone()
            if not contrato:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contrato não encontrado ou inativo nesta operação.")
            cursor.execute(
                "SELECT id_vinculo, id_contrato, vigencia_ini FROM dbo.wfm_operador_contratos "
                "WHERE operacao = ? AND id_operador = ? AND vigencia_fim IS NULL",
                (operacao, int(id_operador)),
            )
            aberto = cursor.fetchone()
            if aberto and aberto[2] >= vigencia_ini:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A nova vigência deve começar depois da vigência atual.")
            if aberto:
                cursor.execute(
                    "UPDATE dbo.wfm_operador_contratos SET vigencia_fim = ? WHERE id_vinculo = ?",
                    (vigencia_ini - timedelta(days=1), int(aberto[0])),
                )
            cursor.execute(
                "INSERT INTO dbo.wfm_operador_contratos (operacao, id_operador, id_contrato, vigencia_ini, criado_por) VALUES (?, ?, ?, ?, ?)",
                (operacao, int(id_operador), int(id_contrato), vigencia_ini, normalize_text(user.nome) or user.username),
            )
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="vincular_contrato", entidade="operador", entidade_id=id_operador,
                antes={"id_contrato": int(aberto[1])} if aberto else None,
                depois={"id_contrato": int(id_contrato), "codigo": normalize_text(contrato[0]), "vigencia_ini": str(vigencia_ini)}, ip=ip,
            )
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def wfm_set_skills_operador(self, user, operacao: str, id_operador: int, ids_skill: list[int], *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            self._wfm_operador_da_operacao(cursor, operacao, id_operador)
            if user.perfil != ROLE_ADMIN:
                self._wfm_exigir_edicao_do_operador(cursor, user, operacao, id_operador)
            ids = sorted({int(i) for i in ids_skill})
            if ids:
                marcadores = ",".join("?" for _ in ids)
                cursor.execute(
                    f"SELECT COUNT(*) FROM dbo.wfm_skills WHERE operacao = ? AND ativo = 1 AND id_skill IN ({marcadores})",
                    (operacao, *ids),
                )
                if int(cursor.fetchone()[0]) != len(ids):
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Skill inválida para esta operação.")
            cursor.execute("SELECT id_skill FROM dbo.wfm_usuario_skills WHERE operacao = ? AND id_usuario = ?", (operacao, int(id_operador)))
            antes = sorted(int(r[0]) for r in cursor.fetchall())
            cursor.execute("DELETE FROM dbo.wfm_usuario_skills WHERE operacao = ? AND id_usuario = ?", (operacao, int(id_operador)))
            for id_skill in ids:
                cursor.execute(
                    "INSERT INTO dbo.wfm_usuario_skills (operacao, id_usuario, id_skill) VALUES (?, ?, ?)",
                    (operacao, int(id_operador), id_skill),
                )
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="definir_skills", entidade="operador", entidade_id=id_operador,
                antes={"skills": antes}, depois={"skills": ids}, ip=ip,
            )
            conn.commit()
            return {"success": True, "skills": ids}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Calendário especial (feriados, datas, dias e horários especiais)
    # ------------------------------------------------------------------
    def wfm_list_calendario(self, user, operacao: str, ano_mes: str = "") -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            sql = (
                "SELECT id_item, tipo, data_ini, data_fim, descricao, id_turno, entrada, saida, ativo "
                "FROM dbo.wfm_calendario_especial WHERE operacao = ? AND ativo = 1"
            )
            params: list = [operacao]
            if ano_mes:
                from ..services.wfm_montagem import dias_do_mes

                dias = dias_do_mes(ano_mes)
                sql += " AND data_ini <= ? AND data_fim >= ?"
                params += [dias[-1], dias[0]]
            cursor.execute(sql + " ORDER BY data_ini, id_item", tuple(params))
            itens = []
            for r in rows_to_dicts(cursor, cursor.fetchall()):
                r["data_ini"], r["data_fim"] = r["data_ini"].isoformat(), r["data_fim"].isoformat()
                r["ativo"] = bool(r["ativo"])
                itens.append(r)
            return itens
        finally:
            conn.close()

    def wfm_save_evento(self, user, data: dict, id_item: int | None = None, *, ip: str = "") -> dict:
        from datetime import date

        if not wfm_scope.pode_editar_cadastros(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão para editar o calendário especial.")
        tipo = normalize_text(data.get("tipo")).upper()
        descricao = normalize_text(data.get("descricao"))
        if tipo not in TIPOS_EVENTO or not descricao:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe tipo válido e descrição.")
        try:
            data_ini = date.fromisoformat(str(data.get("data_ini")))
            data_fim = date.fromisoformat(str(data.get("data_fim") or data.get("data_ini")))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Datas inválidas (AAAA-MM-DD).")
        if data_fim < data_ini or (data_fim - data_ini).days > 62:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Período inválido (máximo 62 dias).")
        id_turno = int(data["id_turno"]) if data.get("id_turno") not in (None, "", 0) else None
        entrada, saida = normalize_text(data.get("entrada")) or None, normalize_text(data.get("saida")) or None
        if tipo in ("DIA_ESPECIAL", "HORARIO_ESPECIAL") and not id_turno:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este tipo exige um turno-modelo.")
        if tipo == "HORARIO_ESPECIAL" and not (_hhmm_valido(entrada) and _hhmm_valido(saida)):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe entrada e saída válidas (HH:MM).")
        if tipo != "HORARIO_ESPECIAL":
            entrada = saida = None
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, data.get("operacao", ""), escrita=True)
            if id_turno:
                cursor.execute("SELECT tipo FROM dbo.wfm_turnos WHERE id_turno = ? AND operacao = ? AND ativo = 1", (id_turno, operacao))
                turno = cursor.fetchone()
                if not turno:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Turno inválido para esta operação.")
                if tipo in ("DIA_ESPECIAL", "HORARIO_ESPECIAL") and normalize_text(turno[0]) != "TRABALHO":
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use um turno de trabalho.")
            ativo = 1 if data.get("ativo", True) else 0
            anterior = None
            if id_item:
                cursor.execute(
                    "SELECT tipo, data_ini, data_fim, descricao, id_turno, entrada, saida, ativo FROM dbo.wfm_calendario_especial "
                    "WHERE id_item = ? AND operacao = ?",
                    (int(id_item), operacao),
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item não encontrado nesta operação.")
                anterior = {k: str(v) if hasattr(v, "isoformat") else v for k, v in zip(
                    ("tipo", "data_ini", "data_fim", "descricao", "id_turno", "entrada", "saida", "ativo"), row)}
                cursor.execute(
                    "UPDATE dbo.wfm_calendario_especial SET tipo = ?, data_ini = ?, data_fim = ?, descricao = ?, id_turno = ?, "
                    "entrada = ?, saida = ?, ativo = ?, atualizado_por = ?, atualizado_em = GETDATE() WHERE id_item = ? AND operacao = ?",
                    (tipo, data_ini, data_fim, descricao, id_turno, entrada, saida, ativo, normalize_text(user.nome) or user.username, int(id_item), operacao),
                )
                resolved = int(id_item)
            else:
                cursor.execute(
                    "INSERT INTO dbo.wfm_calendario_especial (operacao, tipo, data_ini, data_fim, descricao, id_turno, entrada, saida, ativo, atualizado_por) "
                    "OUTPUT INSERTED.id_item VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (operacao, tipo, data_ini, data_fim, descricao, id_turno, entrada, saida, ativo, normalize_text(user.nome) or user.username),
                )
                resolved = int(cursor.fetchone()[0])
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="salvar_calendario_especial", entidade="calendario_especial", entidade_id=resolved,
                antes=anterior, depois={"tipo": tipo, "data_ini": str(data_ini), "data_fim": str(data_fim), "descricao": descricao, "ativo": bool(ativo)}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_item": resolved}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Auditoria (Gestor/RH e Adm)
    # ------------------------------------------------------------------
    def wfm_list_auditoria(self, user, operacao: str = "", limite: int = 200, entidade: str = "", acao: str = "") -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            sql = (
                "SELECT TOP (?) id_auditoria, operacao, usuario_nome, perfil, acao, entidade, entidade_id, antes_json, "
                "depois_json, justificativa, ip, criado_em FROM dbo.wfm_auditoria WHERE 1 = 1"
            )
            params: list = [max(1, min(int(limite or 200), 500))]
            if operacao:
                operacao = self._wfm_exigir_operacao(cursor, user, operacao)
                sql += " AND operacao = ?"
                params.append(operacao)
            else:
                permitidas = wfm_scope.operacoes_permitidas(user.perfil, user.operacoes)
                if permitidas is not None:
                    if not permitidas:
                        return []
                    sql += f" AND operacao IN ({','.join('?' for _ in permitidas)})"
                    params += sorted(permitidas)
            if entidade:
                sql += " AND entidade = ?"
                params.append(normalize_text(entidade))
            if acao:
                sql += " AND acao = ?"
                params.append(normalize_text(acao))
            cursor.execute(sql + " ORDER BY id_auditoria DESC", tuple(params))
            itens = rows_to_dicts(cursor, cursor.fetchall())
            for item in itens:
                item["criado_em"] = item["criado_em"].isoformat() if item.get("criado_em") else None
            return itens
        finally:
            conn.close()

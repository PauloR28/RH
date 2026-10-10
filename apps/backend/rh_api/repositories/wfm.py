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
from datetime import date
from typing import Any

import pyodbc

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPERVISOR, WFM_PERFIS_PARTICIPANTES, WFM_PERFIS_TI
from ..services import wfm_scope
from ..services.helpers import normalize_text, rows_to_dicts

CATEGORIAS_SKILL = ("IDIOMA", "PRODUTO", "RETENCAO", "OUTRO")
TIPOS_CONTRATO = ("ESTAGIARIO", "CLT", "TERCEIRO", "APRENDIZ")
TIPOS_TURNO = ("TRABALHO", "FOLGA", "DSR", "SOBREAVISO")
# Perfis que participam (aparecem na grade) de uma escala: Operador nas operações comuns; Técnicos e
# Analista de TI nos tipos de escala do setor de TI.
PERFIS_ESCALA_COMUM = (ROLE_OPERATOR,)
PERFIS_ESCALA_TI = tuple(sorted(WFM_PERFIS_TI))
# Turnos-modelo semeados por tipo de escala do TI (editáveis em Cadastros).
TURNOS_TIPO_PADRAO = {
    "PLANTAO-SABADO": (("PLS", "Plantão de sábado", "TRABALHO", "#1f5fbf", "08:00", "12:00"),),
    "SOBREAVISO": (("SOB", "Sobreaviso", "SOBREAVISO", "#b45309", None, None),),
}
TIPOS_EVENTO = ("FERIADO", "DATA_ESPECIAL", "DIA_ESPECIAL", "HORARIO_ESPECIAL")
TIPOS_PAUSA = ("DESCANSO", "REFEICAO", "INTERVALO", "LANCHE", "OUTRA")

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
    ("APR6", "Jovem aprendiz 6h", "APRENDIZ", 360, 660, 6, None, True, []),
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


def _minutos_liquidos(entrada: str | None, saida: str | None, pausas: list[dict]) -> int:
    """Jornada líquida do turno: relógio menos os INTERVALOS não remunerados (as pausas NR-17 contam como jornada)."""
    if not entrada or not saida:
        return 0
    ini = int(entrada[:2]) * 60 + int(entrada[3:])
    fim = int(saida[:2]) * 60 + int(saida[3:])
    bruto = (fim - ini) % 1440 or 1440
    return max(bruto - sum(int(p["duracao_min"]) for p in pausas if p.get("tipo") == "INTERVALO"), 0)


class WfmRepositoryMixin:
    # ------------------------------------------------------------------
    # Auditoria (append-only) e escopo
    # ------------------------------------------------------------------
    def _wfm_notificar(self, cursor, *, usuarios=(), perfis=(), titulo: str, mensagem: str = "", entidade: str = "wfm",
                       entidade_id: str = "", ignorar=()) -> None:
        """Notificação in-app (bolinha vermelha) do WFM, categoria `wfm`, na mesma transação do evento; nunca notifica quem agiu."""
        ignorados = {int(i) for i in ignorar if i}
        for id_usuario in sorted({int(i) for i in usuarios if i} - ignorados):
            cursor.execute("SELECT login FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
            row = cursor.fetchone()
            login = normalize_text(row[0]) if row else ""
            if login:
                self._criar_notificacao(cursor, destinatario_usuario=login, titulo=titulo, mensagem=mensagem,
                                        categoria="wfm", entidade=entidade, entidade_id=entidade_id)
        for papel in sorted({normalize_text(p) for p in perfis if p}):
            self._criar_notificacao(cursor, destinatario_papel=papel, titulo=titulo, mensagem=mensagem,
                                    categoria="wfm", entidade=entidade, entidade_id=entidade_id)

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

    def _wfm_exigir_operacao(self, cursor, user, operacao: str, *, escrita: bool = False, permitir_inativa: bool = False, escala: bool = False) -> str:
        # `escala=True`: operação de escala (editar/publicar/fechar). A escala principal desativada/excluída só trava aí;
        # cadastros, jornadas e presença da operação continuam funcionando.
        """Valida escopo e existência. `operacao` pode ser a chave de um tipo de escala do TI (`TI::SOBREAVISO`):
        o escopo vale para a operação-base e a chave virtual é a que indexa as tabelas wfm_*."""
        operacao = normalize_text(operacao)
        if not operacao:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a operação.")
        if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, operacao):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta operação está fora do seu escopo de acesso.")
        if wfm_scope.eh_tipo_escala(operacao) or escala:
            cursor.execute("SELECT TOP 1 1 FROM dbo.wfm_operacao_config WHERE operacao = ? AND excluida = 1", (operacao,))
            if cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Esta escala foi excluída.")
        cursor.execute("SELECT ativo FROM dbo.operacoes WHERE chave = ?", (wfm_scope.operacao_base(operacao),))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operação não encontrada.")
        if escrita and not bool(row[0]):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A operação está inativa: nenhuma alteração é permitida.")
        if wfm_scope.eh_tipo_escala(operacao):
            cursor.execute("SELECT chave, ativo FROM dbo.wfm_tipos_escala WHERE chave = ?", (operacao,))
            tipo = cursor.fetchone()
            if not tipo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tipo de escala não encontrado.")
            operacao = normalize_text(tipo[0])
            if escrita and not permitir_inativa and not bool(tipo[1]):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esta escala está desativada: ative-a nas configurações para alterar.")
        elif escala and escrita and not permitir_inativa:
            cursor.execute("SELECT ativa FROM dbo.wfm_operacao_config WHERE operacao = ?", (operacao,))
            cfg = cursor.fetchone()
            if cfg and not bool(cfg[0]):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esta escala está desativada: ative-a nas configurações para alterar.")
        self._wfm_garantir_padroes(cursor, operacao)
        return operacao

    def _wfm_perfis_participantes(self, operacao: str) -> tuple[str, ...]:
        # Escalas criadas (tipos) reúnem os dois grupos: o vínculo à operação separa Operadores (atendimento) de Técnicos/Analista (TI).
        return PERFIS_ESCALA_COMUM + PERFIS_ESCALA_TI if wfm_scope.eh_tipo_escala(operacao) else PERFIS_ESCALA_COMUM

    def _wfm_participantes_sql(self, operacao: str) -> tuple[str, tuple]:
        """Filtro SQL (sobre `u`) dos participantes da escala + parâmetros (operação-base e perfis)."""
        perfis = self._wfm_perfis_participantes(operacao)
        return f"u.perfil_id IN ({','.join('?' for _ in perfis)})", (wfm_scope.operacao_base(operacao), *perfis)

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
            (wfm_scope.operacao_base(operacao), int(id_supervisor)),
        )
        return {int(r[0]) for r in cursor.fetchall()}

    def _wfm_garantir_padroes(self, cursor, operacao: str) -> None:
        """Semeia contratos e turnos fixos (folga/DSR) da operação, sem sobrescrever."""
        # A tela dispara várias requisições ao mesmo tempo: o semeio precisa tolerar concorrência
        # (travas no EXISTS e, por garantia, colisão de chave única é ignorada — outra requisição já semeou).
        # Jornadas e turnos-padrão só são semeados na PRIMEIRA vez que a escala é usada: o que o usuário excluir depois
        # não volta sozinho. (Folga/DSR são fixos e sempre existem.)
        cursor.execute(
            "SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.wfm_turnos WHERE operacao = ?) OR EXISTS (SELECT 1 FROM dbo.wfm_contratos WHERE operacao = ?) THEN 0 ELSE 1 END",
            (operacao, operacao),
        )
        primeira = bool(cursor.fetchone()[0])
        for codigo, nome, tipo, jornada, inter, dias, feriado, duro, pausas in (CONTRATOS_PADRAO if primeira else ()):
            try:
                cursor.execute(
                    """
                    IF NOT EXISTS (SELECT 1 FROM dbo.wfm_contratos WITH (UPDLOCK, HOLDLOCK) WHERE operacao = ? AND codigo = ?)
                    INSERT INTO dbo.wfm_contratos (operacao, codigo, nome, tipo, jornada_diaria_max_min,
                        interjornada_min_min, max_dias_consecutivos, jornada_feriado_max_min,
                        jornada_bloqueio_duro, exigencias_pausa_json, atualizado_por)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sistema')
                    """,
                    (operacao, codigo, operacao, codigo, nome, tipo, jornada, inter, dias, feriado, 1 if duro else 0, _json(pausas)),
                )
            except pyodbc.IntegrityError:
                pass
        for codigo, nome, tipo, cor in TURNOS_FIXOS_PADRAO:
            try:
                cursor.execute(
                    "IF NOT EXISTS (SELECT 1 FROM dbo.wfm_turnos WITH (UPDLOCK, HOLDLOCK) WHERE operacao = ? AND codigo = ?) "
                    "INSERT INTO dbo.wfm_turnos (operacao, codigo, nome, tipo, cor, atualizado_por) VALUES (?, ?, ?, ?, ?, 'sistema')",
                    (operacao, codigo, operacao, codigo, nome, tipo, cor),
                )
            except pyodbc.IntegrityError:
                pass
        if primeira and wfm_scope.eh_tipo_escala(operacao):
            slug = operacao.split(wfm_scope.SEPARADOR_TIPO, 1)[1].upper()
            for codigo, nome, tipo, cor, entrada, saida in TURNOS_TIPO_PADRAO.get(slug, ()):
                try:
                    cursor.execute(
                        "IF NOT EXISTS (SELECT 1 FROM dbo.wfm_turnos WITH (UPDLOCK, HOLDLOCK) WHERE operacao = ? AND codigo = ?) "
                        "INSERT INTO dbo.wfm_turnos (operacao, codigo, nome, tipo, cor, entrada, saida, atualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, 'sistema')",
                        (operacao, codigo, operacao, codigo, nome, tipo, cor, entrada, saida),
                    )
                except pyodbc.IntegrityError:
                    pass

    # ------------------------------------------------------------------
    # Contexto
    # ------------------------------------------------------------------
    def wfm_contexto(self, user) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT chave, nome, ativo FROM dbo.operacoes WHERE ativo = 1 ORDER BY nome")
            todas = [{"chave": normalize_text(r[0]), "nome": normalize_text(r[1])} for r in cursor.fetchall()]
            cursor.execute("SELECT operacao_base, chave, nome, ativo FROM dbo.wfm_tipos_escala ORDER BY nome")
            tipos = [(normalize_text(r[0]), normalize_text(r[1]), normalize_text(r[2]), bool(r[3])) for r in cursor.fetchall()]
            cursor.execute("SELECT operacao, ativa, excluida FROM dbo.wfm_operacao_config WHERE ativa = 0 OR excluida = 1")
            cfg_fora = [(normalize_text(r[0]), bool(r[2])) for r in cursor.fetchall()]
            principais_inativas = {chave for chave, _ in cfg_fora}
            excluidas = {chave for chave, exc in cfg_fora if exc}
        finally:
            conn.close()
        permitidas = wfm_scope.operacoes_permitidas(user.perfil, user.operacoes)
        operacoes = []
        for o in todas:
            if permitidas is not None and o["chave"] not in permitidas:
                continue
            # Escala principal da operação (some só nas operações que vivem de escalas criadas, como o TI, ou se desativada)
            if o["chave"].upper() not in wfm_scope.OPERACOES_SO_TIPOS:
                # A operação segue disponível para Cadastros/Jornadas/Presença mesmo com a escala principal desativada ou
                # excluída; as telas de escala escondem as marcadas com `escala_ativa=False`.
                # Quem só é escalado (Operador, Técnicos) não enxerga escala principal desativada/excluída.
                if not (user.perfil in WFM_PERFIS_PARTICIPANTES and o["chave"] in principais_inativas):
                    operacoes.append({**o, "escala_ativa": o["chave"] not in principais_inativas, "escala_excluida": o["chave"] in excluidas})
            operacoes += [
                {"chave": chave, "nome": f"{o['nome']} · {nome}", "tipo_escala": True}
                for base, chave, nome, ativo in tipos if base.upper() == o["chave"].upper() and ativo and chave not in excluidas
            ]
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
            "pode_editar_tipos_escala": wfm_scope.pode_editar_tipos_escala(user.perfil),
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
                       exigencias_pausa_json, ativo, jornada_semanal_max_min
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
                    "nome": normalize_text(item.get("nome"))[:60],
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
            int(data["jornada_semanal_max_min"]) if data.get("jornada_semanal_max_min") not in (None, "") else None,
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
                        exigencias_pausa_json = ?, ativo = ?, jornada_semanal_max_min = ?, atualizado_por = ?, atualizado_em = GETDATE()
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
                        max_dias_consecutivos, jornada_feriado_max_min, jornada_bloqueio_duro, exigencias_pausa_json, ativo, jornada_semanal_max_min, atualizado_por)
                    OUTPUT INSERTED.id_contrato VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (operacao, codigo, *valores, normalize_text(user.nome) or user.username),
                )
                resolved = int(cursor.fetchone()[0])
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="salvar_contrato", entidade="contrato", entidade_id=resolved,
                antes=anterior, depois={"codigo": codigo, "nome": nome, "tipo": tipo, "limites": list(valores[2:8]), "semanal_max_min": valores[9]}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_contrato": resolved}
        finally:
            conn.close()

    def _wfm_supervisores_da_operacao(self, cursor, operacao: str) -> list[dict]:
        """Supervisores ativos da operação com a equipe de cada um (a do próprio cadastro; sem ela, a mais comum
        entre os operadores que ele supervisiona)."""
        cursor.execute(
            """
            SELECT u.id_usuario, u.nome, u.sobrenome, u.id_equipe, e.nome FROM dbo.usuarios u
            JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario AND uo.operacao = ?
            LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
            WHERE u.perfil_id = ? AND ISNULL(u.status, 'Ativo') = 'Ativo' ORDER BY u.nome, u.sobrenome
            """,
            (wfm_scope.operacao_base(operacao), ROLE_SUPERVISOR),
        )
        sups = [
            {"id_usuario": int(r[0]), "nome": f"{normalize_text(r[1])} {normalize_text(r[2])}".strip(),
             "id_equipe": int(r[3]) if r[3] else None, "equipe": normalize_text(r[4]) or None}
            for r in cursor.fetchall()
        ]
        faltando = [s["id_usuario"] for s in sups if not s["id_equipe"]]
        if faltando:
            cursor.execute(
                f"""
                SELECT us.id_supervisor, o.id_equipe, e.nome, COUNT(*) FROM dbo.usuarios_supervisores us
                JOIN dbo.usuarios o ON o.id_usuario = us.id_operador AND o.id_equipe IS NOT NULL
                JOIN dbo.equipes_operacao e ON e.id_equipe = o.id_equipe
                WHERE us.id_supervisor IN ({','.join('?' for _ in faltando)}) GROUP BY us.id_supervisor, o.id_equipe, e.nome
                """,
                tuple(faltando),
            )
            melhor: dict[int, tuple] = {}
            for id_sup, id_eq, nome_eq, qtd in cursor.fetchall():
                if int(id_sup) not in melhor or int(qtd) > melhor[int(id_sup)][2]:
                    melhor[int(id_sup)] = (int(id_eq), normalize_text(nome_eq), int(qtd))
            for s in sups:
                if not s["id_equipe"] and s["id_usuario"] in melhor:
                    s["id_equipe"], s["equipe"] = melhor[s["id_usuario"]][0], melhor[s["id_usuario"]][1]
        return sups

    def wfm_list_supervisores(self, user, operacao: str) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            return self._wfm_supervisores_da_operacao(cursor, operacao)
        finally:
            conn.close()

    def wfm_list_operadores_do_contrato(self, user, operacao: str, id_contrato: int) -> list[dict]:
        """Operadores vinculados à jornada (com a vigência de cada vínculo)."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute(
                """
                SELECT oc.id_operador, u.nome, u.sobrenome, oc.vigencia_ini, oc.vigencia_fim
                FROM dbo.wfm_operador_contratos oc JOIN dbo.usuarios u ON u.id_usuario = oc.id_operador
                WHERE oc.operacao = ? AND oc.id_contrato = ? ORDER BY u.nome, u.sobrenome, oc.vigencia_ini
                """,
                (operacao, int(id_contrato)),
            )
            return [
                {"id_operador": int(r[0]), "nome": f"{normalize_text(r[1])} {normalize_text(r[2])}".strip(),
                 "vigencia_ini": r[3].isoformat() if r[3] else None, "vigencia_fim": r[4].isoformat() if r[4] else None}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def wfm_desvincular_operador_contrato(self, user, operacao: str, id_contrato: int, id_operador: int, *, ip: str = "") -> dict:
        """Remove o vínculo do operador com a jornada. Sem outra jornada vigente, a escala dele deixa de validar até um novo vínculo."""
        if not wfm_scope.pode_editar_contratos(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente Administrador e Control Desk desvinculam operadores.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            cursor.execute(
                "SELECT COUNT(*) FROM dbo.wfm_operador_contratos WHERE operacao = ? AND id_contrato = ? AND id_operador = ?",
                (operacao, int(id_contrato), int(id_operador)),
            )
            if not int(cursor.fetchone()[0]):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Este operador não está vinculado a esta jornada.")
            cursor.execute(
                "DELETE FROM dbo.wfm_operador_contratos WHERE operacao = ? AND id_contrato = ? AND id_operador = ?",
                (operacao, int(id_contrato), int(id_operador)),
            )
            self.wfm_audit(cursor, user, operacao=operacao, acao="desvincular_contrato", entidade="contrato", entidade_id=int(id_contrato),
                           antes={"id_operador": int(id_operador)}, ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    def wfm_excluir_contrato(self, user, operacao: str, id_contrato: int, *, ip: str = "") -> dict:
        """Exclui uma jornada (contrato) sem vínculos. Com operador ou turno vinculado só é possível desativar."""
        if not wfm_scope.pode_editar_contratos(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente Administrador e Control Desk excluem jornadas.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            cursor.execute("SELECT codigo, nome FROM dbo.wfm_contratos WHERE id_contrato = ? AND operacao = ?", (int(id_contrato), operacao))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jornada não encontrada nesta operação.")
            cursor.execute("SELECT COUNT(DISTINCT id_operador) FROM dbo.wfm_operador_contratos WHERE operacao = ? AND id_contrato = ?", (operacao, int(id_contrato)))
            operadores = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM dbo.wfm_turnos WHERE operacao = ? AND id_contrato = ?", (operacao, int(id_contrato)))
            turnos = int(cursor.fetchone()[0])
            if operadores or turnos:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A jornada {normalize_text(row[0])} está em uso ({operadores} operador(es), {turnos} turno(s)). "
                           "Troque os vínculos ou apenas desative a jornada.",
                )
            cursor.execute("DELETE FROM dbo.wfm_contratos WHERE id_contrato = ? AND operacao = ?", (int(id_contrato), operacao))
            self.wfm_audit(cursor, user, operacao=operacao, acao="excluir_contrato", entidade="contrato", entidade_id=int(id_contrato),
                           antes={"codigo": normalize_text(row[0]), "nome": normalize_text(row[1])}, ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Turnos-modelo (Adm, Control Desk, Supervisor)
    # ------------------------------------------------------------------
    def wfm_list_turnos(self, user, operacao: str, *, incluir_excluidos: bool = False) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute(
                "SELECT id_turno, codigo, nome, tipo, cor, entrada, saida, pausas_json, ativo, id_contrato, id_supervisor "
                f"FROM dbo.wfm_turnos WHERE operacao = ? {'' if incluir_excluidos else 'AND excluido = 0'} ORDER BY tipo DESC, codigo",
                (operacao,),
            )
            linhas = rows_to_dicts(cursor, cursor.fetchall())  # antes de reutilizar o cursor (supervisores)
            sups = {s["id_usuario"]: s for s in self._wfm_supervisores_da_operacao(cursor, operacao)}
            itens = []
            for r in linhas:
                r["ativo"] = bool(r["ativo"])
                sup = sups.get(r.get("id_supervisor"))
                r["supervisor"] = sup["nome"] if sup else None
                r["id_equipe"] = sup["id_equipe"] if sup else None
                r["equipe"] = sup["equipe"] if sup else None
                try:
                    r["pausas"] = json.loads(r.pop("pausas_json") or "[]")
                except ValueError:
                    r["pausas"] = []
                r["minutos"] = _minutos_liquidos(r["entrada"], r["saida"], r["pausas"]) if r["tipo"] == "TRABALHO" else 0
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
            id_contrato = int(data["id_contrato"]) if tipo == "TRABALHO" and data.get("id_contrato") not in (None, "", 0) else None
            id_supervisor = int(data["id_supervisor"]) if data.get("id_supervisor") not in (None, "", 0) else None
            if id_supervisor and id_supervisor not in {s["id_usuario"] for s in self._wfm_supervisores_da_operacao(cursor, operacao)}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Supervisor inválido para esta operação.")
            if id_contrato:
                # Turno atrelado a um contrato: a saída é a entrada + jornada do contrato (+ intervalos não remunerados).
                cursor.execute("SELECT jornada_diaria_max_min FROM dbo.wfm_contratos WHERE id_contrato = ? AND operacao = ? AND ativo = 1", (id_contrato, operacao))
                contrato = cursor.fetchone()
                if not contrato:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contrato inválido ou inativo nesta operação.")
                total = (int(entrada[:2]) * 60 + int(entrada[3:]) + int(contrato[0]) + sum(p["duracao_min"] for p in pausas if p["tipo"] == "INTERVALO")) % 1440
                saida = f"{total // 60:02d}:{total % 60:02d}"
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
                    "UPDATE dbo.wfm_turnos SET nome = ?, tipo = ?, cor = ?, entrada = ?, saida = ?, pausas_json = ?, ativo = ?, id_contrato = ?, id_supervisor = ?, "
                    "atualizado_por = ?, atualizado_em = GETDATE() WHERE id_turno = ? AND operacao = ?",
                    (nome, tipo, cor, entrada, saida, _json(pausas), ativo, id_contrato, id_supervisor, normalize_text(user.nome) or user.username, int(id_turno), operacao),
                )
                resolved = int(id_turno)
            else:
                cursor.execute("SELECT TOP 1 1 FROM dbo.wfm_turnos WHERE operacao = ? AND codigo = ? AND excluido = 0", (operacao, codigo))
                if cursor.fetchone():
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe um turno com este código nesta operação.")
                cursor.execute(
                    "INSERT INTO dbo.wfm_turnos (operacao, codigo, nome, tipo, cor, entrada, saida, pausas_json, ativo, id_contrato, id_supervisor, atualizado_por) "
                    "OUTPUT INSERTED.id_turno VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (operacao, codigo, nome, tipo, cor, entrada, saida, _json(pausas), ativo, id_contrato, id_supervisor, normalize_text(user.nome) or user.username),
                )
                resolved = int(cursor.fetchone()[0])
            self.wfm_audit(
                cursor, user, operacao=operacao, acao="salvar_turno", entidade="turno", entidade_id=resolved,
                antes=anterior, depois={"codigo": codigo, "nome": nome, "tipo": tipo, "entrada": entrada, "saida": saida, "ativo": bool(ativo), "id_contrato": id_contrato, "id_supervisor": id_supervisor}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_turno": resolved, "saida": saida}
        finally:
            conn.close()

    def wfm_excluir_turno(self, user, operacao: str, id_turno: int, *, ip: str = "") -> dict:
        """Exclui o turno-modelo de vez: some do cadastro e o código pode ser reutilizado. Turno nunca usado é apagado do banco;
        turno que já foi usado só em datas passadas (escala, calendário especial) é excluído LOGICAMENTE, para o histórico
        e os relatórios continuarem mostrando o que foi escalado. Turno ainda em uso de hoje em diante não pode ser excluído
        (a escala ficaria sem definição): remova-o dessas datas antes. Folga e DSR são fixos."""
        if not wfm_scope.pode_editar_cadastros(user.perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão para excluir turnos.")
        hoje = date.today()
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao, escrita=True)
            cursor.execute("SELECT codigo, nome, tipo FROM dbo.wfm_turnos WHERE id_turno = ? AND operacao = ? AND excluido = 0", (int(id_turno), operacao))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turno não encontrado nesta operação.")
            if normalize_text(row[2]) not in ("TRABALHO", "SOBREAVISO"):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Folga e DSR são turnos fixos e não podem ser excluídos.")
            cursor.execute("SELECT COUNT(*) FROM dbo.wfm_escala_itens WHERE operacao = ? AND id_turno = ? AND data >= ?", (operacao, int(id_turno), hoje))
            futuro_escala = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM dbo.wfm_calendario_especial WHERE operacao = ? AND id_turno = ? AND data_fim >= ?", (operacao, int(id_turno), hoje))
            futuro_calendario = int(cursor.fetchone()[0])
            # Lançamentos de uma escala já excluída são histórico: não seguram a exclusão do turno.
            cursor.execute("SELECT TOP 1 1 FROM dbo.wfm_operacao_config WHERE operacao = ? AND excluida = 1", (operacao,))
            if cursor.fetchone():
                futuro_escala = 0
            if futuro_escala or futuro_calendario:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"O turno {normalize_text(row[0])} ainda está em uso de hoje em diante ({futuro_escala} dia(s) de escala, {futuro_calendario} item(ns) do calendário especial). "
                           "Remova-o dessas datas e tente excluir de novo.",
                )
            cursor.execute("SELECT COUNT(*) FROM dbo.wfm_escala_itens WHERE operacao = ? AND id_turno = ?", (operacao, int(id_turno)))
            usado = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM dbo.wfm_calendario_especial WHERE operacao = ? AND id_turno = ?", (operacao, int(id_turno)))
            usado += int(cursor.fetchone()[0])
            logica = bool(usado)
            if not logica:
                try:
                    cursor.execute("DELETE FROM dbo.wfm_turnos WHERE id_turno = ? AND operacao = ?", (int(id_turno), operacao))
                except pyodbc.IntegrityError:
                    conn.rollback()
                    logica = True
            if logica:
                cursor.execute("UPDATE dbo.wfm_turnos SET excluido = 1, ativo = 0, atualizado_em = GETDATE() WHERE id_turno = ? AND operacao = ?", (int(id_turno), operacao))
            self.wfm_audit(cursor, user, operacao=operacao, acao="excluir_turno", entidade="turno", entidade_id=int(id_turno),
                           antes={"codigo": normalize_text(row[0]), "nome": normalize_text(row[1])}, depois={"logica": logica}, ip=ip)
            conn.commit()
            return {"success": True, "logica": logica}
        finally:
            conn.close()

    def wfm_get_contrato_operador(self, user, operacao: str, id_operador: int) -> dict:
        """Contrato vigente e histórico de um operador (usado no modal de usuário em Configurações)."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacao = self._wfm_exigir_operacao(cursor, user, operacao)
            conn.commit()
            cursor.execute(
                "SELECT oc.id_contrato, c.codigo, oc.vigencia_ini, oc.vigencia_fim FROM dbo.wfm_operador_contratos oc "
                "JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato WHERE oc.operacao = ? AND oc.id_operador = ? ORDER BY oc.vigencia_ini DESC",
                (operacao, int(id_operador)),
            )
            historico = [
                {"id_contrato": int(r[0]), "codigo": normalize_text(r[1]), "vigencia_ini": r[2].isoformat(), "vigencia_fim": r[3].isoformat() if r[3] else None}
                for r in cursor.fetchall()
            ]
            atual = next((h for h in historico if h["vigencia_fim"] is None), historico[0] if historico else None)
            return {"atual": atual, "historico": historico}
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
            WHERE u.id_usuario = ? AND u.perfil_id IN (%s)
            """ % ",".join("?" for _ in self._wfm_perfis_participantes(operacao)),
            (wfm_scope.operacao_base(operacao), int(id_operador), *self._wfm_perfis_participantes(operacao)),
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
                    # inclui as chaves virtuais dos tipos de escala (`TI::SOBREAVISO`) das operações permitidas
                    sql += f" AND (operacao IN ({','.join('?' for _ in permitidas)}) OR " + " OR ".join("operacao LIKE ?" for _ in permitidas) + ")"
                    params += sorted(permitidas) + [f"{p}{wfm_scope.SEPARADOR_TIPO}%" for p in sorted(permitidas)]
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

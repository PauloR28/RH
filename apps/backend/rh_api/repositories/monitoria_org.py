"""Organização da vertente Monitoria: equipes, catálogos, vínculos de usuário
(operação/equipe/turno/supervisores), transferência de supervisão e tema por
operação (promt.txt §2 e §4). Mixin do DatabaseRepository, SQL puro (pyodbc).

Operações continuam sendo o catálogo `dbo.operacoes` (chave = identificador
estável usado em `usuarios_operacoes`, processos, matrizes e monitorias)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_CONTROL_DESK, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR, get_role_definition
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_engine import config_padrao
from ..services.monitoria_scope import (
    escopo_global,
    operacoes_permitidas,
    pode_gerenciar_perfil,
    validar_vinculos,
)

TURNOS_PADRAO = ("Manhã", "Tarde", "Noite")
CANAIS_PADRAO = ("Telefone", "Chat", "E-mail", "WhatsApp")
TIPOS_ATENDIMENTO_PADRAO = ("Dúvida", "Solicitação", "Reclamação", "Vendas")

GUIA_PADRAO = [
    ("Como criar uma monitoria", "Abra Monitoria > Nova monitoria, escolha a operação e o operador, informe canal, tipo de atendimento e data do contato, responda todos os critérios (SIM, NÃO, NCG ou N/A), avalie os pilares e finalize. Após finalizada, a monitoria não pode mais ser alterada."),
    ("Como aplicar um feedback", "Em Monitoria > Feedback, abra a monitoria pendente (prazo de 72 horas), registre a observação e aplique. O operador passa a ter 48 horas para confirmar ou contestar."),
    ("Como contestar uma monitoria", "O operador abre a monitoria, escolhe Contestar, informa o(s) critério(s), o motivo, a justificativa e, se houver, a evidência. Sem manifestação em 48 horas a monitoria é confirmada automaticamente."),
    ("Como realizar uma reanálise", "O supervisor responsável tem 72 horas para decidir: Manter a avaliação ou Anular a monitoria, sempre com a observação da reanálise. A monitoria original nunca é editada."),
    ("Regras de cálculo da nota", "SIM recebe o peso do critério; NÃO recebe 0; NCG zera a nota; N/A anula o bloco inteiro e redistribui seu peso entre os blocos avaliados. São necessários ao menos 3 blocos avaliados; abaixo disso a monitoria é anulada."),
    ("Faixas de nota", "95–100 Excelência · 90–94 Muito bom · 80–89 Bom · 70–79 Desenvolvimento (necessita plano de ação) · 0–69 Crítico (necessita intervenção)."),
    ("Modelo de atendimento", "ACOLHER → OUVIR → INVESTIGAR → RESOLVER → CONFIRMAR → ENCERRAR."),
    ("Como criar um plano de ação", "Em Monitoria > Planos de ação, selecione o operador, descreva o problema, o critério relacionado, o objetivo, a ação e o prazo. Acompanhe: Aberto → Em andamento → Em revisão → Concluído."),
]

CONFIG_PADRAO_MONITORIA = {
    "limiar_alerta_pct": "75",
    "sla_feedback_horas": "72",
    "sla_confirmacao_horas": "48",
    "sla_reanalise_horas": "72",
}


def _lista_operacoes(cursor, *, apenas_ativas: bool = False) -> list[dict]:
    cursor.execute(
        f"""
        SELECT id_item, chave, nome, categoria, ativo, cor_primaria, logo_arquivo
        FROM dbo.operacoes
        {'WHERE ativo = 1' if apenas_ativas else ''}
        ORDER BY nome
        """
    )
    itens = []
    for row in rows_to_dicts(cursor, cursor.fetchall()):
        itens.append(
            {
                "id_item": row["id_item"],
                "chave": normalize_text(row["chave"]),
                "nome": normalize_text(row["nome"]),
                "categoria": normalize_text(row.get("categoria")),
                "ativo": bool(row["ativo"]),
                "cor_primaria": normalize_text(row.get("cor_primaria")),
                "logo_arquivo": normalize_text(row.get("logo_arquivo")),
            }
        )
    return itens


def ensure_monitoria_seeds(cursor) -> None:
    """Sementes idempotentes: catálogos, matriz 1.0 por operação, guia, config."""
    for chave, valor in CONFIG_PADRAO_MONITORIA.items():
        cursor.execute(
            "IF NOT EXISTS (SELECT 1 FROM dbo.monitoria_config WHERE chave = ?) "
            "INSERT INTO dbo.monitoria_config (chave, valor) VALUES (?, ?)",
            (chave, chave, valor),
        )
    for ordem, valor in enumerate(TURNOS_PADRAO, start=1):
        cursor.execute(
            "IF NOT EXISTS (SELECT 1 FROM dbo.monitoria_catalogo WHERE tipo = 'turno' AND valor = ?) "
            "INSERT INTO dbo.monitoria_catalogo (tipo, operacao, valor, ordem) VALUES ('turno', NULL, ?, ?)",
            (valor, valor, ordem),
        )
    cursor.execute("SELECT COUNT(*) FROM dbo.monitoria_guia")
    if int(cursor.fetchone()[0]) == 0:
        for ordem, (titulo, conteudo) in enumerate(GUIA_PADRAO, start=1):
            cursor.execute(
                "INSERT INTO dbo.monitoria_guia (titulo, conteudo, ordem) VALUES (?, ?, ?)",
                (titulo, conteudo, ordem),
            )
    for operacao in _lista_operacoes(cursor, apenas_ativas=True):
        chave = operacao["chave"]
        for tipo, valores in (("canal", CANAIS_PADRAO), ("tipo_atendimento", TIPOS_ATENDIMENTO_PADRAO)):
            for ordem, valor in enumerate(valores, start=1):
                cursor.execute(
                    "IF NOT EXISTS (SELECT 1 FROM dbo.monitoria_catalogo WHERE tipo = ? AND operacao = ? AND valor = ?) "
                    "INSERT INTO dbo.monitoria_catalogo (tipo, operacao, valor, ordem) VALUES (?, ?, ?, ?)",
                    (tipo, chave, valor, tipo, chave, valor, ordem),
                )
        cursor.execute("SELECT TOP 1 id_matriz FROM dbo.monitoria_matrizes WHERE operacao = ?", (chave,))
        if cursor.fetchone():
            continue
        cursor.execute(
            "INSERT INTO dbo.monitoria_matrizes (operacao, nome, criado_por) OUTPUT INSERTED.id_matriz VALUES (?, ?, 'sistema')",
            (chave, f"Matriz de qualidade — {operacao['nome']}"),
        )
        id_matriz = int(cursor.fetchone()[0])
        cursor.execute(
            "INSERT INTO dbo.monitoria_matriz_versoes (id_matriz, numero, config_json, observacao, criado_por) "
            "OUTPUT INSERTED.id_versao VALUES (?, 1, ?, 'Versão inicial (matriz 1.0)', 'sistema')",
            (id_matriz, json.dumps(config_padrao(), ensure_ascii=False)),
        )
        id_versao = int(cursor.fetchone()[0])
        cursor.execute(
            "UPDATE dbo.monitoria_matrizes SET id_versao_ativa = ? WHERE id_matriz = ?", (id_versao, id_matriz)
        )


class MonitoriaOrgRepositoryMixin:
    # ------------------------------------------------------------------
    # Log imutável da Monitoria (append-only, com IP)
    # ------------------------------------------------------------------
    def mon_log(
        self,
        cursor,
        user,
        *,
        acao: str,
        operacao: str = "",
        modulo: str = "Monitoria",
        entidade: str = "",
        entidade_id: str = "",
        resultado: str = "SUCESSO",
        detalhes: Any = None,
        anterior: Any = None,
        posterior: Any = None,
        ip: str = "",
    ) -> None:
        def _json(valor):
            if valor is None:
                return None
            return valor if isinstance(valor, str) else json.dumps(valor, ensure_ascii=False, default=str)

        cursor.execute(
            """
            INSERT INTO dbo.monitoria_logs
            (id_usuario, usuario_nome, perfil, operacao, acao, modulo, entidade, entidade_id, ip, resultado,
             detalhes, estado_anterior, estado_posterior)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                getattr(user, "id_usuario", None),
                normalize_text(getattr(user, "nome", "")) or normalize_text(getattr(user, "username", "")) or "sistema",
                normalize_text(getattr(user, "perfil", "")) or "sistema",
                normalize_text(operacao) or None,
                acao,
                modulo,
                entidade or None,
                str(entidade_id) if entidade_id != "" else None,
                ip or None,
                resultado,
                _json(detalhes),
                _json(anterior),
                _json(posterior),
            ),
        )

    # ------------------------------------------------------------------
    # Contexto do usuário (operações visíveis, vínculos, tema)
    # ------------------------------------------------------------------
    def mon_operacoes_do_usuario(self, user, *, apenas_ativas: bool = False) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            todas = _lista_operacoes(cursor, apenas_ativas=apenas_ativas)
        finally:
            conn.close()
        permitidas = operacoes_permitidas(user.perfil, user.operacoes)
        if permitidas is None:
            return todas
        return [item for item in todas if item["chave"] in permitidas]

    def mon_contexto(self, user) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            vinculos = self._mon_vinculos(cursor, user.id_usuario) if user.id_usuario else {}
        finally:
            conn.close()
        operacoes = self.mon_operacoes_do_usuario(user)
        return {
            "perfil": user.perfil,
            "global": escopo_global(user.perfil),
            "operacoes": operacoes,
            "vinculos": vinculos,
            "multi_operacao": len(operacoes) > 1,
        }

    def _mon_vinculos(self, cursor, id_usuario: int) -> dict:
        cursor.execute(
            """
            SELECT turno, id_equipe, ISNULL(deve_trocar_senha, 0) AS deve_trocar_senha,
                   tema_operacao, ISNULL(tema_operacao_alterado, 0) AS tema_alterado
            FROM dbo.usuarios WHERE id_usuario = ?
            """,
            (int(id_usuario),),
        )
        row = cursor.fetchone()
        base = rows_to_dicts(cursor, [row])[0] if row else {}
        cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ? ORDER BY operacao", (int(id_usuario),))
        operacoes = [normalize_text(item[0]) for item in cursor.fetchall()]
        cursor.execute(
            """
            SELECT s.id_supervisor, u.nome
            FROM dbo.usuarios_supervisores s
            JOIN dbo.usuarios u ON u.id_usuario = s.id_supervisor
            WHERE s.id_operador = ? ORDER BY u.nome
            """,
            (int(id_usuario),),
        )
        supervisores = [{"id_usuario": r[0], "nome": normalize_text(r[1])} for r in cursor.fetchall()]
        equipe_nome = ""
        if base.get("id_equipe"):
            cursor.execute("SELECT nome FROM dbo.equipes_operacao WHERE id_equipe = ?", (int(base["id_equipe"]),))
            achado = cursor.fetchone()
            equipe_nome = normalize_text(achado[0]) if achado else ""
        return {
            "operacoes": operacoes,
            "turno": normalize_text(base.get("turno")),
            "id_equipe": base.get("id_equipe"),
            "equipe_nome": equipe_nome,
            "supervisores": supervisores,
            "deve_trocar_senha": bool(base.get("deve_trocar_senha")),
            "tema_operacao": normalize_text(base.get("tema_operacao")),
            "tema_alterado": bool(base.get("tema_alterado")),
        }

    def mon_get_vinculos(self, id_usuario: int) -> dict:
        conn = self._connect()
        try:
            return self._mon_vinculos(conn.cursor(), id_usuario)
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Regras de operação inativa
    # ------------------------------------------------------------------
    def _mon_exigir_operacao_ativa(self, cursor, chave: str) -> dict:
        cursor.execute(
            "SELECT id_item, chave, nome, ativo FROM dbo.operacoes WHERE chave = ?", (normalize_text(chave),)
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operação não encontrada.")
        if not bool(row[3]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A operação {normalize_text(row[2])} está inativa: nenhuma alteração é permitida.",
            )
        return {"id_item": row[0], "chave": normalize_text(row[1]), "nome": normalize_text(row[2])}

    @staticmethod
    def _mon_exigir_operacao_no_escopo(user, operacao: str) -> None:
        permitidas = operacoes_permitidas(user.perfil, user.operacoes)
        if permitidas is not None and operacao not in permitidas:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Esta operação está fora do seu escopo de acesso.",
            )

    # ------------------------------------------------------------------
    # Equipes
    # ------------------------------------------------------------------
    def mon_list_equipes(self, user, operacao: str = "") -> list[dict]:
        permitidas = operacoes_permitidas(user.perfil, user.operacoes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT e.id_equipe, e.operacao, o.nome AS operacao_nome, e.nome, e.ativo,
                       (SELECT COUNT(*) FROM dbo.usuarios u WHERE u.id_equipe = e.id_equipe) AS membros
                FROM dbo.equipes_operacao e
                LEFT JOIN dbo.operacoes o ON o.chave = e.operacao
                ORDER BY o.nome, e.nome
                """
            )
            itens = []
            for row in rows_to_dicts(cursor, cursor.fetchall()):
                chave = normalize_text(row["operacao"])
                if permitidas is not None and chave not in permitidas:
                    continue
                if operacao and chave != operacao:
                    continue
                itens.append(
                    {
                        "id_equipe": row["id_equipe"],
                        "operacao": chave,
                        "operacao_nome": normalize_text(row["operacao_nome"]),
                        "nome": normalize_text(row["nome"]),
                        "ativo": bool(row["ativo"]),
                        "membros": int(row["membros"] or 0),
                    }
                )
            return itens
        finally:
            conn.close()

    def mon_save_equipe(self, user, data: dict, id_equipe: int | None = None, *, ip: str = "") -> dict:
        nome = normalize_text(data.get("nome"))
        operacao = normalize_text(data.get("operacao"))
        if not nome:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome da equipe.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            anterior = None
            if id_equipe:
                cursor.execute("SELECT operacao, nome, ativo FROM dbo.equipes_operacao WHERE id_equipe = ?", (int(id_equipe),))
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipe não encontrada.")
                anterior = {"operacao": normalize_text(row[0]), "nome": normalize_text(row[1]), "ativo": bool(row[2])}
                operacao = anterior["operacao"]  # a equipe nunca muda de operação
            if not operacao:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe a operação da equipe.")
            self._mon_exigir_operacao_no_escopo(user, operacao)
            self._mon_exigir_operacao_ativa(cursor, operacao)
            cursor.execute(
                "SELECT TOP 1 1 FROM dbo.equipes_operacao WHERE operacao = ? AND LOWER(nome) = LOWER(?) AND id_equipe <> ?",
                (operacao, nome, int(id_equipe or 0)),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Já existe uma equipe com este nome nesta operação.")
            ativo = 1 if data.get("ativo", True) else 0
            if id_equipe:
                cursor.execute(
                    "UPDATE dbo.equipes_operacao SET nome = ?, ativo = ?, atualizado_em = GETDATE() WHERE id_equipe = ?",
                    (nome, ativo, int(id_equipe)),
                )
                resolved = int(id_equipe)
            else:
                cursor.execute(
                    "INSERT INTO dbo.equipes_operacao (operacao, nome, ativo) OUTPUT INSERTED.id_equipe VALUES (?, ?, ?)",
                    (operacao, nome, ativo),
                )
                resolved = int(cursor.fetchone()[0])
            self.mon_log(
                cursor, user, acao="salvar_equipe", operacao=operacao, entidade="equipe", entidade_id=resolved,
                anterior=anterior, posterior={"nome": nome, "ativo": bool(ativo)}, ip=ip,
            )
            conn.commit()
            return {"success": True, "id_equipe": resolved}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Catálogos (turno / canal / tipo de atendimento)
    # ------------------------------------------------------------------
    def mon_list_catalogo(self, tipo: str, operacao: str = "", *, incluir_inativos: bool = False) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"""
                SELECT id_item, tipo, operacao, valor, ordem, ativo FROM dbo.monitoria_catalogo
                WHERE tipo = ? AND (operacao IS NULL OR operacao = ?)
                {'' if incluir_inativos else 'AND ativo = 1'}
                ORDER BY ordem, valor
                """,
                (tipo, operacao or ""),
            )
            return [
                {"id_item": r["id_item"], "tipo": r["tipo"], "operacao": normalize_text(r["operacao"]),
                 "valor": normalize_text(r["valor"]), "ordem": r["ordem"], "ativo": bool(r["ativo"])}
                for r in rows_to_dicts(cursor, cursor.fetchall())
            ]
        finally:
            conn.close()

    def mon_save_catalogo(self, user, data: dict, id_item: int | None = None, *, ip: str = "") -> dict:
        tipo = normalize_text(data.get("tipo"))
        valor = normalize_text(data.get("valor"))
        operacao = normalize_text(data.get("operacao"))
        if tipo not in {"turno", "canal", "tipo_atendimento"} or not valor:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o tipo e o valor do item.")
        if tipo != "turno" and not operacao:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Canal e tipo de atendimento pertencem a uma operação.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if operacao:
                self._mon_exigir_operacao_no_escopo(user, operacao)
                self._mon_exigir_operacao_ativa(cursor, operacao)
            elif not (user.perfil == ROLE_ADMIN or user.has_permission("monitoria.configurar")):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente o Administrador altera os turnos.")
            ativo = 1 if data.get("ativo", True) else 0
            ordem = int(data.get("ordem") or 0)
            if id_item:
                cursor.execute(
                    "UPDATE dbo.monitoria_catalogo SET valor = ?, ativo = ?, ordem = ? WHERE id_item = ?",
                    (valor, ativo, ordem, int(id_item)),
                )
                resolved = int(id_item)
            else:
                cursor.execute(
                    "INSERT INTO dbo.monitoria_catalogo (tipo, operacao, valor, ordem, ativo) OUTPUT INSERTED.id_item VALUES (?, ?, ?, ?, ?)",
                    (tipo, operacao or None, valor, ordem, ativo),
                )
                resolved = int(cursor.fetchone()[0])
            self.mon_log(cursor, user, acao="salvar_catalogo", operacao=operacao, entidade=tipo, entidade_id=resolved,
                         posterior={"valor": valor, "ativo": bool(ativo)}, ip=ip)
            conn.commit()
            return {"success": True, "id_item": resolved}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Vínculos organizacionais do usuário
    # ------------------------------------------------------------------
    def mon_set_vinculos(self, actor, id_usuario: int, data: dict, *, ip: str = "") -> dict:
        """Aplica operação(ões), equipe, turno e supervisores ao usuário,
        respeitando o perfil dele, o escopo do ator e operações inativas."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT perfil_id, nome FROM dbo.usuarios WHERE id_usuario = ?", (int(id_usuario),))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
            perfil = get_role_definition(row[0]).id
            if actor.perfil != ROLE_ADMIN and not pode_gerenciar_perfil(actor.perfil, perfil):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seu perfil não pode alterar este nível de usuário.")

            anterior = self._mon_vinculos(cursor, id_usuario)
            operacoes = sorted({normalize_text(item) for item in (data.get("operacoes", anterior["operacoes"]) or []) if normalize_text(item)})
            supervisores = sorted({int(item) for item in (data.get("supervisores", [s["id_usuario"] for s in anterior["supervisores"]]) or [])})
            if perfil == ROLE_CONTROL_DESK:
                operacoes = []
            erros = validar_vinculos(perfil, operacoes, supervisores)
            if erros:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=" ".join(erros))

            for chave in operacoes:
                self._mon_exigir_operacao_no_escopo(actor, chave)
                if chave not in anterior["operacoes"]:
                    self._mon_exigir_operacao_ativa(cursor, chave)
            # Operação inativa já vinculada: qualquer alteração de vínculo é bloqueada.
            for chave in anterior["operacoes"]:
                cursor.execute("SELECT ativo FROM dbo.operacoes WHERE chave = ?", (chave,))
                achado = cursor.fetchone()
                if achado and not bool(achado[0]) and set(operacoes) != set(anterior["operacoes"]):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Há operação inativa vinculada: nenhuma alteração de vínculo é permitida.")

            id_equipe = data.get("id_equipe", anterior["id_equipe"])
            id_equipe = int(id_equipe) if id_equipe not in (None, "") else None
            if id_equipe is not None:
                cursor.execute("SELECT operacao, ativo FROM dbo.equipes_operacao WHERE id_equipe = ?", (id_equipe,))
                achada = cursor.fetchone()
                if not achada:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipe não encontrada.")
                if normalize_text(achada[0]) not in operacoes:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A equipe precisa pertencer a uma operação do usuário.")
                if not bool(achada[1]) and id_equipe != anterior["id_equipe"]:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Equipe inativa não pode receber usuários.")
            turno = normalize_text(data.get("turno", anterior["turno"]))
            if turno:
                validos = {item["valor"] for item in self.mon_list_catalogo("turno")}
                if turno not in validos:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Turno inválido.")

            for id_sup in supervisores:
                cursor.execute("SELECT perfil_id, status FROM dbo.usuarios WHERE id_usuario = ?", (id_sup,))
                sup = cursor.fetchone()
                if not sup or get_role_definition(sup[0]).id != ROLE_SUPERVISOR:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Supervisor responsável inválido.")
                cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_sup,))
                ops_sup = {normalize_text(r[0]) for r in cursor.fetchall()}
                if not (ops_sup & set(operacoes)):
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O supervisor precisa estar vinculado à operação do operador.")

            # Aplicação
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (int(id_usuario),))
            for chave in operacoes:
                cursor.execute("INSERT INTO dbo.usuarios_operacoes (id_usuario, operacao) VALUES (?, ?)", (int(id_usuario), chave))
            for chave in set(operacoes) - set(anterior["operacoes"]):
                cursor.execute("INSERT INTO dbo.usuarios_operacoes_historico (id_usuario, operacao, acao, por) VALUES (?, ?, 'vincular', ?)",
                               (int(id_usuario), chave, normalize_text(actor.nome)))
            for chave in set(anterior["operacoes"]) - set(operacoes):
                cursor.execute("INSERT INTO dbo.usuarios_operacoes_historico (id_usuario, operacao, acao, por) VALUES (?, ?, 'desvincular', ?)",
                               (int(id_usuario), chave, normalize_text(actor.nome)))
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ?", (int(id_usuario),))
            for id_sup in supervisores:
                cursor.execute("INSERT INTO dbo.usuarios_supervisores (id_operador, id_supervisor) VALUES (?, ?)", (int(id_usuario), id_sup))
            cursor.execute(
                "UPDATE dbo.usuarios SET id_equipe = ?, turno = ?, atualizado_em = GETDATE() WHERE id_usuario = ?",
                (id_equipe, turno or None, int(id_usuario)),
            )
            novo = self._mon_vinculos(cursor, id_usuario)
            self.mon_log(cursor, actor, acao="alterar_vinculos_usuario", operacao=",".join(operacoes), entidade="usuario",
                         entidade_id=id_usuario, anterior=anterior, posterior=novo, ip=ip)
            conn.commit()
            return novo
        finally:
            conn.close()

    def mon_transferir_supervisao(self, actor, *, operacao: str, id_de: int, id_para: int, justificativa: str = "", ip: str = "") -> dict:
        """Supervisor A sai da operação (ex.: férias) e o supervisor B assume:
        operadores de A nesta operação passam para B (limite de 2 supervisores);
        A perde o vínculo com a operação. Monitorias já realizadas mantêm A."""
        operacao = normalize_text(operacao)
        if id_de == id_para:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escolha supervisores diferentes.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._mon_exigir_operacao_no_escopo(actor, operacao)
            self._mon_exigir_operacao_ativa(cursor, operacao)
            for id_sup in (id_de, id_para):
                cursor.execute("SELECT perfil_id FROM dbo.usuarios WHERE id_usuario = ?", (id_sup,))
                achado = cursor.fetchone()
                if not achado or get_role_definition(achado[0]).id != ROLE_SUPERVISOR:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Ambos precisam ser Supervisores.")
            cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_para,))
            ops_para = {normalize_text(r[0]) for r in cursor.fetchall()}
            limite = 3
            if operacao not in ops_para and len(ops_para) >= limite:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"O supervisor de destino já possui {limite} operações.")
            cursor.execute(
                """
                SELECT s.id_operador FROM dbo.usuarios_supervisores s
                JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = s.id_operador AND uo.operacao = ?
                WHERE s.id_supervisor = ?
                """,
                (operacao, id_de),
            )
            operadores = [r[0] for r in cursor.fetchall()]
            movidos = 0
            for id_operador in operadores:
                cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? AND id_supervisor = ?", (id_operador, id_de))
                cursor.execute("SELECT COUNT(*) FROM dbo.usuarios_supervisores WHERE id_operador = ?", (id_operador,))
                restantes = int(cursor.fetchone()[0])
                cursor.execute("SELECT TOP 1 1 FROM dbo.usuarios_supervisores WHERE id_operador = ? AND id_supervisor = ?", (id_operador, id_para))
                if not cursor.fetchone():
                    if restantes >= 2:
                        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Um operador já tem 2 supervisores; ajuste antes de transferir.")
                    cursor.execute("INSERT INTO dbo.usuarios_supervisores (id_operador, id_supervisor) VALUES (?, ?)", (id_operador, id_para))
                movidos += 1
            if operacao not in ops_para:
                cursor.execute("INSERT INTO dbo.usuarios_operacoes (id_usuario, operacao) VALUES (?, ?)", (id_para, operacao))
                cursor.execute("INSERT INTO dbo.usuarios_operacoes_historico (id_usuario, operacao, acao, detalhe, por) VALUES (?, ?, 'vincular', 'assumiu a supervisão', ?)",
                               (id_para, operacao, normalize_text(actor.nome)))
            cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ? AND operacao = ?", (id_de, operacao))
            cursor.execute("INSERT INTO dbo.usuarios_operacoes_historico (id_usuario, operacao, acao, detalhe, por) VALUES (?, ?, 'desvincular', ?, ?)",
                           (id_de, operacao, f"supervisão assumida por #{id_para}", normalize_text(actor.nome)))
            self.mon_log(cursor, actor, acao="transferir_supervisao", operacao=operacao, entidade="usuario", entidade_id=id_de,
                         detalhes={"para": id_para, "operadores": movidos, "justificativa": justificativa}, ip=ip)
            conn.commit()
            return {"success": True, "operadores_transferidos": movidos}
        finally:
            conn.close()

    def mon_operadores_supervisionados(self, id_supervisor: int) -> set[int]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id_operador FROM dbo.usuarios_supervisores WHERE id_supervisor = ?", (int(id_supervisor),))
            return {int(r[0]) for r in cursor.fetchall()}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Tema por operação (usuário com 2+ operações escolhe 1x)
    # ------------------------------------------------------------------
    def mon_set_tema(self, user, operacao: str, *, ip: str = "") -> dict:
        operacao = normalize_text(operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            vinculos = self._mon_vinculos(cursor, user.id_usuario)
            if len(vinculos["operacoes"]) < 2:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A escolha de design é só para quem tem 2 ou mais operações.")
            if vinculos["tema_alterado"]:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="O design já foi escolhido; somente o Administrador pode liberar nova alteração.")
            if operacao and operacao not in vinculos["operacoes"]:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Escolha o design de uma das suas operações.")
            cursor.execute("UPDATE dbo.usuarios SET tema_operacao = ?, tema_operacao_alterado = 1 WHERE id_usuario = ?", (operacao or None, user.id_usuario))
            self.mon_log(cursor, user, acao="escolher_design_operacao", operacao=operacao, entidade="usuario", entidade_id=user.id_usuario, ip=ip)
            conn.commit()
            return {"success": True, "tema_operacao": operacao}
        finally:
            conn.close()

    def mon_liberar_tema(self, actor, id_usuario: int, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE dbo.usuarios SET tema_operacao_alterado = 0 WHERE id_usuario = ?", (int(id_usuario),))
            self.mon_log(cursor, actor, acao="liberar_troca_design", entidade="usuario", entidade_id=id_usuario, ip=ip)
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Usuários da Monitoria (hierarquia §2.6 + escopo de operação)
    # ------------------------------------------------------------------
    _PERFIS_MONITORIA = (ROLE_SUPERVISOR, ROLE_QUALIDADE, ROLE_CONTROL_DESK, ROLE_OPERATOR)

    def mon_list_usuarios(self, actor) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT u.id_usuario, u.nome, u.sobrenome, u.email, u.perfil_id, u.status, u.turno, u.id_equipe,
                       u.provedor_autenticacao, ISNULL(u.deve_trocar_senha, 0) AS deve_trocar_senha,
                       e.nome AS equipe_nome
                FROM dbo.usuarios u
                LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
                ORDER BY u.nome
                """
            )
            usuarios = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT id_usuario, operacao FROM dbo.usuarios_operacoes")
            ops: dict[int, list[str]] = {}
            for id_usuario, operacao in cursor.fetchall():
                ops.setdefault(int(id_usuario), []).append(normalize_text(operacao))
            cursor.execute("SELECT id_operador, id_supervisor FROM dbo.usuarios_supervisores")
            sups: dict[int, list[int]] = {}
            for id_operador, id_supervisor in cursor.fetchall():
                sups.setdefault(int(id_operador), []).append(int(id_supervisor))
        finally:
            conn.close()

        permitidas = operacoes_permitidas(actor.perfil, actor.operacoes)
        resultado = []
        for row in usuarios:
            perfil = get_role_definition(row["perfil_id"]).id
            if perfil not in self._PERFIS_MONITORIA:
                continue
            id_usuario = int(row["id_usuario"])
            if actor.perfil != ROLE_ADMIN:
                if not pode_gerenciar_perfil(actor.perfil, perfil):
                    continue
                if perfil != ROLE_CONTROL_DESK and not (set(ops.get(id_usuario, [])) & set(permitidas or [])):
                    continue
            resultado.append(
                {
                    "id_usuario": id_usuario,
                    "nome": normalize_text(row["nome"]),
                    "sobrenome": normalize_text(row.get("sobrenome")),
                    "email": normalize_text(row["email"]),
                    "perfil": perfil,
                    "perfil_nome": get_role_definition(perfil).name,
                    "status": normalize_text(row["status"]),
                    "turno": normalize_text(row.get("turno")),
                    "id_equipe": row.get("id_equipe"),
                    "equipe_nome": normalize_text(row.get("equipe_nome")),
                    "provedor_autenticacao": normalize_text(row.get("provedor_autenticacao")),
                    "deve_trocar_senha": bool(row.get("deve_trocar_senha")),
                    "operacoes": sorted(ops.get(id_usuario, [])),
                    "supervisores": sups.get(id_usuario, []),
                }
            )
        return resultado

    def mon_create_usuario(self, actor, data: dict, *, ip: str = "") -> dict:
        perfil = get_role_definition(data.get("perfil")).id
        if actor.perfil != ROLE_ADMIN and not pode_gerenciar_perfil(actor.perfil, perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seu perfil não pode criar este nível de usuário.")
        if perfil not in self._PERFIS_MONITORIA:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nível de usuário inválido para a Monitoria.")
        operacoes = sorted({normalize_text(item) for item in (data.get("operacoes") or []) if normalize_text(item)})
        supervisores = sorted({int(item) for item in (data.get("supervisores") or [])})
        if perfil == ROLE_CONTROL_DESK:
            operacoes = []
        erros = validar_vinculos(perfil, operacoes, supervisores)
        if erros:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=" ".join(erros))
        provedor = "local" if normalize_text(data.get("provedor_autenticacao")) == "local" else "microsoft"
        criado = self.create_system_user(
            {
                "nome": data.get("nome"),
                "sobrenome": data.get("sobrenome"),
                "email": data.get("email"),
                "login": data.get("login") or data.get("email"),
                "perfil": perfil,
                "cargo": data.get("cargo"),
                "status": "Ativo",
                "provedor_autenticacao": provedor,
                "senha": data.get("senha"),
            },
            actor=actor,
        )
        id_usuario = int(criado["id_usuario"])
        try:
            if provedor == "local":
                conn = self._connect()
                try:
                    conn.cursor().execute("UPDATE dbo.usuarios SET deve_trocar_senha = 1 WHERE id_usuario = ?", (id_usuario,))
                    conn.commit()
                finally:
                    conn.close()
            self.mon_set_vinculos(
                actor,
                id_usuario,
                {"operacoes": operacoes, "supervisores": supervisores, "id_equipe": data.get("id_equipe"), "turno": data.get("turno")},
                ip=ip,
            )
        except HTTPException:
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_usuario,))
                cursor.execute("DELETE FROM dbo.usuarios WHERE id_usuario = ?", (id_usuario,))
                conn.commit()
            finally:
                conn.close()
            raise
        return {"success": True, "id_usuario": id_usuario}

    def mon_update_usuario(self, actor, id_usuario: int, data: dict, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT perfil_id FROM dbo.usuarios WHERE id_usuario = ?", (int(id_usuario),))
            row = cursor.fetchone()
        finally:
            conn.close()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")
        perfil_atual = get_role_definition(row[0]).id
        if actor.perfil != ROLE_ADMIN and not pode_gerenciar_perfil(actor.perfil, perfil_atual):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seu perfil não pode alterar este nível de usuário.")
        novo_perfil = get_role_definition(data.get("perfil") or perfil_atual).id
        if novo_perfil != perfil_atual and actor.perfil != ROLE_ADMIN and not pode_gerenciar_perfil(actor.perfil, novo_perfil):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seu perfil não pode atribuir este nível.")
        self.update_system_user(
            int(id_usuario),
            {k: data[k] for k in ("nome", "sobrenome", "email", "cargo", "status", "perfil") if k in data},
            actor=actor,
        )
        if any(k in data for k in ("operacoes", "supervisores", "id_equipe", "turno")):
            self.mon_set_vinculos(
                actor,
                int(id_usuario),
                {k: data[k] for k in ("operacoes", "supervisores", "id_equipe", "turno") if k in data},
                ip=ip,
            )
        return {"success": True}

"""Monitoria — Plano de Ação (promt.txt §5.16): cadastro, revisões com histórico
append-only, comparação antes/depois e relatório filtrável."""

from __future__ import annotations

from datetime import date

from fastapi import status

from ..rbac import ROLE_OPERATOR, ROLE_SUPERVISOR
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_scope import pode_ver_operacao
from .monitoria import _http, _iso

STATUS_PLANO = ("ABERTO", "EM_ANDAMENTO", "EM_REVISAO", "CONCLUIDO")
ROTULOS_PLANO = {"ABERTO": "Aberto", "EM_ANDAMENTO": "Em andamento", "EM_REVISAO": "Em revisão", "CONCLUIDO": "Concluído"}
_TRANSICOES = {
    "ABERTO": {"EM_ANDAMENTO"},
    "EM_ANDAMENTO": {"EM_REVISAO"},
    "EM_REVISAO": {"EM_ANDAMENTO", "CONCLUIDO"},
    "CONCLUIDO": set(),
}


class MonitoriaPlanosRepositoryMixin:
    def _mon_media_valida(self, cursor, id_operador: int, desde: date | None = None) -> float | None:
        params: list = [id_operador]
        filtro = ""
        if desde:
            filtro = "AND CAST(m.data_monitoria AS DATE) >= ?"
            params.append(desde)
        cursor.execute(
            f"""
            SELECT AVG(CAST(m.nota AS FLOAT)) FROM dbo.monitorias m
            JOIN dbo.monitoria_estado e ON e.id_monitoria = m.id_monitoria
            WHERE m.id_operador = ? AND m.anulada = 0 AND ISNULL(e.resultado, '') <> 'ANULADA' {filtro}
            """,
            tuple(params),
        )
        valor = cursor.fetchone()[0]
        return None if valor is None else round(float(valor), 2)

    def _mon_plano_visivel(self, user, plano: dict, supervisionados: set[int]) -> bool:
        if not pode_ver_operacao(user.perfil, user.operacoes, normalize_text(plano["operacao"])):
            return False
        if user.perfil == ROLE_OPERATOR:
            return user.id_usuario == int(plano["id_operador"])
        if user.perfil == ROLE_SUPERVISOR:
            return int(plano["id_operador"]) in supervisionados
        return True

    def mon_plano_criar(self, user, dados: dict, *, ip: str = "") -> dict:
        problema, objetivo, acao = (normalize_text(dados.get(k)) for k in ("problema", "objetivo", "acao"))
        if not (problema and objetivo and acao):
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o problema identificado, o objetivo e a ação proposta.")
        try:
            prazo = date.fromisoformat(normalize_text(dados.get("prazo"))[:10])
        except ValueError:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o prazo do plano de ação.") from None
        if prazo < date.today():
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O prazo não pode estar no passado.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            id_monitoria = int(dados.get("id_monitoria") or 0) or None
            nota_antes = None
            if id_monitoria:
                origem_m = self.mon_detalhe(user, str(id_monitoria))  # valida escopo (404 fora dele)
                operacao, id_operador, operador_nome = origem_m["operacao"], int(origem_m["id_operador"]), origem_m["operador_nome"]
                nota_antes = origem_m["nota"]
            else:
                id_operador = int(dados.get("id_operador") or 0)
                cursor.execute("SELECT nome, sobrenome, perfil_id FROM dbo.usuarios WHERE id_usuario = ?", (id_operador,))
                op = cursor.fetchone()
                cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (id_operador,))
                ops = [normalize_text(r[0]) for r in cursor.fetchall()]
                if not op or not ops:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Selecione um operador válido.")
                operacao = normalize_text(dados.get("operacao")) or ops[0]
                if operacao not in ops:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O operador não pertence a esta operação.")
                operador_nome = " ".join(x for x in (normalize_text(op[0]), normalize_text(op[1])) if x)
                if user.perfil == ROLE_SUPERVISOR and id_operador not in self.mon_operadores_supervisionados(user.id_usuario):
                    raise _http(status.HTTP_403_FORBIDDEN, "Você só pode criar planos para operadores que supervisiona.")
                nota_antes = self._mon_media_valida(cursor, id_operador)
            self._mon_exigir_permissao_operacao(user, operacao)
            self._mon_exigir_operacao_ativa(cursor, operacao)
            id_resp = int(dados.get("id_responsavel") or user.id_usuario or 0) or None
            nome_resp = normalize_text(user.nome)
            if id_resp and id_resp != user.id_usuario:
                cursor.execute("SELECT nome FROM dbo.usuarios WHERE id_usuario = ?", (id_resp,))
                achado = cursor.fetchone()
                nome_resp = normalize_text(achado[0]) if achado else nome_resp
            cursor.execute(
                """
                INSERT INTO dbo.monitoria_planos_acao
                (id_monitoria, operacao, id_operador, operador_nome, origem, id_responsavel, responsavel_nome, problema, criterio,
                 objetivo, acao, prazo, observacoes, nota_antes, criado_por)
                OUTPUT INSERTED.id_plano VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (id_monitoria, operacao, id_operador, operador_nome,
                 normalize_text(dados.get("origem")) or ("Monitoria" if id_monitoria else "Manual"), id_resp, nome_resp,
                 problema, normalize_text(dados.get("criterio")) or None, objetivo, acao, prazo,
                 normalize_text(dados.get("observacoes")) or None, nota_antes, normalize_text(user.nome)),
            )
            id_plano = int(cursor.fetchone()[0])
            cursor.execute(
                "INSERT INTO dbo.monitoria_plano_historico (id_plano, evento, status_novo, detalhe, por) VALUES (?, 'criacao', 'ABERTO', ?, ?)",
                (id_plano, f"Plano criado (nota anterior: {nota_antes})", normalize_text(user.nome)),
            )
            self.mon_log(cursor, user, acao="criar_plano_acao", operacao=operacao, entidade="plano_acao", entidade_id=id_plano, ip=ip)
            conn.commit()
            return {"success": True, "id_plano": id_plano}
        finally:
            conn.close()

    def mon_plano_revisar(self, user, id_plano: int, dados: dict, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM dbo.monitoria_planos_acao WITH (UPDLOCK) WHERE id_plano = ?", (int(id_plano),))
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Plano de ação não encontrado.")
            plano = rows_to_dicts(cursor, [row])[0]
            supervisionados = self.mon_operadores_supervisionados(user.id_usuario) if user.perfil == ROLE_SUPERVISOR and user.id_usuario else set()
            if not self._mon_plano_visivel(user, plano, supervisionados) or user.perfil == ROLE_OPERATOR:
                raise _http(status.HTTP_404_NOT_FOUND, "Plano de ação não encontrado.")
            self._mon_exigir_operacao_ativa(cursor, normalize_text(plano["operacao"]))
            atual = normalize_text(plano["status"])
            novo = normalize_text(dados.get("status")).upper() or atual
            if novo not in STATUS_PLANO:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Status inválido.")
            if novo != atual and novo not in _TRANSICOES[atual]:
                raise _http(status.HTTP_409_CONFLICT, f"Não é possível ir de {ROTULOS_PLANO[atual]} para {ROTULOS_PLANO[novo]}.")
            if atual == "CONCLUIDO":
                raise _http(status.HTTP_409_CONFLICT, "Plano concluído não pode mais ser alterado.")
            resultado = normalize_text(dados.get("resultado")) or normalize_text(plano["resultado"])
            nota_depois = plano["nota_depois"]
            if novo == "CONCLUIDO":
                if not resultado:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Registre o resultado obtido para concluir o plano.")
                nota_depois = self._mon_media_valida(cursor, int(plano["id_operador"]), plano["criado_em"].date())
            data_revisao = normalize_text(dados.get("data_revisao"))[:10] or None
            cursor.execute(
                "UPDATE dbo.monitoria_planos_acao SET status = ?, resultado = ?, observacoes = COALESCE(?, observacoes), "
                "data_revisao = COALESCE(?, data_revisao, CAST(GETDATE() AS DATE)), nota_depois = ?, atualizado_em = GETDATE() WHERE id_plano = ?",
                (novo, resultado or None, normalize_text(dados.get("observacoes")) or None, data_revisao, nota_depois, int(id_plano)),
            )
            cursor.execute(
                "INSERT INTO dbo.monitoria_plano_historico (id_plano, evento, status_anterior, status_novo, detalhe, por) VALUES (?, ?, ?, ?, ?, ?)",
                (int(id_plano), "revisao" if novo == atual else "mudanca_status", atual, novo,
                 normalize_text(dados.get("detalhe")) or normalize_text(dados.get("observacoes")) or None, normalize_text(user.nome)),
            )
            self.mon_log(cursor, user, acao="revisar_plano_acao", operacao=normalize_text(plano["operacao"]), entidade="plano_acao",
                         entidade_id=id_plano, anterior={"status": atual}, posterior={"status": novo}, ip=ip)
            conn.commit()
            return {"success": True, "status": novo, "nota_depois": None if nota_depois is None else float(nota_depois)}
        finally:
            conn.close()

    def mon_plano_listar(self, user, filtros: dict | None = None, *, pagina: int = 1, por_pagina: int = 25) -> dict:
        filtros = filtros or {}
        escopo = self._mon_condicoes_escopo(user, "p", exigir_feedback=False)
        if escopo is None:
            return {"itens": [], "total": 0, "pagina": 1, "por_pagina": por_pagina}
        condicoes, params = escopo
        for chave, coluna in (("operacao", "p.operacao"), ("status", "p.status")):
            if normalize_text(filtros.get(chave)):
                condicoes.append(f"{coluna} = ?")
                params.append(normalize_text(filtros[chave]))
        for chave, coluna in (("id_operador", "p.id_operador"), ("id_responsavel", "p.id_responsavel"), ("id_plano", "p.id_plano")):
            if filtros.get(chave):
                condicoes.append(f"{coluna} = ?")
                params.append(int(filtros[chave]))
        if normalize_text(filtros.get("criterio")):
            condicoes.append("p.criterio LIKE ?")
            params.append(f"%{normalize_text(filtros['criterio'])}%")
        if normalize_text(filtros.get("data_inicio")):
            condicoes.append("CAST(p.criado_em AS DATE) >= ?")
            params.append(normalize_text(filtros["data_inicio"])[:10])
        if normalize_text(filtros.get("data_fim")):
            condicoes.append("CAST(p.criado_em AS DATE) <= ?")
            params.append(normalize_text(filtros["data_fim"])[:10])
        if filtros.get("vencidos"):
            condicoes.append("p.prazo < CAST(GETDATE() AS DATE) AND p.status <> 'CONCLUIDO'")
        where = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
        pagina = max(1, int(pagina))
        por_pagina = self._clamp_limit(por_pagina, 25, 500)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) FROM dbo.monitoria_planos_acao p {where}", tuple(params))
            total = int(cursor.fetchone()[0])
            cursor.execute(
                f"""
                SELECT p.*, o.nome AS operacao_nome,
                       CASE WHEN p.prazo < CAST(GETDATE() AS DATE) AND p.status <> 'CONCLUIDO' THEN 1 ELSE 0 END AS vencido
                FROM dbo.monitoria_planos_acao p LEFT JOIN dbo.operacoes o ON o.chave = p.operacao
                {where} ORDER BY p.criado_em DESC, p.id_plano DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
                """,
                (*params, (pagina - 1) * por_pagina, por_pagina),
            )
            itens = [self._mon_plano_dict(r) for r in rows_to_dicts(cursor, cursor.fetchall())]
            return {"itens": itens, "total": total, "pagina": pagina, "por_pagina": por_pagina}
        finally:
            conn.close()

    @staticmethod
    def _mon_plano_dict(r: dict) -> dict:
        return {
            "id_plano": r["id_plano"], "id_monitoria": r["id_monitoria"], "operacao": normalize_text(r["operacao"]),
            "operacao_nome": normalize_text(r.get("operacao_nome")), "id_operador": r["id_operador"],
            "operador_nome": normalize_text(r["operador_nome"]), "origem": normalize_text(r["origem"]),
            "responsavel": normalize_text(r["responsavel_nome"]), "problema": normalize_text(r["problema"]),
            "criterio": normalize_text(r["criterio"]), "objetivo": normalize_text(r["objetivo"]), "acao": normalize_text(r["acao"]),
            "prazo": _iso(r["prazo"]), "status": normalize_text(r["status"]), "status_rotulo": ROTULOS_PLANO.get(normalize_text(r["status"]), ""),
            "data_revisao": _iso(r["data_revisao"]), "resultado": normalize_text(r["resultado"]), "observacoes": normalize_text(r["observacoes"]),
            "nota_antes": None if r["nota_antes"] is None else float(r["nota_antes"]),
            "nota_depois": None if r["nota_depois"] is None else float(r["nota_depois"]),
            "criado_em": _iso(r["criado_em"]), "vencido": bool(r.get("vencido")),
        }

    def mon_plano_detalhe(self, user, id_plano: int) -> dict:
        itens = self.mon_plano_listar(user, {"id_plano": int(id_plano)}, por_pagina=1)["itens"]
        plano = itens[0] if itens else None
        if plano is None:
            raise _http(status.HTTP_404_NOT_FOUND, "Plano de ação não encontrado.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT evento, status_anterior, status_novo, detalhe, por, criado_em FROM dbo.monitoria_plano_historico WHERE id_plano = ? ORDER BY id_historico",
                (int(id_plano),),
            )
            plano["historico"] = [
                {"evento": normalize_text(h[0]), "de": normalize_text(h[1]), "para": normalize_text(h[2]), "detalhe": normalize_text(h[3]),
                 "por": normalize_text(h[4]), "em": _iso(h[5])}
                for h in cursor.fetchall()
            ]
            return plano
        finally:
            conn.close()

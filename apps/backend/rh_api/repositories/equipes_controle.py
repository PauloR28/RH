"""Controle de Equipes e Turnos (22/out/2026): visão do Supervisor sobre a própria equipe.

Mixin do DatabaseRepository, SQL puro (pyodbc). Não cria tabelas: "equipe" do Supervisor é o vínculo que já existe em
`dbo.usuarios_supervisores` (operador -> supervisor responsável), o mesmo editado no cadastro do usuário
(Configurações > Usuários). Por isso adicionar/remover aqui altera o cadastro do operador, e vice-versa.

Escopo (sempre no servidor): o Supervisor só enxerga e altera a PRÓPRIA equipe; Control Desk, Gestor e Administrador escolhem
um supervisor dentro das operações a que têm acesso e só consultam (a edição exige `equipes.membros.editar`, e só vale
para o supervisor logado)."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_OPERATOR, ROLE_SUPERVISOR, get_role_definition
from ..services import monitoria_indicadores as indicadores
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_scope import MAX_SUPERVISORES_OPERADOR, operacoes_permitidas

_JANELA_PADRAO_DIAS = 90


def _nome_completo(row: dict) -> str:
    return " ".join(p for p in (normalize_text(row.get("nome")), normalize_text(row.get("sobrenome"))) if p)


class EquipesControleRepositoryMixin:
    # ------------------------------------------------------------------
    # Supervisor alvo
    # ------------------------------------------------------------------
    def _eq_supervisores_no_escopo(self, cursor, user) -> list[dict]:
        permitidas = operacoes_permitidas(user.perfil, user.operacoes)
        cursor.execute(
            "SELECT id_usuario, nome, sobrenome, perfil_id, status FROM dbo.usuarios WHERE ISNULL(status, 'Ativo') = 'Ativo' ORDER BY nome"
        )
        candidatos = [r for r in rows_to_dicts(cursor, cursor.fetchall()) if get_role_definition(r["perfil_id"]).id == ROLE_SUPERVISOR]
        cursor.execute("SELECT id_usuario, operacao FROM dbo.usuarios_operacoes")
        ops: dict[int, set[str]] = {}
        for id_usuario, operacao in cursor.fetchall():
            ops.setdefault(int(id_usuario), set()).add(normalize_text(operacao))
        saida = []
        for r in candidatos:
            id_usuario = int(r["id_usuario"])
            if permitidas is not None and not (ops.get(id_usuario, set()) & set(permitidas)):
                continue
            saida.append({"id_usuario": id_usuario, "nome": _nome_completo(r), "operacoes": sorted(ops.get(id_usuario, set()))})
        return saida

    def _eq_resolver_supervisor(self, cursor, user, id_supervisor: int | None) -> int | None:
        """Supervisor logado = ele mesmo (o parâmetro é ignorado). Demais perfis: o escolhido, se estiver no escopo."""
        if user.perfil == ROLE_SUPERVISOR:
            if not user.id_usuario:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário sem identificação.")
            return int(user.id_usuario)
        if not id_supervisor:
            return None
        if int(id_supervisor) not in {s["id_usuario"] for s in self._eq_supervisores_no_escopo(cursor, user)}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Este supervisor está fora do seu escopo de acesso.")
        return int(id_supervisor)

    def _eq_ops_do_usuario(self, cursor, id_usuario: int) -> list[dict]:
        cursor.execute(
            """
            SELECT o.id_item, o.chave, o.nome, o.ativo
            FROM dbo.usuarios_operacoes uo JOIN dbo.operacoes o ON o.chave = uo.operacao
            WHERE uo.id_usuario = ? ORDER BY o.nome
            """,
            (int(id_usuario),),
        )
        return [
            {"id_item": r["id_item"], "chave": normalize_text(r["chave"]), "nome": normalize_text(r["nome"]), "ativo": bool(r["ativo"])}
            for r in rows_to_dicts(cursor, cursor.fetchall())
        ]

    # ------------------------------------------------------------------
    # Contexto + equipe
    # ------------------------------------------------------------------
    def eq_contexto(self, user, id_supervisor: int | None = None) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            alvo = self._eq_resolver_supervisor(cursor, user, id_supervisor)
            eh_supervisor = user.perfil == ROLE_SUPERVISOR
            contexto: dict[str, Any] = {
                "perfil": user.perfil,
                "eh_supervisor": eh_supervisor,
                "supervisores": [] if eh_supervisor else self._eq_supervisores_no_escopo(cursor, user),
                "supervisor": None,
                "operadores": [],
                "operacoes": [],
                "pode_editar_membros": bool(eh_supervisor and user.has_permission("equipes.membros.editar")),
                "pode_publicar_mural": bool(eh_supervisor and user.has_permission("equipes.mural.publicar")),
            }
            if alvo is None:
                return contexto
            cursor.execute("SELECT nome, sobrenome, email, turno FROM dbo.usuarios WHERE id_usuario = ?", (alvo,))
            sup = rows_to_dicts(cursor, cursor.fetchall())
            if not sup:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Supervisor não encontrado.")
            contexto["operacoes"] = self._eq_ops_do_usuario(cursor, alvo)
            contexto["supervisor"] = {
                "id_usuario": alvo,
                "nome": _nome_completo(sup[0]),
                "email": normalize_text(sup[0].get("email")),
                "turno": normalize_text(sup[0].get("turno")),
            }
            contexto["operadores"] = self._eq_operadores(cursor, alvo)
            return contexto
        finally:
            conn.close()

    def _eq_operadores(self, cursor, id_supervisor: int) -> list[dict]:
        cursor.execute(
            """
            SELECT u.id_usuario, u.nome, u.sobrenome, u.email, u.status, u.turno, u.id_equipe, e.nome AS equipe_nome,
                   (SELECT COUNT(*) FROM dbo.usuarios_supervisores x WHERE x.id_operador = u.id_usuario) AS qtd_supervisores
            FROM dbo.usuarios_supervisores s
            JOIN dbo.usuarios u ON u.id_usuario = s.id_operador
            LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
            WHERE s.id_supervisor = ?
            ORDER BY u.nome, u.sobrenome
            """,
            (int(id_supervisor),),
        )
        linhas = rows_to_dicts(cursor, cursor.fetchall())
        if not linhas:
            return []
        cursor.execute(
            "SELECT uo.id_usuario, uo.operacao FROM dbo.usuarios_operacoes uo "
            "JOIN dbo.usuarios_supervisores s ON s.id_operador = uo.id_usuario WHERE s.id_supervisor = ?",
            (int(id_supervisor),),
        )
        ops: dict[int, list[str]] = {}
        for id_usuario, operacao in cursor.fetchall():
            ops.setdefault(int(id_usuario), []).append(normalize_text(operacao))
        return [
            {
                "id_usuario": int(r["id_usuario"]),
                "nome": _nome_completo(r),
                "email": normalize_text(r.get("email")),
                "status": normalize_text(r.get("status")),
                "turno": normalize_text(r.get("turno")),
                "id_equipe": r.get("id_equipe"),
                "equipe_nome": normalize_text(r.get("equipe_nome")),
                "operacoes": sorted(ops.get(int(r["id_usuario"]), [])),
                "qtd_supervisores": int(r.get("qtd_supervisores") or 0),
            }
            for r in linhas
        ]

    def eq_candidatos(self, user, id_supervisor: int | None = None) -> list[dict]:
        """Operadores ativos das operações do supervisor que ainda não estão na equipe dele e têm vaga de supervisor."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            alvo = self._eq_resolver_supervisor(cursor, user, id_supervisor)
            if alvo is None:
                return []
            chaves = [o["chave"] for o in self._eq_ops_do_usuario(cursor, alvo) if o["ativo"]]
            if not chaves:
                return []
            marcadores = ",".join("?" for _ in chaves)
            cursor.execute(
                f"""
                SELECT u.id_usuario, u.nome, u.sobrenome, u.perfil_id, u.status, u.turno,
                       (SELECT COUNT(*) FROM dbo.usuarios_supervisores x WHERE x.id_operador = u.id_usuario) AS qtd_supervisores
                FROM dbo.usuarios u
                WHERE EXISTS (SELECT 1 FROM dbo.usuarios_operacoes uo WHERE uo.id_usuario = u.id_usuario AND uo.operacao IN ({marcadores}))
                  AND NOT EXISTS (SELECT 1 FROM dbo.usuarios_supervisores s WHERE s.id_operador = u.id_usuario AND s.id_supervisor = ?)
                ORDER BY u.nome, u.sobrenome
                """,
                (*chaves, alvo),
            )
            saida = []
            for r in rows_to_dicts(cursor, cursor.fetchall()):
                if get_role_definition(r["perfil_id"]).id != ROLE_OPERATOR:
                    continue
                if normalize_text(r.get("status")) not in ("", "Ativo"):
                    continue
                qtd = int(r.get("qtd_supervisores") or 0)
                saida.append(
                    {
                        "id_usuario": int(r["id_usuario"]),
                        "nome": _nome_completo(r),
                        "turno": normalize_text(r.get("turno")),
                        "qtd_supervisores": qtd,
                        "disponivel": qtd < MAX_SUPERVISORES_OPERADOR,
                    }
                )
            return saida
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Alterar a equipe (reflete no cadastro do operador: usuarios_supervisores)
    # ------------------------------------------------------------------
    def _eq_exigir_operador_valido(self, cursor, id_operador: int) -> dict:
        cursor.execute("SELECT id_usuario, nome, sobrenome, perfil_id FROM dbo.usuarios WHERE id_usuario = ?", (int(id_operador),))
        linhas = rows_to_dicts(cursor, cursor.fetchall())
        if not linhas or get_role_definition(linhas[0]["perfil_id"]).id != ROLE_OPERATOR:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operador não encontrado.")
        return linhas[0]

    def eq_adicionar_operador(self, user, id_operador: int, *, ip: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            alvo = self._eq_resolver_supervisor(cursor, user, None)
            operador = self._eq_exigir_operador_valido(cursor, id_operador)
            ops_sup = {o["chave"] for o in self._eq_ops_do_usuario(cursor, alvo) if o["ativo"]}
            cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (int(id_operador),))
            ops_op = {normalize_text(r[0]) for r in cursor.fetchall()}
            if not (ops_sup & ops_op):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O operador precisa estar em uma operação ativa do supervisor.")
            cursor.execute("SELECT id_supervisor FROM dbo.usuarios_supervisores WHERE id_operador = ?", (int(id_operador),))
            atuais = [int(r[0]) for r in cursor.fetchall()]
            if alvo in atuais:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="O operador já está na sua equipe.")
            if len(atuais) >= MAX_SUPERVISORES_OPERADOR:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"O operador já tem {MAX_SUPERVISORES_OPERADOR} supervisores. Peça ao Control Desk para liberar uma vaga.",
                )
            cursor.execute("INSERT INTO dbo.usuarios_supervisores (id_operador, id_supervisor) VALUES (?, ?)", (int(id_operador), alvo))
            self.mon_log(
                cursor, user, acao="equipe_adicionar_operador", operacao=",".join(sorted(ops_sup & ops_op)), modulo="Equipes",
                entidade="usuario", entidade_id=int(id_operador), anterior={"supervisores": atuais},
                posterior={"supervisores": [*atuais, alvo]}, detalhes={"operador": _nome_completo(operador)}, ip=ip,
            )
            conn.commit()
        finally:
            conn.close()
        return self.eq_contexto(user)

    def eq_remover_operador(self, user, id_operador: int, id_novo_supervisor: int | None = None, *, ip: str = "") -> dict:
        """Tira o operador da equipe. Todo operador precisa de ao menos 1 supervisor: se este é o único, informe o substituto."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            alvo = self._eq_resolver_supervisor(cursor, user, None)
            operador = self._eq_exigir_operador_valido(cursor, id_operador)
            cursor.execute("SELECT id_supervisor FROM dbo.usuarios_supervisores WHERE id_operador = ?", (int(id_operador),))
            atuais = [int(r[0]) for r in cursor.fetchall()]
            if alvo not in atuais:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="O operador não está na sua equipe.")
            novos = [s for s in atuais if s != alvo]
            if id_novo_supervisor:
                destino = int(id_novo_supervisor)
                if destino == alvo or destino in novos:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Escolha outro supervisor para receber o operador.")
                if destino not in {s["id_usuario"] for s in self._eq_supervisores_no_escopo(cursor, user)} | {s["id_usuario"] for s in self._eq_colegas(cursor, alvo)}:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Supervisor inválido para esta operação.")
                cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (destino,))
                ops_dest = {normalize_text(r[0]) for r in cursor.fetchall()}
                cursor.execute("SELECT operacao FROM dbo.usuarios_operacoes WHERE id_usuario = ?", (int(id_operador),))
                ops_op = {normalize_text(r[0]) for r in cursor.fetchall()}
                if not (ops_dest & ops_op):
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="O supervisor escolhido precisa estar na operação do operador.")
                novos.append(destino)
            if not novos:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Você é o único supervisor deste operador. Escolha o supervisor que vai recebê-lo para concluir a remoção.",
                )
            if len(novos) > MAX_SUPERVISORES_OPERADOR:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="O supervisor escolhido já atingiu o limite para este operador.")
            cursor.execute("DELETE FROM dbo.usuarios_supervisores WHERE id_operador = ? AND id_supervisor = ?", (int(id_operador), alvo))
            if id_novo_supervisor:
                cursor.execute("INSERT INTO dbo.usuarios_supervisores (id_operador, id_supervisor) VALUES (?, ?)", (int(id_operador), int(id_novo_supervisor)))
            self.mon_log(
                cursor, user, acao="equipe_remover_operador", modulo="Equipes", entidade="usuario", entidade_id=int(id_operador),
                anterior={"supervisores": atuais}, posterior={"supervisores": novos}, detalhes={"operador": _nome_completo(operador)}, ip=ip,
            )
            conn.commit()
        finally:
            conn.close()
        return self.eq_contexto(user)

    def _eq_colegas(self, cursor, id_supervisor: int) -> list[dict]:
        """Supervisores que dividem ao menos uma operação com o supervisor (destino possível de uma remoção)."""
        cursor.execute(
            """
            SELECT DISTINCT u.id_usuario, u.nome, u.sobrenome, u.perfil_id
            FROM dbo.usuarios_operacoes a
            JOIN dbo.usuarios_operacoes b ON b.operacao = a.operacao AND b.id_usuario <> a.id_usuario
            JOIN dbo.usuarios u ON u.id_usuario = b.id_usuario
            WHERE a.id_usuario = ?
            """,
            (int(id_supervisor),),
        )
        return [
            {"id_usuario": int(r["id_usuario"]), "nome": _nome_completo(r)}
            for r in rows_to_dicts(cursor, cursor.fetchall())
            if get_role_definition(r["perfil_id"]).id == ROLE_SUPERVISOR
        ]

    def eq_supervisores_destino(self, user) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            alvo = self._eq_resolver_supervisor(cursor, user, None)
            return self._eq_colegas(cursor, alvo)
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Monitorias da equipe (motor único de indicadores)
    # ------------------------------------------------------------------
    def eq_monitorias(self, user, id_supervisor: int | None = None, *, dias: int = _JANELA_PADRAO_DIAS) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            alvo = self._eq_resolver_supervisor(cursor, user, id_supervisor)
            if alvo is None:
                return {"resumo": None, "por_operador": [], "itens": []}
            ids = [o["id_usuario"] for o in self._eq_operadores(cursor, alvo)]
            if not ids:
                return {"resumo": None, "por_operador": [], "itens": []}
            dias = max(1, min(int(dias or _JANELA_PADRAO_DIAS), 365))
            condicoes = [f"m.id_operador IN ({','.join('?' for _ in ids)})", "m.data_monitoria >= DATEADD(day, ?, CAST(GETDATE() AS DATE))"]
            linhas = self._mon_linhas(cursor, condicoes, [*ids, -dias], com_respostas=False)
        finally:
            conn.close()
        faixas = self._mon_faixas()
        itens = [
            {
                "id_monitoria": l["id_monitoria"], "codigo": l["codigo"], "id_operador": l["id_operador"], "operador_nome": l["operador_nome"],
                "operacao_nome": l["operacao_nome"], "data": l["data"], "nota": l["nota"], "nivel": l["nivel"], "possui_ncg": l["possui_ncg"],
                "anulada": l["anulada"], "canal": l["canal"], "tipo_atendimento": l["tipo_atendimento"],
                "avaliador_nome": l["avaliador_nome"], "status": l["status"], "resultado": l["resultado"],
            }
            for l in linhas
        ]
        return {
            "dias": dias,
            "resumo": indicadores.resumo(linhas, faixas=faixas),
            "por_operador": indicadores.agrupar(linhas, "operador", faixas=faixas),
            "itens": itens,
        }

    # ------------------------------------------------------------------
    # Mural da operação (publica direto nas intranets conectadas das operações do supervisor)
    # ------------------------------------------------------------------
    def eq_mural_ambientes(self, user) -> list[dict]:
        ids_op = {o["id_item"] for o in self.mon_operacoes_do_usuario(user, apenas_ativas=True)}
        return [a for a in self.list_mural_ambientes_disponiveis() if a.get("operacao_id") in ids_op]

    def _eq_mural_ids_permitidos(self, user) -> set[int]:
        return {int(a["id_ambiente"]) for a in self.eq_mural_ambientes(user)}

    def _eq_mural_validar_ambientes(self, user, ambientes: list[int]) -> list[int]:
        pedidos = sorted({int(x) for x in (ambientes or [])})
        if not pedidos:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selecione ao menos uma intranet da sua operação.")
        if not set(pedidos) <= self._eq_mural_ids_permitidos(user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Há intranet fora das operações da sua equipe.")
        return pedidos

    def _eq_mural_na_alcada(self, user, publicacao: dict, permitidos: set[int]) -> bool:
        if normalize_text(publicacao.get("criado_por")) == normalize_text(user.username):
            return True
        destinos = {int(a["id_ambiente"]) for a in (publicacao.get("ambientes") or [])}
        return bool(destinos) and destinos <= permitidos

    def eq_mural_listar(self, user, status_filtro: str = "") -> list[dict]:
        permitidos = self._eq_mural_ids_permitidos(user)
        return [p for p in self.list_mural_publicacoes(status_filtro) if self._eq_mural_na_alcada(user, p, permitidos)]

    def eq_mural_exigir(self, user, id_publicacao: int) -> dict:
        publicacao = self.get_mural_publicacao(id_publicacao)
        if not self._eq_mural_na_alcada(user, publicacao, self._eq_mural_ids_permitidos(user)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Esta publicação não pertence às operações da sua equipe.")
        return publicacao

    def eq_mural_salvar(self, user, data: dict, id_publicacao: int | None = None) -> dict:
        data = {**data, "ambientes": self._eq_mural_validar_ambientes(user, data.get("ambientes"))}
        if id_publicacao:
            self.eq_mural_exigir(user, id_publicacao)
            return self.update_mural_publicacao(id_publicacao, data, actor=user.username)
        return self.create_mural_publicacao(data, actor=user.username)

    def eq_mural_publicar(self, user, id_publicacao: int, ambientes: list[int]) -> dict:
        self.eq_mural_exigir(user, id_publicacao)
        return self.publicar_mural_publicacao(id_publicacao, self._eq_mural_validar_ambientes(user, ambientes), actor=user.username)

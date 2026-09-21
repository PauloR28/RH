"""Monitoria — matriz versionada, realização (snapshot imutável), consulta e
rascunhos (promt.txt §5). Mixin do DatabaseRepository, SQL puro (pyodbc).

Imutabilidade: `monitorias`, `monitoria_respostas` e `monitoria_pilares` só
recebem INSERT (trigger de banco + nenhuma rota de update/delete). O estado
corrente do fluxo vive em `monitoria_estado` e o histórico em
`monitoria_eventos` — jamais dentro da monitoria."""

from __future__ import annotations

import json
import logging
import secrets
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, status

from ..rbac import ROLE_ADMIN, ROLE_OPERATOR, ROLE_QUALIDADE, ROLE_SUPERVISOR, get_role_definition
from ..services import monitoria_workflow as wf
from ..services.helpers import normalize_text, rows_to_dicts
from ..services.monitoria_engine import (
    calcular_nota,
    config_padrao,
    criterios_sem_resposta,
    faixa_da_nota,
    media_pilar,
    normalizar_config,
    normalizar_resposta,
    validar_config,
    validar_pilares,
)
from ..services.monitoria_scope import (
    operacoes_permitidas,
    pode_ver_detalhe_monitoria,
    pode_ver_operacao,
)

logger = logging.getLogger(__name__)

_ROLE_ADMIN_LIKE = {ROLE_ADMIN}


def _http(codigo: int, mensagem: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=mensagem)


def _json(valor: Any) -> str:
    return json.dumps(valor, ensure_ascii=False, default=str)


def _load(valor: Any, padrao: Any) -> Any:
    if valor in (None, ""):
        return padrao
    try:
        return json.loads(valor)
    except (TypeError, ValueError):
        return padrao


def _iso(valor: Any) -> str | None:
    if valor is None:
        return None
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return str(valor)


class MonitoriaRepositoryMixin:
    # ------------------------------------------------------------------
    # Utilitários
    # ------------------------------------------------------------------
    @staticmethod
    def _mon_agora(cursor) -> datetime:
        cursor.execute("SELECT GETDATE()")
        return cursor.fetchone()[0]

    def _mon_config_valor(self, cursor, chave: str, padrao: str) -> str:
        cursor.execute("SELECT valor FROM dbo.monitoria_config WHERE chave = ?", (chave,))
        row = cursor.fetchone()
        return normalize_text(row[0]) if row else padrao

    def _mon_horas_sla(self, cursor) -> dict[str, int]:
        return {
            wf.SLA_FEEDBACK: int(self._mon_config_valor(cursor, "sla_feedback_horas", "72")),
            wf.SLA_CONFIRMACAO: int(self._mon_config_valor(cursor, "sla_confirmacao_horas", "48")),
            wf.SLA_REANALISE: int(self._mon_config_valor(cursor, "sla_reanalise_horas", "72")),
        }

    def _mon_exigir_permissao_operacao(self, user, operacao: str) -> None:
        if not pode_ver_operacao(user.perfil, user.operacoes, operacao):
            raise _http(status.HTTP_403_FORBIDDEN, "Esta operação está fora do seu escopo de acesso.")

    # ------------------------------------------------------------------
    # Matriz de qualidade versionada (por operação)
    # ------------------------------------------------------------------
    def _mon_garantir_matriz(self, cursor, operacao: str) -> int:
        """Devolve o id da matriz da operação, criando a versão 1.0 padrão se
        a operação foi cadastrada depois do último bootstrap."""
        cursor.execute("SELECT id_matriz FROM dbo.monitoria_matrizes WHERE operacao = ?", (operacao,))
        row = cursor.fetchone()
        if row:
            return int(row[0])
        cursor.execute("SELECT nome, ativo FROM dbo.operacoes WHERE chave = ?", (operacao,))
        op = cursor.fetchone()
        if not op:
            raise _http(status.HTTP_404_NOT_FOUND, "Operação não encontrada.")
        if not bool(op[1]):
            raise _http(status.HTTP_409_CONFLICT, "A operação está inativa: nenhuma alteração é permitida.")
        cursor.execute(
            "INSERT INTO dbo.monitoria_matrizes (operacao, nome, criado_por) OUTPUT INSERTED.id_matriz VALUES (?, ?, 'sistema')",
            (operacao, f"Matriz de qualidade — {normalize_text(op[0])}"),
        )
        id_matriz = int(cursor.fetchone()[0])
        cursor.execute(
            "INSERT INTO dbo.monitoria_matriz_versoes (id_matriz, numero, config_json, observacao, criado_por) "
            "OUTPUT INSERTED.id_versao VALUES (?, 1, ?, 'Versão inicial (matriz 1.0)', 'sistema')",
            (id_matriz, _json(config_padrao())),
        )
        cursor.execute(
            "UPDATE dbo.monitoria_matrizes SET id_versao_ativa = ? WHERE id_matriz = ?",
            (int(cursor.fetchone()[0]), id_matriz),
        )
        return id_matriz

    def _mon_versao_ativa(self, cursor, operacao: str) -> dict:
        id_matriz = self._mon_garantir_matriz(cursor, operacao)
        cursor.execute(
            """
            SELECT m.id_matriz, m.nome, v.id_versao, v.numero, v.config_json, v.observacao, v.criado_por, v.criado_em
            FROM dbo.monitoria_matrizes m
            JOIN dbo.monitoria_matriz_versoes v ON v.id_versao = m.id_versao_ativa
            WHERE m.id_matriz = ?
            """,
            (id_matriz,),
        )
        row = cursor.fetchone()
        if not row:
            raise _http(status.HTTP_404_NOT_FOUND, "A operação ainda não possui uma versão ativa de matriz.")
        return {
            "id_matriz": row[0], "nome": normalize_text(row[1]), "id_versao": row[2], "numero": row[3],
            "config": _load(row[4], {}), "observacao": normalize_text(row[5]),
            "criado_por": normalize_text(row[6]), "criado_em": _iso(row[7]),
        }

    def mon_get_matriz(self, user, operacao: str) -> dict:
        operacao = normalize_text(operacao)
        self._mon_exigir_permissao_operacao(user, operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            versao = self._mon_versao_ativa(cursor, operacao)
            conn.commit()
            return {"operacao": operacao, "versao_ativa": versao}
        finally:
            conn.close()

    def mon_list_versoes(self, user, operacao: str) -> list[dict]:
        operacao = normalize_text(operacao)
        self._mon_exigir_permissao_operacao(user, operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            id_matriz = self._mon_garantir_matriz(cursor, operacao)
            cursor.execute(
                """
                SELECT v.id_versao, v.numero, v.observacao, v.criado_por, v.criado_em,
                       CASE WHEN m.id_versao_ativa = v.id_versao THEN 1 ELSE 0 END AS ativa,
                       (SELECT COUNT(*) FROM dbo.monitorias x WHERE x.id_versao = v.id_versao) AS monitorias
                FROM dbo.monitoria_matriz_versoes v
                JOIN dbo.monitoria_matrizes m ON m.id_matriz = v.id_matriz
                WHERE v.id_matriz = ? ORDER BY v.numero DESC
                """,
                (id_matriz,),
            )
            itens = [
                {"id_versao": r[0], "numero": r[1], "observacao": normalize_text(r[2]), "criado_por": normalize_text(r[3]),
                 "criado_em": _iso(r[4]), "ativa": bool(r[5]), "monitorias": int(r[6] or 0)}
                for r in cursor.fetchall()
            ]
            conn.commit()
            return itens
        finally:
            conn.close()

    def mon_get_versao(self, user, id_versao: int) -> dict:
        """Versão arquivada ou ativa, SOMENTE LEITURA."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT v.id_versao, v.numero, v.config_json, v.observacao, v.criado_por, v.criado_em, m.operacao
                FROM dbo.monitoria_matriz_versoes v JOIN dbo.monitoria_matrizes m ON m.id_matriz = v.id_matriz
                WHERE v.id_versao = ?
                """,
                (int(id_versao),),
            )
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Versão não encontrada.")
            self._mon_exigir_permissao_operacao(user, normalize_text(row[6]))
            return {"id_versao": row[0], "numero": row[1], "config": _load(row[2], {}), "observacao": normalize_text(row[3]),
                    "criado_por": normalize_text(row[4]), "criado_em": _iso(row[5]), "operacao": normalize_text(row[6])}
        finally:
            conn.close()

    def mon_save_versao(self, user, operacao: str, config_bruta: dict, observacao: str = "", *, ip: str = "") -> dict:
        """Editar e salvar a matriz SEMPRE cria uma nova versão; a anterior fica
        arquivada e consultável. Monitorias antigas não são tocadas."""
        operacao = normalize_text(operacao)
        self._mon_exigir_permissao_operacao(user, operacao)
        config = normalizar_config(config_bruta or {})
        erros = validar_config(config)
        if erros:
            raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, " ".join(erros))
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._mon_exigir_operacao_ativa(cursor, operacao)
            id_matriz = self._mon_garantir_matriz(cursor, operacao)
            atual = self._mon_versao_ativa(cursor, operacao)
            if atual["config"] == config:
                raise _http(status.HTTP_409_CONFLICT, "Nenhuma alteração em relação à versão ativa.")
            cursor.execute("SELECT ISNULL(MAX(numero), 0) + 1 FROM dbo.monitoria_matriz_versoes WHERE id_matriz = ?", (id_matriz,))
            numero = int(cursor.fetchone()[0])
            cursor.execute(
                "INSERT INTO dbo.monitoria_matriz_versoes (id_matriz, numero, config_json, observacao, criado_por) "
                "OUTPUT INSERTED.id_versao VALUES (?, ?, ?, ?, ?)",
                (id_matriz, numero, _json(config), normalize_text(observacao) or None, normalize_text(user.nome)),
            )
            id_versao = int(cursor.fetchone()[0])
            cursor.execute("UPDATE dbo.monitoria_matrizes SET id_versao_ativa = ? WHERE id_matriz = ?", (id_versao, id_matriz))
            self.mon_log(cursor, user, acao="criar_versao_matriz", operacao=operacao, entidade="matriz", entidade_id=id_versao,
                         anterior={"versao": atual["numero"]}, posterior={"versao": numero, "observacao": observacao}, ip=ip)
            conn.commit()
            return {"success": True, "id_versao": id_versao, "numero": numero}
        finally:
            conn.close()

    def mon_calcular(self, user, operacao: str, respostas: dict) -> dict:
        """Prévia da nota para o formulário — usa o MESMO motor da gravação
        (nunca uma segunda fórmula no navegador)."""
        operacao = normalize_text(operacao)
        self._mon_exigir_permissao_operacao(user, operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            versao = self._mon_versao_ativa(cursor, operacao)
            conn.commit()
        finally:
            conn.close()
        config = versao["config"]
        normalizadas = {str(k): normalizar_resposta(v) for k, v in (respostas or {}).items()}
        r = calcular_nota(config, normalizadas)
        return {
            "nota": float(r["nota"]), "possui_ncg": r["possui_ncg"], "anulada": r["anulada"], "blocos": r["blocos"],
            "blocos_avaliados": r["blocos_avaliados"], "blocos_nulos": r["blocos_nulos"], "min_blocos": r["min_blocos"],
            "faixa": faixa_da_nota(r["nota"], config.get("faixas")), "pendentes": len(criterios_sem_resposta(config, normalizadas)),
        }

    # ------------------------------------------------------------------
    # Operadores elegíveis / catálogos para o formulário
    # ------------------------------------------------------------------
    def mon_operadores_elegiveis(self, user, operacao: str) -> list[dict]:
        operacao = normalize_text(operacao)
        self._mon_exigir_permissao_operacao(user, operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT u.id_usuario, u.nome, u.sobrenome, u.email, u.turno, u.id_equipe, e.nome AS equipe_nome
                FROM dbo.usuarios u
                JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario AND uo.operacao = ?
                LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
                WHERE u.perfil_id = ? AND u.status = 'Ativo'
                ORDER BY u.nome
                """,
                (operacao, ROLE_OPERATOR),
            )
            operadores = rows_to_dicts(cursor, cursor.fetchall())
            cursor.execute("SELECT id_operador, id_supervisor FROM dbo.usuarios_supervisores")
            supervisores: dict[int, list[int]] = {}
            for id_operador, id_supervisor in cursor.fetchall():
                supervisores.setdefault(int(id_operador), []).append(int(id_supervisor))
        finally:
            conn.close()
        if user.perfil == ROLE_SUPERVISOR:
            operadores = [o for o in operadores if user.id_usuario in supervisores.get(int(o["id_usuario"]), [])]
        return [
            {
                "id_usuario": o["id_usuario"],
                "nome": " ".join(x for x in (normalize_text(o["nome"]), normalize_text(o.get("sobrenome"))) if x),
                "email": normalize_text(o["email"]),
                "turno": normalize_text(o.get("turno")),
                "id_equipe": o.get("id_equipe"),
                "equipe_nome": normalize_text(o.get("equipe_nome")),
            }
            for o in operadores
        ]

    # ------------------------------------------------------------------
    # Rascunhos (mutáveis, visíveis só ao avaliador)
    # ------------------------------------------------------------------
    def mon_rascunho_salvar(self, user, operacao: str, payload: dict, id_rascunho: int | None = None) -> dict:
        operacao = normalize_text(operacao)
        self._mon_exigir_permissao_operacao(user, operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            if id_rascunho:
                cursor.execute(
                    "UPDATE dbo.monitoria_rascunhos SET payload_json = ?, operacao = ?, atualizado_em = GETDATE() "
                    "WHERE id_rascunho = ? AND id_avaliador = ?",
                    (_json(payload), operacao, int(id_rascunho), user.id_usuario),
                )
                if cursor.rowcount == 0:
                    raise _http(status.HTTP_404_NOT_FOUND, "Rascunho não encontrado.")
                resolved = int(id_rascunho)
            else:
                cursor.execute(
                    "INSERT INTO dbo.monitoria_rascunhos (id_avaliador, operacao, payload_json) OUTPUT INSERTED.id_rascunho VALUES (?, ?, ?)",
                    (user.id_usuario, operacao, _json(payload)),
                )
                resolved = int(cursor.fetchone()[0])
            conn.commit()
            return {"success": True, "id_rascunho": resolved}
        finally:
            conn.close()

    def mon_rascunho_listar(self, user) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id_rascunho, operacao, payload_json, atualizado_em FROM dbo.monitoria_rascunhos "
                "WHERE id_avaliador = ? ORDER BY atualizado_em DESC",
                (user.id_usuario,),
            )
            return [
                {"id_rascunho": r[0], "operacao": normalize_text(r[1]), "payload": _load(r[2], {}), "atualizado_em": _iso(r[3])}
                for r in cursor.fetchall()
            ]
        finally:
            conn.close()

    def mon_rascunho_descartar(self, user, id_rascunho: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM dbo.monitoria_rascunhos WHERE id_rascunho = ? AND id_avaliador = ?", (int(id_rascunho), user.id_usuario))
            conn.commit()
            return {"success": True}
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Fluxo: registro de passos (estado corrente + histórico append-only)
    # ------------------------------------------------------------------
    def _mon_registrar_passos(
        self,
        cursor,
        id_monitoria: int,
        passos: list[wf.PASSO],
        user,
        *,
        automatico: bool = False,
        observacao: str = "",
        horas_sla: dict[str, int] | None = None,
    ) -> None:
        cursor.execute("SELECT status FROM dbo.monitoria_estado WHERE id_monitoria = ?", (id_monitoria,))
        row = cursor.fetchone()
        anterior = normalize_text(row[0]) if row else None
        existe = row is not None
        horas = horas_sla or self._mon_horas_sla(cursor)
        for status_novo, sla_tipo in passos:
            cursor.execute(
                """
                INSERT INTO dbo.monitoria_eventos
                (id_monitoria, status_anterior, status_novo, id_usuario, usuario_nome, perfil, automatico, observacao)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    id_monitoria, anterior, status_novo,
                    None if automatico else getattr(user, "id_usuario", None),
                    "Sistema" if automatico else (normalize_text(getattr(user, "nome", "")) or "Sistema"),
                    "sistema" if automatico else normalize_text(getattr(user, "perfil", "")),
                    1 if automatico else 0,
                    normalize_text(observacao) or None,
                ),
            )
            anterior = status_novo
        ultimo_status, ultimo_sla = passos[-1]
        resultado = wf.resultado_final(passos)
        # SLA: se o último passo inicia um SLA, grava início/limite; senão limpa.
        if ultimo_sla:
            sla_sql = ", sla_tipo = ?, sla_inicio = GETDATE(), sla_limite = DATEADD(HOUR, ?, GETDATE())"
            sla_params: tuple = (ultimo_sla, int(horas[ultimo_sla]))
            insert_sla = ("?", "GETDATE()", "DATEADD(HOUR, ?, GETDATE())")
        else:
            sla_sql = ", sla_tipo = NULL, sla_inicio = NULL, sla_limite = NULL"
            sla_params = ()
            insert_sla = ("NULL", "NULL", "NULL")
        if existe:
            cursor.execute(
                f"UPDATE dbo.monitoria_estado SET status = ?, resultado = COALESCE(?, resultado), atualizado_em = GETDATE(){sla_sql} WHERE id_monitoria = ?",
                (ultimo_status, resultado, *sla_params, id_monitoria),
            )
        else:
            cursor.execute(
                f"INSERT INTO dbo.monitoria_estado (id_monitoria, status, resultado, sla_tipo, sla_inicio, sla_limite) "
                f"VALUES (?, ?, ?, {insert_sla[0]}, {insert_sla[1]}, {insert_sla[2]})",
                (id_monitoria, ultimo_status, resultado, *sla_params),
            )

    # ------------------------------------------------------------------
    # Realização da monitoria (snapshot imutável)
    # ------------------------------------------------------------------
    def _mon_novo_codigo(self, cursor) -> str:
        for _ in range(50):
            codigo = str(secrets.randbelow(90_000_000) + 10_000_000)
            cursor.execute("SELECT TOP 1 1 FROM dbo.monitorias WHERE codigo = ?", (codigo,))
            if not cursor.fetchone():
                return codigo
        raise _http(status.HTTP_503_SERVICE_UNAVAILABLE, "Não foi possível gerar um ID único para a monitoria. Tente novamente.")

    def mon_criar_monitoria(self, user, dados: dict, *, ip: str = "") -> dict:
        operacao = normalize_text(dados.get("operacao"))
        self._mon_exigir_permissao_operacao(user, operacao)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            self._mon_exigir_operacao_ativa(cursor, operacao)
            cursor.execute("SELECT nome FROM dbo.operacoes WHERE chave = ?", (operacao,))
            operacao_nome = normalize_text(cursor.fetchone()[0])

            # Operador: ativo, perfil operador, na operação (e supervisionado pelo ator, se Supervisor)
            id_operador = int(dados.get("id_operador") or 0)
            cursor.execute(
                """
                SELECT u.nome, u.sobrenome, u.email, u.perfil_id, u.status, u.turno, u.id_equipe, e.nome
                FROM dbo.usuarios u LEFT JOIN dbo.equipes_operacao e ON e.id_equipe = u.id_equipe
                WHERE u.id_usuario = ?
                """,
                (id_operador,),
            )
            op = cursor.fetchone()
            if not op or get_role_definition(op[3]).id != ROLE_OPERATOR or normalize_text(op[4]).lower() != "ativo":
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Selecione um operador ativo.")
            if id_operador == user.id_usuario:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O avaliador não pode monitorar a si mesmo.")
            cursor.execute("SELECT TOP 1 1 FROM dbo.usuarios_operacoes WHERE id_usuario = ? AND operacao = ?", (id_operador, operacao))
            if not cursor.fetchone():
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "O operador não pertence a esta operação.")
            cursor.execute(
                "SELECT s.id_supervisor, u.nome FROM dbo.usuarios_supervisores s JOIN dbo.usuarios u ON u.id_usuario = s.id_supervisor WHERE s.id_operador = ?",
                (id_operador,),
            )
            supervisores = [{"id_usuario": r[0], "nome": normalize_text(r[1])} for r in cursor.fetchall()]
            if user.perfil == ROLE_SUPERVISOR and user.id_usuario not in {s["id_usuario"] for s in supervisores}:
                raise _http(status.HTTP_403_FORBIDDEN, "Você só pode monitorar operadores que supervisiona.")

            # Campos do contato
            canal = normalize_text(dados.get("canal"))
            tipo_atendimento = normalize_text(dados.get("tipo_atendimento"))
            if not canal or not tipo_atendimento:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o canal e o tipo de atendimento.")
            for tipo, valor in (("canal", canal), ("tipo_atendimento", tipo_atendimento)):
                if valor not in {i["valor"] for i in self.mon_list_catalogo(tipo, operacao)}:
                    raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Valor inválido para {tipo.replace('_', ' ')}.")
            try:
                data_contato = date.fromisoformat(normalize_text(dados.get("data_contato"))[:10])
            except ValueError:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe a data do contato.") from None
            if data_contato > date.today():
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "A data do contato não pode ser futura.")

            # Matriz/versão ativa => snapshot
            versao = self._mon_versao_ativa(cursor, operacao)
            config = versao["config"]
            respostas = {str(k): normalizar_resposta(v) for k, v in (dados.get("respostas") or {}).items()}
            faltando = criterios_sem_resposta(config, respostas)
            if faltando:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Responda todos os critérios ({len(faltando)} pendente(s)).")
            pilares, erros_pilar = validar_pilares(config, dados.get("pilares") or {})
            if erros_pilar:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, " ".join(erros_pilar))

            resultado = calcular_nota(config, respostas)
            motivo_ncg = normalize_text(dados.get("motivo_ncg"))
            if resultado["possui_ncg"] and not motivo_ncg:
                raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o motivo da NCG.")
            justificativa_anulacao = normalize_text(dados.get("justificativa_anulacao"))
            if resultado["anulada"] and not justificativa_anulacao:
                raise _http(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Menos de {resultado['min_blocos']} blocos avaliados: a monitoria será anulada. Informe a justificativa da anulação.",
                )
            nivel = faixa_da_nota(resultado["nota"], config.get("faixas"))["label"]

            codigo = self._mon_novo_codigo(cursor)
            cursor.execute(
                """
                INSERT INTO dbo.monitorias
                (codigo, operacao, operacao_nome, id_equipe, equipe_nome, turno, id_operador, operador_nome, operador_email,
                 supervisores_json, id_avaliador, avaliador_nome, id_matriz, id_versao, numero_versao, config_json, canal,
                 tipo_atendimento, data_contato, telefone, id_interacao, data_monitoria, respostas_json, pilares_json, nota, nivel,
                 possui_ncg, motivo_ncg, blocos_avaliados, blocos_nulos, anulada, justificativa_anulacao, observacao, sugestao_feedback)
                OUTPUT INSERTED.id_monitoria
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    codigo, operacao, operacao_nome, op[6], normalize_text(op[7]) or None, normalize_text(op[5]) or None,
                    id_operador, " ".join(x for x in (normalize_text(op[0]), normalize_text(op[1])) if x), normalize_text(op[2]),
                    _json(supervisores), user.id_usuario, normalize_text(user.nome), versao["id_matriz"], versao["id_versao"],
                    versao["numero"], _json(config), canal, tipo_atendimento, data_contato,
                    normalize_text(dados.get("telefone")) or None, normalize_text(dados.get("id_interacao")) or None,
                    _json(respostas), _json(pilares), float(resultado["nota"]), nivel,
                    1 if resultado["possui_ncg"] else 0, motivo_ncg or None, resultado["blocos_avaliados"], resultado["blocos_nulos"],
                    1 if resultado["anulada"] else 0, justificativa_anulacao or None,
                    normalize_text(dados.get("observacao")) or None, normalize_text(dados.get("sugestao_feedback")) or None,
                ),
            )
            id_monitoria = int(cursor.fetchone()[0])

            status_bloco = {b["id"]: b["status"] for b in resultado["blocos"]}
            for bloco in config["blocos"]:
                for criterio in bloco["criterios"]:
                    cursor.execute(
                        "INSERT INTO dbo.monitoria_respostas (id_monitoria, id_bloco, bloco_nome, bloco_status, id_criterio, pergunta, peso, resposta) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            id_monitoria, bloco["id"], bloco["nome"], status_bloco.get(bloco["id"], "AVALIADO"), criterio["id"],
                            criterio["texto"], float(criterio["peso"]), respostas[criterio["id"]],
                        ),
                    )
            for tipo, notas in pilares.items():
                for indicador, nota in notas.items():
                    cursor.execute(
                        "INSERT INTO dbo.monitoria_pilares (id_monitoria, tipo, indicador, nota) VALUES (?, ?, ?, ?)",
                        (id_monitoria, tipo, indicador, int(nota)),
                    )

            horas = self._mon_horas_sla(cursor)
            self._mon_registrar_passos(cursor, id_monitoria, wf.passos_criacao(resultado["anulada"]), user, horas_sla=horas)
            self.mon_log(
                cursor, user, acao="realizar_monitoria", operacao=operacao, entidade="monitoria", entidade_id=id_monitoria,
                posterior={"codigo": codigo, "nota": float(resultado["nota"]), "ncg": resultado["possui_ncg"], "anulada": resultado["anulada"],
                           "versao": versao["numero"]}, ip=ip,
            )
            if not resultado["anulada"]:
                self._mon_notificar_feedback_pendente(cursor, id_monitoria, codigo, operacao, supervisores, op)
            # Rascunho usado é descartado
            if dados.get("id_rascunho"):
                cursor.execute("DELETE FROM dbo.monitoria_rascunhos WHERE id_rascunho = ? AND id_avaliador = ?", (int(dados["id_rascunho"]), user.id_usuario))
            conn.commit()
            return {
                "success": True, "id_monitoria": id_monitoria, "codigo": codigo,
                "nota": float(resultado["nota"]), "nivel": nivel, "possui_ncg": resultado["possui_ncg"],
                "anulada": resultado["anulada"], "blocos": resultado["blocos"],
                "blocos_avaliados": resultado["blocos_avaliados"], "blocos_nulos": resultado["blocos_nulos"],
                "pilar_conhecimento": media_pilar(pilares["conhecimento"]), "pilar_encantamento": media_pilar(pilares["encantamento"]),
            }
        finally:
            conn.close()

    def _mon_notificar_feedback_pendente(self, cursor, id_monitoria: int, codigo: str, operacao: str, supervisores: list[dict], op_row) -> None:
        emails: set[str] = set()
        ids = [s["id_usuario"] for s in supervisores]
        if ids:
            marcadores = ",".join("?" for _ in ids)
            cursor.execute(f"SELECT email FROM dbo.usuarios WHERE id_usuario IN ({marcadores}) AND status = 'Ativo'", tuple(ids))
            emails |= {normalize_text(r[0]) for r in cursor.fetchall()}
        cursor.execute(
            """
            SELECT u.email FROM dbo.usuarios u JOIN dbo.usuarios_operacoes uo ON uo.id_usuario = u.id_usuario
            WHERE u.perfil_id = ? AND uo.operacao = ? AND u.status = 'Ativo'
            """,
            (ROLE_QUALIDADE, operacao),
        )
        emails |= {normalize_text(r[0]) for r in cursor.fetchall()}
        for email in sorted(e for e in emails if e):
            self._criar_notificacao(
                cursor,
                destinatario_usuario=email,
                titulo="Feedback pendente",
                mensagem=f"A monitoria #{codigo} de {normalize_text(op_row[0])} aguarda a aplicação do feedback (prazo de 72 horas).",
                categoria="monitoria_feedback_pendente",
                entidade="monitoria",
                entidade_id=str(id_monitoria),
            )

    # ------------------------------------------------------------------
    # Consulta (lista e detalhe) — escopo aplicado em SQL E em Python
    # ------------------------------------------------------------------
    def _mon_condicoes_escopo(self, user, alias: str = "m", *, exigir_feedback: bool = True) -> tuple[list[str], list] | None:
        """Condições SQL de escopo sobre uma tabela com `operacao` e `id_operador`
        (alias `m` = monitorias, `p` = planos de ação). `None` = nada pode ser visto."""
        condicoes: list[str] = []
        params: list = []
        permitidas = operacoes_permitidas(user.perfil, user.operacoes)
        if permitidas is not None:
            if not permitidas:
                return None
            condicoes.append(f"{alias}.operacao IN ({','.join('?' for _ in permitidas)})")
            params.extend(sorted(permitidas))
        if user.perfil == ROLE_OPERATOR:
            if user.id_usuario is None:
                return None
            condicoes.append(f"{alias}.id_operador = ?")
            params.append(user.id_usuario)
            if exigir_feedback:
                # Operador só vê depois do feedback aplicado (disponibilizada para manifestação).
                condicoes.append(f"EXISTS (SELECT 1 FROM dbo.monitoria_feedbacks f WHERE f.id_monitoria = {alias}.id_monitoria)")
        elif user.perfil == ROLE_SUPERVISOR:
            if user.id_usuario is None:
                return None
            condicoes.append(f"{alias}.id_operador IN (SELECT id_operador FROM dbo.usuarios_supervisores WHERE id_supervisor = ?)")
            params.append(user.id_usuario)
        return condicoes, params

    def mon_listar(self, user, filtros: dict | None = None, *, pagina: int = 1, por_pagina: int = 25) -> dict:
        filtros = filtros or {}
        escopo = self._mon_condicoes_escopo(user)
        if escopo is None:
            return {"itens": [], "total": 0, "pagina": 1, "por_pagina": por_pagina}
        condicoes, params = escopo
        codigo = normalize_text(filtros.get("codigo"))
        if codigo:
            condicoes.append("m.codigo = ?")
            params.append(codigo)
        for chave, coluna in (("operacao", "m.operacao"), ("status", "e.status"), ("canal", "m.canal")):
            valor = normalize_text(filtros.get(chave))
            if valor:
                condicoes.append(f"{coluna} = ?")
                params.append(valor)
        for chave, coluna in (("id_operador", "m.id_operador"), ("id_avaliador", "m.id_avaliador"), ("id_equipe", "m.id_equipe")):
            if filtros.get(chave):
                condicoes.append(f"{coluna} = ?")
                params.append(int(filtros[chave]))
        if normalize_text(filtros.get("operador")):
            condicoes.append("m.operador_nome LIKE ?")
            params.append(f"%{normalize_text(filtros['operador'])}%")
        if normalize_text(filtros.get("avaliador")):
            condicoes.append("m.avaliador_nome LIKE ?")
            params.append(f"%{normalize_text(filtros['avaliador'])}%")
        if normalize_text(filtros.get("data_inicio")):
            condicoes.append("CAST(m.data_monitoria AS DATE) >= ?")
            params.append(normalize_text(filtros["data_inicio"])[:10])
        if normalize_text(filtros.get("data_fim")):
            condicoes.append("CAST(m.data_monitoria AS DATE) <= ?")
            params.append(normalize_text(filtros["data_fim"])[:10])
        if filtros.get("somente_ncg"):
            condicoes.append("m.possui_ncg = 1")
        where = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
        pagina = max(1, int(pagina))
        por_pagina = self._clamp_limit(por_pagina, 25, 200)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            base = "FROM dbo.monitorias m JOIN dbo.monitoria_estado e ON e.id_monitoria = m.id_monitoria"
            cursor.execute(f"SELECT COUNT(*) {base} {where}", tuple(params))
            total = int(cursor.fetchone()[0])
            cursor.execute(
                f"""
                SELECT m.id_monitoria, m.codigo, m.operacao, m.operacao_nome, m.equipe_nome, m.turno, m.id_operador, m.operador_nome,
                       m.id_avaliador, m.avaliador_nome, m.canal, m.tipo_atendimento, m.data_contato, m.data_monitoria, m.nota, m.nivel,
                       m.possui_ncg, m.anulada, m.blocos_avaliados, e.status, e.resultado, e.sla_tipo, e.sla_inicio, e.sla_limite,
                       CASE WHEN EXISTS (SELECT 1 FROM dbo.monitoria_contestacoes c WHERE c.id_monitoria = m.id_monitoria) THEN 1 ELSE 0 END AS tem_contestacao
                {base} {where}
                ORDER BY m.data_monitoria DESC, m.id_monitoria DESC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
                """,
                (*params, (pagina - 1) * por_pagina, por_pagina),
            )
            linhas = rows_to_dicts(cursor, cursor.fetchall())
            agora = self._mon_agora(cursor)
            limiar = int(self._mon_config_valor(cursor, "limiar_alerta_pct", "75"))
            itens = [self._mon_item_lista(r, agora, limiar) for r in linhas]
            return {"itens": itens, "total": total, "pagina": pagina, "por_pagina": por_pagina}
        finally:
            conn.close()

    @staticmethod
    def _mon_item_lista(r: dict, agora: datetime, limiar: int) -> dict:
        sla = None
        if r.get("sla_limite") and r.get("sla_inicio"):
            sla = wf.estado_sla(r["sla_inicio"], r["sla_limite"], agora=agora, limiar_alerta_pct=limiar)
            sla["tipo"] = r.get("sla_tipo")
            sla["limite"] = _iso(r["sla_limite"])
        valida = not (bool(r["anulada"]) or normalize_text(r.get("resultado")) == wf.RESULTADO_ANULADA)
        return {
            "id_monitoria": r["id_monitoria"], "codigo": r["codigo"], "operacao": normalize_text(r["operacao"]),
            "operacao_nome": normalize_text(r["operacao_nome"]), "equipe_nome": normalize_text(r["equipe_nome"]),
            "turno": normalize_text(r["turno"]), "id_operador": r["id_operador"], "operador_nome": normalize_text(r["operador_nome"]),
            "id_avaliador": r["id_avaliador"], "avaliador_nome": normalize_text(r["avaliador_nome"]),
            "canal": normalize_text(r["canal"]), "tipo_atendimento": normalize_text(r["tipo_atendimento"]),
            "data_contato": _iso(r["data_contato"]), "data_monitoria": _iso(r["data_monitoria"]),
            "nota": float(r["nota"]), "nivel": normalize_text(r["nivel"]), "possui_ncg": bool(r["possui_ncg"]),
            "anulada": bool(r["anulada"]) or normalize_text(r.get("resultado")) == wf.RESULTADO_ANULADA,
            "valida": valida, "blocos_avaliados": r["blocos_avaliados"], "status": normalize_text(r["status"]),
            "status_rotulo": wf.ROTULOS_STATUS.get(normalize_text(r["status"]), normalize_text(r["status"])),
            "resultado": normalize_text(r.get("resultado")), "sla": sla, "tem_contestacao": bool(r.get("tem_contestacao")),
        }

    def mon_detalhe(self, user, ref: str, *, ip: str = "") -> dict:
        """Detalhe por ID interno ou código de 8 dígitos. Re-valida o escopo do
        registro (não confia na listagem)."""
        ref = normalize_text(ref)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM dbo.monitorias WHERE " + ("codigo = ?" if len(ref) == 8 and ref.isdigit() else "id_monitoria = ?"),
                (ref if len(ref) == 8 and ref.isdigit() else int(ref or 0),),
            )
            row = cursor.fetchone()
            if not row:
                raise _http(status.HTTP_404_NOT_FOUND, "Monitoria não encontrada.")
            m = rows_to_dicts(cursor, [row])[0]
            supervisionados = self.mon_operadores_supervisionados(user.id_usuario) if user.perfil == ROLE_SUPERVISOR and user.id_usuario else set()
            permitido = pode_ver_detalhe_monitoria(
                perfil=user.perfil, id_usuario=user.id_usuario, operacoes_usuario=user.operacoes,
                operacao=normalize_text(m["operacao"]), id_operador=int(m["id_operador"]), operadores_supervisionados=supervisionados,
            )
            id_m = int(m["id_monitoria"])
            cursor.execute("SELECT TOP 1 1 FROM dbo.monitoria_feedbacks WHERE id_monitoria = ?", (id_m,))
            tem_feedback = cursor.fetchone() is not None
            if permitido and user.perfil == ROLE_OPERATOR and not tem_feedback:
                permitido = False
            if not permitido:
                # 404 (não 403) para não revelar a existência do registro fora do escopo.
                self.mon_log(cursor, user, acao="acesso_negado_monitoria", operacao=normalize_text(m["operacao"]),
                             entidade="monitoria", entidade_id=id_m, resultado="FALHA", ip=ip)
                conn.commit()
                raise _http(status.HTTP_404_NOT_FOUND, "Monitoria não encontrada.")

            cursor.execute("SELECT status, resultado, sla_tipo, sla_inicio, sla_limite FROM dbo.monitoria_estado WHERE id_monitoria = ?", (id_m,))
            estado = rows_to_dicts(cursor, [cursor.fetchone()])[0]
            agora = self._mon_agora(cursor)
            limiar = int(self._mon_config_valor(cursor, "limiar_alerta_pct", "75"))
            sla = None
            if estado.get("sla_limite"):
                sla = wf.estado_sla(estado["sla_inicio"], estado["sla_limite"], agora=agora, limiar_alerta_pct=limiar)
                sla["tipo"] = estado["sla_tipo"]
                sla["limite"] = _iso(estado["sla_limite"])
            cursor.execute(
                "SELECT status_anterior, status_novo, usuario_nome, perfil, automatico, observacao, criado_em FROM dbo.monitoria_eventos "
                "WHERE id_monitoria = ? ORDER BY id_evento", (id_m,),
            )
            eventos = [
                {"de": normalize_text(e["status_anterior"]), "para": normalize_text(e["status_novo"]),
                 "para_rotulo": wf.ROTULOS_STATUS.get(normalize_text(e["status_novo"]), ""), "usuario": normalize_text(e["usuario_nome"]),
                 "perfil": normalize_text(e["perfil"]), "automatico": bool(e["automatico"]),
                 "observacao": normalize_text(e["observacao"]), "em": _iso(e["criado_em"])}
                for e in rows_to_dicts(cursor, cursor.fetchall())
            ]
            fluxo = self._mon_carregar_fluxo(cursor, id_m)
            config = _load(m["config_json"], {})
            resultado = calcular_nota(config, _load(m["respostas_json"], {}))
            respostas = _load(m["respostas_json"], {})
            return {
                "id_monitoria": id_m, "codigo": m["codigo"], "operacao": normalize_text(m["operacao"]),
                "operacao_nome": normalize_text(m["operacao_nome"]), "equipe_nome": normalize_text(m["equipe_nome"]),
                "turno": normalize_text(m["turno"]), "id_operador": m["id_operador"], "operador_nome": normalize_text(m["operador_nome"]),
                "supervisores": _load(m["supervisores_json"], []), "id_avaliador": m["id_avaliador"],
                "avaliador_nome": normalize_text(m["avaliador_nome"]), "numero_versao": m["numero_versao"], "id_versao": m["id_versao"],
                "canal": normalize_text(m["canal"]), "tipo_atendimento": normalize_text(m["tipo_atendimento"]),
                "data_contato": _iso(m["data_contato"]), "data_monitoria": _iso(m["data_monitoria"]),
                "telefone": normalize_text(m["telefone"]), "id_interacao": normalize_text(m["id_interacao"]),
                "nota": float(m["nota"]), "nivel": normalize_text(m["nivel"]),
                "faixa": faixa_da_nota(m["nota"], config.get("faixas")), "possui_ncg": bool(m["possui_ncg"]),
                "motivo_ncg": normalize_text(m["motivo_ncg"]), "anulada": bool(m["anulada"]),
                "justificativa_anulacao": normalize_text(m["justificativa_anulacao"]),
                "blocos": resultado["blocos"], "blocos_avaliados": m["blocos_avaliados"], "blocos_nulos": m["blocos_nulos"],
                "config": config, "respostas": respostas, "pilares": _load(m["pilares_json"], {}),
                "pilar_conhecimento": media_pilar(_load(m["pilares_json"], {}).get("conhecimento", {})),
                "pilar_encantamento": media_pilar(_load(m["pilares_json"], {}).get("encantamento", {})),
                "observacao": normalize_text(m["observacao"]), "sugestao_feedback": normalize_text(m["sugestao_feedback"]),
                "status": normalize_text(estado["status"]), "status_rotulo": wf.ROTULOS_STATUS.get(normalize_text(estado["status"]), ""),
                "resultado": normalize_text(estado.get("resultado")), "sla": sla, "eventos": eventos, **fluxo,
            }
        finally:
            conn.close()

    def _mon_carregar_fluxo(self, cursor, id_monitoria: int) -> dict:
        cursor.execute(
            "SELECT id_feedback, aplicado_por_nome, data_aplicacao, observacao, sugestao_original, complemento, prazo_sla, dentro_sla "
            "FROM dbo.monitoria_feedbacks WHERE id_monitoria = ? ORDER BY id_feedback", (id_monitoria,),
        )
        feedbacks = [
            {"id_feedback": r["id_feedback"], "aplicado_por": normalize_text(r["aplicado_por_nome"]), "em": _iso(r["data_aplicacao"]),
             "observacao": normalize_text(r["observacao"]), "sugestao_original": normalize_text(r["sugestao_original"]),
             "complemento": normalize_text(r["complemento"]), "dentro_sla": None if r["dentro_sla"] is None else bool(r["dentro_sla"])}
            for r in rows_to_dicts(cursor, cursor.fetchall())
        ]
        cursor.execute(
            "SELECT id_contestacao, data_contestacao, criterios_json, motivo, justificativa, dentro_sla FROM dbo.monitoria_contestacoes "
            "WHERE id_monitoria = ? ORDER BY id_contestacao", (id_monitoria,),
        )
        contestacoes = []
        for r in rows_to_dicts(cursor, cursor.fetchall()):
            idc = r["id_contestacao"]
            cursor.execute("SELECT autor_nome, texto, criado_em FROM dbo.monitoria_replicas WHERE id_contestacao = ? ORDER BY id_replica", (idc,))
            replicas = [{"autor": normalize_text(x[0]), "texto": normalize_text(x[1]), "em": _iso(x[2])} for x in cursor.fetchall()]
            cursor.execute("SELECT id_anexo, nome_original, mime, tamanho FROM dbo.monitoria_anexos WHERE id_contestacao = ?", (idc,))
            anexos = [{"id_anexo": x[0], "nome": normalize_text(x[1]), "mime": normalize_text(x[2]), "tamanho": x[3]} for x in cursor.fetchall()]
            cursor.execute(
                "SELECT supervisor_nome, resultado, observacao, automatico, data_reanalise, dentro_sla FROM dbo.monitoria_reanalises WHERE id_contestacao = ?",
                (idc,),
            )
            rean = cursor.fetchone()
            contestacoes.append(
                {"id_contestacao": idc, "em": _iso(r["data_contestacao"]), "criterios": _load(r["criterios_json"], []),
                 "motivo": normalize_text(r["motivo"]), "justificativa": normalize_text(r["justificativa"]), "replicas": replicas,
                 "anexos": anexos,
                 "reanalise": None if not rean else {
                     "supervisor": normalize_text(rean[0]), "resultado": normalize_text(rean[1]), "observacao": normalize_text(rean[2]),
                     "automatico": bool(rean[3]), "em": _iso(rean[4]), "dentro_sla": None if rean[5] is None else bool(rean[5])}}
            )
        return {"feedbacks": feedbacks, "contestacoes": contestacoes}

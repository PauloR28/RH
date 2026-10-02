"""WFM — gestão de escalas: lista (ativas, inativas), criar, duplicar para outra operação e excluir. Mixin do DatabaseRepository.

Uma "escala" é a escala principal da operação (chave = a própria operação) ou uma escala criada pelo usuário, que reaproveita
os tipos de escala (`wfm_tipos_escala`, chave virtual `OPERACAO::SLUG`). Ativar/desativar, nome, jornada e aprovadores ficam em
`wfm_operacao_config`/`wfm_aprovadores`/`wfm_tipos_escala` (ver wfm_aprovacao.py). Criar, duplicar, excluir e configurar exigem
`wfm.escala.criar` (Supervisor, Control Desk, Analista de TI); o Gestor só visualiza e aprova.
"""

from __future__ import annotations

from fastapi import HTTPException, status

from ..services import wfm_scope
from ..services.helpers import normalize_text
from .wfm_escala import _exigir_ano_mes


def _http(codigo: int, detalhe: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=detalhe)


class WfmGestaoRepositoryMixin:
    def _wfm_exigir_criar(self, user) -> None:
        if not (wfm_scope.pode_criar_escala(user.perfil) and user.has_permission("wfm.escala.criar")):
            raise _http(status.HTTP_403_FORBIDDEN, "Sem permissão para criar e gerir escalas.")

    def _wfm_operacoes_criacao(self, cursor, user) -> list[dict]:
        """Operações ativas do escopo do usuário: onde ele pode criar uma escala ou para onde pode duplicar uma."""
        cursor.execute("SELECT chave, nome FROM dbo.operacoes WHERE ativo = 1 ORDER BY nome")
        return [
            {"chave": normalize_text(r[0]), "nome": normalize_text(r[1])}
            for r in cursor.fetchall()
            if wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, normalize_text(r[0]))
        ]

    # ------------------------------------------------------------------
    # Lista
    # ------------------------------------------------------------------
    def wfm_gestao_escalas(self, user, ano_mes: str) -> dict:
        """Todas as escalas do escopo do usuário (inclusive inativas) com a situação do mês."""
        ano_mes = _exigir_ano_mes(ano_mes)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            operacoes = self._wfm_operacoes_criacao(cursor, user)
            cursor.execute("SELECT id_tipo, operacao_base, chave, nome, ativo FROM dbo.wfm_tipos_escala ORDER BY nome")
            tipos = [(int(r[0]), normalize_text(r[1]), normalize_text(r[2]), normalize_text(r[3]), bool(r[4])) for r in cursor.fetchall()]
            cursor.execute(
                "SELECT oc.operacao, oc.nome_escala, oc.ativa, c.codigo, oc.excluida FROM dbo.wfm_operacao_config oc "
                "LEFT JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato"
            )
            config = {normalize_text(r[0]): r for r in cursor.fetchall()}
            excluidas = {chave for chave, r in config.items() if r[4]}
            cursor.execute("SELECT operacao, COUNT(*) FROM dbo.wfm_aprovadores GROUP BY operacao")
            aprovadores = {normalize_text(r[0]): int(r[1]) for r in cursor.fetchall()}
            cursor.execute(
                "SELECT operacao, versao_publicada, fechada, aprov_estado, aprov_motivo FROM dbo.wfm_escalas WHERE ano_mes = ?", (ano_mes,)
            )
            cabs = {normalize_text(r[0]): r for r in cursor.fetchall()}
            cursor.execute("SELECT operacao, COUNT(DISTINCT id_operador) FROM dbo.wfm_escala_itens WHERE ano_mes = ? GROUP BY operacao", (ano_mes,))
            escalados = {normalize_text(r[0]): int(r[1]) for r in cursor.fetchall()}
        finally:
            conn.close()

        itens = []

        def montar(op: dict, chave: str, nome_base: str, ativa: bool, id_tipo: int | None) -> None:
            cfg = config.get(chave)
            cab = cabs.get(chave)
            itens.append({
                "chave": chave,
                "nome": (normalize_text(cfg[1]) if cfg and cfg[1] else "") or nome_base,
                "operacao": op["nome"],
                "operacao_base": op["chave"],
                "principal": id_tipo is None,
                "id_tipo": id_tipo,
                "ativa": ativa,
                "jornada": normalize_text(cfg[3]) if cfg and cfg[3] else None,
                "aprovadores": aprovadores.get(chave, 0),
                "escalados": escalados.get(chave, 0),
                "versao_publicada": int(cab[1]) if cab else 0,
                "fechada": bool(cab[2]) if cab else False,
                "aprovacao": (normalize_text(cab[3]) or "RASCUNHO") if cab else "RASCUNHO",
                "declinada": bool(cab and cab[4]),
            })

        for op in operacoes:
            if op["chave"].upper() not in wfm_scope.OPERACOES_SO_TIPOS and op["chave"] not in excluidas:
                cfg = config.get(op["chave"])
                montar(op, op["chave"], op["nome"], bool(cfg[2]) if cfg else True, None)
            for id_tipo, base, chave, nome, ativo in tipos:
                if base.upper() == op["chave"].upper() and chave not in excluidas:
                    montar(op, chave, nome, ativo, id_tipo)
        pode_criar = wfm_scope.pode_criar_escala(user.perfil) and user.has_permission("wfm.escala.criar")
        return {"itens": itens, "pode_criar": pode_criar, "operacoes_criacao": operacoes if pode_criar else []}

    # ------------------------------------------------------------------
    # Criar / excluir / duplicar
    # ------------------------------------------------------------------
    def wfm_criar_escala(self, user, operacao_base: str, nome: str, *, ip: str = "") -> dict:
        self._wfm_exigir_criar(user)
        if not normalize_text(operacao_base):
            raise _http(status.HTTP_400_BAD_REQUEST, "Escolha a operação da escala.")
        return self.wfm_save_tipo_escala(
            user, {"operacao_base": normalize_text(operacao_base), "nome": nome, "descricao": "", "ativo": True}, ip=ip, autorizado=True
        )

    def wfm_excluir_escala(self, user, chave: str, *, ip: str = "") -> dict:
        """Escala criada e sem histórico: apaga de vez. Escala principal da operação ou com histórico (versões publicadas,
        presenças, trocas): exclusão LÓGICA — some das telas e não aceita mais acesso, mas o histórico publicado é preservado."""
        self._wfm_exigir_criar(user)
        conn = self._connect()
        try:
            cursor = conn.cursor()
            chave = self._wfm_exigir_operacao(cursor, user, chave, escrita=True, permitir_inativa=True, escala=True)
            conn.commit()
            row = None
            if wfm_scope.eh_tipo_escala(chave):
                cursor.execute("SELECT id_tipo FROM dbo.wfm_tipos_escala WHERE chave = ?", (chave,))
                row = cursor.fetchone()
        finally:
            conn.close()
        if row:
            try:
                return self.wfm_excluir_tipo_escala(user, int(row[0]), ip=ip, autorizado=True)
            except HTTPException as exc:
                if exc.status_code != status.HTTP_409_CONFLICT:
                    raise
        conn = self._connect()
        try:
            cursor = conn.cursor()
            autor = normalize_text(user.nome) or user.username
            cursor.execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config WITH (UPDLOCK, HOLDLOCK) WHERE operacao = ?) "
                "INSERT INTO dbo.wfm_operacao_config (operacao, atualizado_por) VALUES (?, ?)",
                (chave, chave, autor),
            )
            cursor.execute("UPDATE dbo.wfm_operacao_config SET excluida = 1, ativa = 0, atualizado_por = ?, atualizado_em = GETDATE() WHERE operacao = ?", (autor, chave))
            if wfm_scope.eh_tipo_escala(chave):
                cursor.execute("UPDATE dbo.wfm_tipos_escala SET ativo = 0, atualizado_em = GETDATE() WHERE chave = ?", (chave,))
            self.wfm_audit(cursor, user, operacao=chave, acao="excluir_escala", entidade="tipo_escala", entidade_id=chave,
                           antes={"excluida": False}, depois={"excluida": True, "logica": True}, ip=ip)
            conn.commit()
            return {"success": True, "logica": True}
        finally:
            conn.close()

    def wfm_duplicar_escala(self, user, chave: str, operacao_destino: str, nome: str = "", *, ip: str = "") -> dict:
        """Cria uma escala nova (na mesma operação ou em outra do escopo do usuário) com o nome, aprovadores,
        jornada padrão e turnos de trabalho da original. Não copia colaboradores nem lançamentos."""
        self._wfm_exigir_criar(user)
        operacao_destino = normalize_text(operacao_destino)
        if not wfm_scope.pode_ver_operacao(user.perfil, user.operacoes, operacao_destino):
            raise _http(status.HTTP_403_FORBIDDEN, "A operação de destino está fora do seu escopo de acesso.")
        conn = self._connect()
        try:
            cursor = conn.cursor()
            origem = self._wfm_exigir_operacao(cursor, user, chave)
            conn.commit()
            nome_origem = self._wfm_nome_escala(cursor, origem)
            if not nome_origem:
                if wfm_scope.eh_tipo_escala(origem):
                    cursor.execute("SELECT nome FROM dbo.wfm_tipos_escala WHERE chave = ?", (origem,))
                else:
                    cursor.execute("SELECT nome FROM dbo.operacoes WHERE chave = ?", (origem,))
                linha = cursor.fetchone()
                nome_origem = normalize_text(linha[0]) if linha else origem
            aprov_origem = self._wfm_aprovadores(cursor, origem)
            cursor.execute("SELECT c.codigo FROM dbo.wfm_operacao_config oc JOIN dbo.wfm_contratos c ON c.id_contrato = oc.id_contrato WHERE oc.operacao = ?", (origem,))
            linha = cursor.fetchone()
            jornada_codigo = normalize_text(linha[0]) if linha else None
            cursor.execute(
                "SELECT t.codigo, t.nome, t.tipo, t.cor, t.entrada, t.saida, t.pausas_json, t.ativo, c.codigo FROM dbo.wfm_turnos t "
                "LEFT JOIN dbo.wfm_contratos c ON c.id_contrato = t.id_contrato WHERE t.operacao = ? AND t.tipo = 'TRABALHO' AND t.excluido = 0",
                (origem,),
            )
            turnos = cursor.fetchall()
        finally:
            conn.close()

        nome_novo = normalize_text(nome) or nome_origem
        if normalize_text(operacao_destino) == wfm_scope.operacao_base(origem) and not normalize_text(nome):
            nome_novo = f"{nome_origem} (cópia)"
        criada = self.wfm_save_tipo_escala(
            user, {"operacao_base": operacao_destino, "nome": nome_novo, "descricao": "", "ativo": True}, ip=ip, autorizado=True
        )
        destino = criada["chave"]

        conn = self._connect()
        try:
            cursor = conn.cursor()
            destino = self._wfm_exigir_operacao(cursor, user, destino, escrita=True)
            autor = normalize_text(user.nome) or user.username
            cursor.execute("SELECT id_contrato, codigo FROM dbo.wfm_contratos WHERE operacao = ?", (destino,))
            contratos_destino = {normalize_text(r[1]): int(r[0]) for r in cursor.fetchall()}
            copiados = 0
            for codigo, nome_t, tipo, cor, entrada, saida, pausas_json, ativo, contrato_codigo in turnos:
                cursor.execute("SELECT 1 FROM dbo.wfm_turnos WHERE operacao = ? AND codigo = ? AND excluido = 0", (destino, normalize_text(codigo)))
                if cursor.fetchone():
                    continue
                cursor.execute(
                    "INSERT INTO dbo.wfm_turnos (operacao, codigo, nome, tipo, cor, entrada, saida, pausas_json, ativo, id_contrato, atualizado_por) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (destino, normalize_text(codigo), nome_t, tipo, cor, entrada, saida, pausas_json, 1 if ativo else 0,
                     contratos_destino.get(normalize_text(contrato_codigo)) if contrato_codigo else None, autor),
                )
                copiados += 1
            validos = {c["id_usuario"] for c in self._wfm_candidatos_aprovador(cursor, destino)}
            usuarios = [u for u in aprov_origem["usuarios"] if u in validos]
            cursor.execute(
                "IF NOT EXISTS (SELECT 1 FROM dbo.wfm_operacao_config WHERE operacao = ?) INSERT INTO dbo.wfm_operacao_config (operacao, atualizado_por) VALUES (?, ?)",
                (destino, destino, autor),
            )
            cursor.execute(
                "UPDATE dbo.wfm_operacao_config SET nome_escala = ?, id_contrato = ?, atualizado_por = ?, atualizado_em = GETDATE() WHERE operacao = ?",
                (nome_novo, contratos_destino.get(jornada_codigo) if jornada_codigo else None, autor, destino),
            )
            for valor in aprov_origem["perfis"]:
                cursor.execute("INSERT INTO dbo.wfm_aprovadores (operacao, tipo, valor, atualizado_por) VALUES (?, 'PERFIL', ?, ?)", (destino, valor, autor))
            for valor in usuarios:
                cursor.execute("INSERT INTO dbo.wfm_aprovadores (operacao, tipo, valor, atualizado_por) VALUES (?, 'USUARIO', ?, ?)", (destino, str(valor), autor))
            self.wfm_audit(
                cursor, user, operacao=destino, acao="duplicar_escala", entidade="tipo_escala", entidade_id=destino,
                antes={"origem": origem}, depois={"destino": destino, "nome": nome_novo, "turnos": copiados, "aprovadores": len(aprov_origem["perfis"]) + len(usuarios)}, ip=ip,
            )
            conn.commit()
            return {"success": True, "chave": destino, "nome": nome_novo, "turnos_copiados": copiados}
        finally:
            conn.close()

from __future__ import annotations

import json

from fastapi import HTTPException, status

from ..services.helpers import normalize_text, rows_to_dicts
from .bootstrap import ensure_notifications_table, ensure_onboarding_tables, ensure_process_trainings_table


_TRILHA_COLUMNS = """
    id_trilha,
    nome,
    descricao,
    ativo,
    tipo_obrigatorio,
    categoria,
    id_operacao,
    modalidade,
    local_padrao,
    conteudo_json,
    texto_encerramento,
    pptx_path,
    pptx_nome_original,
    pptx_pdf_path,
    saiba_mais_treinamento_json,
    criado_por,
    criado_em,
    atualizado_em
"""

_TRILHA_ITEM_COLUMNS = """
    id_item,
    trilha_id,
    titulo,
    descricao,
    ordem,
    obrigatorio,
    tipo_conteudo,
    conteudo_url,
    subtitulo,
    texto_principal,
    video_path,
    video_nome_original,
    tabela_json,
    dica_texto,
    saiba_mais_itens_json,
    secoes_json,
    criado_em
"""

_ANEXO_COLUMNS = """
    id_anexo,
    trilha_id,
    trilha_item_id,
    nome_arquivo_original,
    nome_arquivo_armazenado,
    tipo_arquivo,
    caminho_arquivo,
    tamanho_bytes,
    permite_download,
    termo_aceito_em,
    termo_aceito_por,
    termo_versao,
    criado_por,
    criado_em
"""


def _dump_json(value) -> str | None:
    """Serializa um valor (dict/list vindo de um schema Pydantic .model_dump()) para
    NVARCHAR(MAX); None permanece None (não grava string "null")."""
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _parse_json(value: str | None):
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _decorate_trilha_item(item: dict) -> dict:
    """Converte as colunas JSON (tabela/saiba_mais) do módulo em objetos, para a
    API sempre devolver estruturas prontas em vez de string crua."""
    item["tabela"] = _parse_json(item.pop("tabela_json", None))
    item["saiba_mais"] = _parse_json(item.pop("saiba_mais_itens_json", None)) or []
    item["secoes"] = _parse_json(item.pop("secoes_json", None)) or []
    return item


def compute_training_call_escalation(atribuicoes: list[dict], *, agora) -> dict:
    """Regra pura (sem I/O) do escalonamento por chamada pendente (plano técnico
    §6 / prompt §3.5) — extraída de `run_training_call_escalation` para ser
    testável sem banco de dados, no mesmo espírito de
    `ProcessRepositoryMixin.run_scheduled_inactivity_reminders`.

    Recebe as atribuições candidatas (status 'em_andamento' ou
    'pendente_chamada', com data_prevista definida e presença ainda não
    registrada) e devolve o que fazer com cada uma:
    - `promover_pendente`: ids que devem virar status='pendente_chamada'
      (estavam 'em_andamento' e a data prevista já passou).
    - `notificar_3_dias`: linhas que completaram 3+ dias pendentes e ainda não
      foram notificadas (`notificado_pendente_em` é None).
    - `encerrar_5_dias`: linhas que completaram 5+ dias pendentes — viram
      'encerrado_sem_chamada' e geram uma notificação própria, mesmo que já
      tenham sido notificadas aos 3 dias.
    """
    from datetime import timedelta

    promover_pendente: list[int] = []
    notificar_3_dias: list[dict] = []
    encerrar_5_dias: list[dict] = []

    limite_3_dias = agora - timedelta(days=3)
    limite_5_dias = agora - timedelta(days=5)

    for linha in atribuicoes:
        if linha.get("presenca"):
            continue
        data_prevista = linha.get("data_prevista")
        if not data_prevista:
            continue
        status_atual = linha.get("status")

        vira_pendente = status_atual == "em_andamento" and data_prevista < agora
        ja_pendente = status_atual == "pendente_chamada"
        if not vira_pendente and not ja_pendente:
            continue

        if vira_pendente:
            promover_pendente.append(int(linha["id_onboarding"]))

        if data_prevista <= limite_5_dias:
            encerrar_5_dias.append(linha)
        elif data_prevista <= limite_3_dias and not linha.get("notificado_pendente_em"):
            notificar_3_dias.append(linha)

    return {
        "promover_pendente": promover_pendente,
        "notificar_3_dias": notificar_3_dias,
        "encerrar_5_dias": encerrar_5_dias,
    }


def _decorate_trilha(trilha: dict) -> dict:
    trilha["saiba_mais_treinamento"] = _parse_json(trilha.pop("saiba_mais_treinamento_json", None)) or {
        "texto_breve": "",
        "links": [],
    }
    return trilha

_ONBOARDING_ITEM_COLUMNS = """
    id_onboarding_item,
    onboarding_candidato_id,
    trilha_item_id,
    titulo,
    descricao,
    ordem,
    obrigatorio,
    concluido,
    concluido_em,
    concluido_por
"""

_ONBOARDING_COLUMNS = """
    id_onboarding,
    id_registro,
    trilha_id,
    iniciado_por,
    iniciado_em,
    data_prevista,
    local,
    ministrante,
    status,
    acesso_plataforma,
    metodo_login,
    presenca
"""

_PROCESS_TRAINING_COLUMNS = """
    pt.id_processo_treinamento,
    pt.id_processo,
    pt.trilha_id,
    pt.vagas_totais,
    pt.vagas_liberadas,
    pt.criado_em,
    pt.atualizado_em
"""

CATEGORIAS_TREINAMENTO = ("LGPD", "Segurança da Informação", "Tecnologia", "Operações", "Onboarding", "Produto", "Outro")
MODALIDADES_TREINAMENTO = ("presencial", "virtual", "hibrido")
# Prompt.txt (rodada 06/set/2026): "pendente_chamada"/"encerrado_sem_chamada" são
# os 2 estados novos do escalonamento por chamada pendente (plano técnico §6) —
# aplicados pelo job agendado, nunca escolhidos manualmente na edição.
STATUS_ATRIBUICAO_TREINAMENTO = (
    "em_andamento",
    "concluido",
    "cancelado",
    "aplicado",
    "pendente_chamada",
    "encerrado_sem_chamada",
)
METODOS_LOGIN_TREINAMENTO = ("microsoft", "telefone", "email", "nome")
# Prompt.txt §3.6: "a gestão (Gestor/ADM...)" é notificada nos eventos de
# escalonamento — papéis exatos em rbac.py (ROLE_MANAGER="gestor", ROLE_RH="rh",
# ROLE_ADMIN="administrador").
_PAPEIS_GESTAO_TREINAMENTO = ("rh", "gestor", "administrador")


class OnboardingRepositoryMixin:
    """Trilhas de onboarding (checklist configurável) e progresso por candidato."""

    # ------------------------------------------------------------------
    # Trilhas (administração)
    # ------------------------------------------------------------------
    def list_onboarding_trilhas(self, *, categoria: str | None = None, id_operacao: int | None = None) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            condicoes = []
            parametros: list = []
            categoria_normalizada = normalize_text(categoria)
            if categoria_normalizada:
                condicoes.append("categoria = ?")
                parametros.append(categoria_normalizada)
            if id_operacao:
                condicoes.append("id_operacao = ?")
                parametros.append(int(id_operacao))
            filtro = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
            cursor.execute(
                f"""
                SELECT {_TRILHA_COLUMNS}
                FROM trilhas_onboarding
                {filtro}
                ORDER BY ativo DESC, criado_em DESC, id_trilha DESC
                """,
                tuple(parametros),
            )
            trilhas = rows_to_dicts(cursor, cursor.fetchall())

            for trilha in trilhas:
                cursor.execute(
                    f"""
                    SELECT {_TRILHA_ITEM_COLUMNS}
                    FROM trilhas_onboarding_itens
                    WHERE trilha_id = ?
                    ORDER BY ordem ASC, id_item ASC
                    """,
                    (int(trilha["id_trilha"]),),
                )
                trilha["itens"] = [_decorate_trilha_item(item) for item in rows_to_dicts(cursor, cursor.fetchall())]
                _decorate_trilha(trilha)
            return trilhas
        finally:
            conn.close()

    def get_onboarding_trilha(self, id_trilha: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute(
                f"""
                SELECT {_TRILHA_COLUMNS}
                FROM trilhas_onboarding
                WHERE id_trilha = ?
                """,
                (int(id_trilha or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trilha de onboarding não encontrada.")
            trilha = rows[0]

            cursor.execute(
                f"""
                SELECT {_TRILHA_ITEM_COLUMNS}
                FROM trilhas_onboarding_itens
                WHERE trilha_id = ?
                ORDER BY ordem ASC, id_item ASC
                """,
                (int(id_trilha or 0),),
            )
            trilha["itens"] = [_decorate_trilha_item(item) for item in rows_to_dicts(cursor, cursor.fetchall())]
            _decorate_trilha(trilha)

            cursor.execute(
                f"""
                SELECT {_ANEXO_COLUMNS}
                FROM trilhas_onboarding_anexos
                WHERE trilha_id = ?
                ORDER BY criado_em DESC, id_anexo DESC
                """,
                (int(id_trilha or 0),),
            )
            trilha["anexos"] = rows_to_dicts(cursor, cursor.fetchall())
            return trilha
        finally:
            conn.close()

    @staticmethod
    def _validate_trilha_input(data: dict) -> tuple[str, str, bool, bool, str, "int | None", str, str, str, str, "str | None", list[dict]]:
        nome = normalize_text(data.get("nome"))
        if not nome:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o nome da trilha.")
        descricao = normalize_text(data.get("descricao"))
        ativo = bool(data.get("ativo", True))
        tipo_obrigatorio = bool(data.get("tipo_obrigatorio", False))
        categoria = normalize_text(data.get("categoria")) or "Onboarding"
        id_operacao_raw = data.get("id_operacao")
        id_operacao = int(id_operacao_raw) if id_operacao_raw else None
        modalidade = normalize_text(data.get("modalidade"))
        local_padrao = normalize_text(data.get("local_padrao"))
        conteudo_json = normalize_text(data.get("conteudo_json"))
        texto_encerramento = normalize_text(data.get("texto_encerramento"))
        saiba_mais_treinamento_json = _dump_json(data.get("saiba_mais_treinamento"))
        itens_raw = data.get("itens") or []
        itens: list[dict] = []
        for index, item in enumerate(itens_raw):
            titulo = normalize_text(item.get("titulo") if isinstance(item, dict) else None)
            if not titulo:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Informe o título de todos os itens da trilha.")
            id_item_raw = item.get("id_item")
            itens.append(
                {
                    "id_item": int(id_item_raw) if id_item_raw else None,
                    "titulo": titulo,
                    "descricao": normalize_text(item.get("descricao")),
                    "ordem": int(item.get("ordem") if item.get("ordem") is not None else index),
                    "obrigatorio": bool(item.get("obrigatorio", True)),
                    "tipo_conteudo": normalize_text(item.get("tipo_conteudo")),
                    "conteudo_url": normalize_text(item.get("conteudo_url")),
                    "subtitulo": normalize_text(item.get("subtitulo")),
                    "texto_principal": normalize_text(item.get("texto_principal")),
                    "dica_texto": normalize_text(item.get("dica_texto")),
                    "tabela_json": _dump_json(item.get("tabela")),
                    "saiba_mais_itens_json": _dump_json(item.get("saiba_mais")),
                    "secoes_json": _dump_json(item.get("secoes")),
                }
            )
        return (
            nome,
            descricao,
            ativo,
            tipo_obrigatorio,
            categoria,
            id_operacao,
            modalidade,
            local_padrao,
            conteudo_json,
            texto_encerramento,
            saiba_mais_treinamento_json,
            itens,
        )

    def create_onboarding_trilha(self, data: dict, *, actor: str = "") -> dict:
        (
            nome,
            descricao,
            ativo,
            tipo_obrigatorio,
            categoria,
            id_operacao,
            modalidade,
            local_padrao,
            conteudo_json,
            texto_encerramento,
            saiba_mais_treinamento_json,
            itens,
        ) = self._validate_trilha_input(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            cursor.execute(
                """
                INSERT INTO trilhas_onboarding
                (nome, descricao, ativo, tipo_obrigatorio, categoria, id_operacao, modalidade, local_padrao,
                 conteudo_json, texto_encerramento, saiba_mais_treinamento_json, criado_por, criado_em, atualizado_em)
                OUTPUT INSERTED.id_trilha
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
                """,
                (
                    nome,
                    descricao,
                    1 if ativo else 0,
                    1 if tipo_obrigatorio else 0,
                    categoria,
                    id_operacao,
                    modalidade,
                    local_padrao,
                    conteudo_json,
                    texto_encerramento,
                    saiba_mais_treinamento_json,
                    normalize_text(actor),
                ),
            )
            inserted = cursor.fetchone()
            id_trilha = int(inserted[0] or 0)

            for item in itens:
                cursor.execute(
                    """
                    INSERT INTO trilhas_onboarding_itens
                    (trilha_id, titulo, descricao, ordem, obrigatorio, tipo_conteudo, conteudo_url,
                     subtitulo, texto_principal, dica_texto, tabela_json, saiba_mais_itens_json, secoes_json, criado_em)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
                    """,
                    (
                        id_trilha,
                        item["titulo"],
                        item["descricao"],
                        item["ordem"],
                        1 if item["obrigatorio"] else 0,
                        item["tipo_conteudo"],
                        item["conteudo_url"],
                        item["subtitulo"],
                        item["texto_principal"],
                        item["dica_texto"],
                        item["tabela_json"],
                        item["saiba_mais_itens_json"],
                        item["secoes_json"],
                    ),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_onboarding_trilha(id_trilha)

    def update_onboarding_trilha(self, id_trilha: int, data: dict, *, actor: str = "") -> dict:
        (
            nome,
            descricao,
            ativo,
            tipo_obrigatorio,
            categoria,
            id_operacao,
            modalidade,
            local_padrao,
            conteudo_json,
            texto_encerramento,
            saiba_mais_treinamento_json,
            itens,
        ) = self._validate_trilha_input(data)

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            cursor.execute("SELECT id_trilha FROM trilhas_onboarding WHERE id_trilha = ?", (int(id_trilha or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trilha de onboarding não encontrada.")

            cursor.execute(
                """
                UPDATE trilhas_onboarding
                SET nome = ?, descricao = ?, ativo = ?, tipo_obrigatorio = ?, categoria = ?, id_operacao = ?,
                    modalidade = ?, local_padrao = ?, conteudo_json = ?, texto_encerramento = ?,
                    saiba_mais_treinamento_json = ?, atualizado_em = GETDATE()
                WHERE id_trilha = ?
                """,
                (
                    nome,
                    descricao,
                    1 if ativo else 0,
                    1 if tipo_obrigatorio else 0,
                    categoria,
                    id_operacao,
                    modalidade,
                    local_padrao,
                    conteudo_json,
                    texto_encerramento,
                    saiba_mais_treinamento_json,
                    int(id_trilha or 0),
                ),
            )

            # Itens da trilha: upsert por id_item (em vez de apagar e recriar)
            # para preservar video_path/video_nome_original — colunas setadas só
            # pelo endpoint de upload dedicado, não por este payload de edição —
            # e os anexos de módulo (trilha_item_id), que referenciam o id_item
            # de forma persistente. Onboardings já iniciados usam um snapshot
            # próprio (onboarding_candidatos_itens) e não são afetados por isso.
            cursor.execute("SELECT id_item FROM trilhas_onboarding_itens WHERE trilha_id = ?", (int(id_trilha or 0),))
            ids_existentes = {int(row[0]) for row in cursor.fetchall()}
            ids_mantidos: set[int] = set()

            for item in itens:
                id_item = item.get("id_item")
                if id_item and id_item in ids_existentes:
                    cursor.execute(
                        """
                        UPDATE trilhas_onboarding_itens
                        SET titulo = ?, descricao = ?, ordem = ?, obrigatorio = ?, tipo_conteudo = ?,
                            conteudo_url = ?, subtitulo = ?, texto_principal = ?, dica_texto = ?,
                            tabela_json = ?, saiba_mais_itens_json = ?, secoes_json = ?
                        WHERE id_item = ? AND trilha_id = ?
                        """,
                        (
                            item["titulo"],
                            item["descricao"],
                            item["ordem"],
                            1 if item["obrigatorio"] else 0,
                            item["tipo_conteudo"],
                            item["conteudo_url"],
                            item["subtitulo"],
                            item["texto_principal"],
                            item["dica_texto"],
                            item["tabela_json"],
                            item["saiba_mais_itens_json"],
                            item["secoes_json"],
                            id_item,
                            int(id_trilha or 0),
                        ),
                    )
                    ids_mantidos.add(id_item)
                else:
                    cursor.execute(
                        """
                        INSERT INTO trilhas_onboarding_itens
                        (trilha_id, titulo, descricao, ordem, obrigatorio, tipo_conteudo, conteudo_url,
                         subtitulo, texto_principal, dica_texto, tabela_json, saiba_mais_itens_json, secoes_json, criado_em)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
                        """,
                        (
                            int(id_trilha or 0),
                            item["titulo"],
                            item["descricao"],
                            item["ordem"],
                            1 if item["obrigatorio"] else 0,
                            item["tipo_conteudo"],
                            item["conteudo_url"],
                            item["subtitulo"],
                            item["texto_principal"],
                            item["dica_texto"],
                            item["tabela_json"],
                            item["saiba_mais_itens_json"],
                            item["secoes_json"],
                        ),
                    )

            ids_removidos = ids_existentes - ids_mantidos
            for id_item_removido in ids_removidos:
                cursor.execute("DELETE FROM trilhas_onboarding_anexos WHERE trilha_item_id = ?", (id_item_removido,))
                cursor.execute("DELETE FROM trilhas_onboarding_itens WHERE id_item = ?", (id_item_removido,))
            conn.commit()
        finally:
            conn.close()

        return self.get_onboarding_trilha(id_trilha)

    def delete_onboarding_trilha(self, id_trilha: int) -> dict:
        """Exclui um treinamento (trilha) cadastrado — permanente, mas só
        quando não há histórico vinculado (Correcoes.txt, item Central de
        Treinamentos: "quando um treinamento é criado, é permanente, a menos
        que ele seja excluído")."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            cursor.execute("SELECT id_trilha FROM trilhas_onboarding WHERE id_trilha = ?", (int(id_trilha or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treinamento não encontrado.")

            cursor.execute("SELECT COUNT(*) FROM onboarding_candidatos WHERE trilha_id = ?", (int(id_trilha or 0),))
            total_atribuicoes = int((cursor.fetchone() or [0])[0] or 0)
            cursor.execute("SELECT COUNT(*) FROM processos_treinamentos WHERE trilha_id = ?", (int(id_trilha or 0),))
            total_processos = int((cursor.fetchone() or [0])[0] or 0)
            if total_atribuicoes or total_processos:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Não é possível excluir: este treinamento tem colaboradores atribuídos ou está "
                        "vinculado a processos seletivos."
                    ),
                )

            cursor.execute("DELETE FROM trilhas_onboarding_anexos WHERE trilha_id = ?", (int(id_trilha or 0),))
            cursor.execute("DELETE FROM trilhas_onboarding_itens WHERE trilha_id = ?", (int(id_trilha or 0),))
            cursor.execute("DELETE FROM trilhas_onboarding WHERE id_trilha = ?", (int(id_trilha or 0),))
            conn.commit()
        finally:
            conn.close()

        return {"success": True}

    # ------------------------------------------------------------------
    # Instância de onboarding por candidato
    # ------------------------------------------------------------------
    def _get_candidate_process_row(self, cursor, id_registro: int) -> dict:
        cursor.execute(
            """
            SELECT id_registro, id_processo, id_processo_ref, id_teste, nome_candidato, vaga, status_candidato
            FROM candidatos_processos
            WHERE id_registro = ?
            """,
            (int(id_registro or 0),),
        )
        rows = rows_to_dicts(cursor, cursor.fetchall())
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidato não encontrado no processo informado.")
        return rows[0]

    def start_onboarding(
        self,
        id_registro: int,
        trilha_id: int,
        *,
        actor: str = "",
        data_prevista=None,
        local: str = "",
        ministrante: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            candidato = self._get_candidate_process_row(cursor, id_registro)

            cursor.execute(
                f"""
                SELECT {_TRILHA_COLUMNS}
                FROM trilhas_onboarding
                WHERE id_trilha = ?
                """,
                (int(trilha_id or 0),),
            )
            trilha_rows = rows_to_dicts(cursor, cursor.fetchall())
            if not trilha_rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trilha de onboarding não encontrada.")

            cursor.execute(
                f"""
                SELECT {_TRILHA_ITEM_COLUMNS}
                FROM trilhas_onboarding_itens
                WHERE trilha_id = ?
                ORDER BY ordem ASC, id_item ASC
                """,
                (int(trilha_id or 0),),
            )
            trilha_itens = rows_to_dicts(cursor, cursor.fetchall())

            cursor.execute(
                """
                INSERT INTO onboarding_candidatos
                (id_registro, trilha_id, iniciado_por, iniciado_em, data_prevista, local, ministrante, status)
                OUTPUT INSERTED.id_onboarding
                VALUES (?, ?, ?, GETDATE(), ?, ?, ?, 'em_andamento')
                """,
                (
                    int(candidato["id_registro"]),
                    int(trilha_id or 0),
                    normalize_text(actor),
                    data_prevista,
                    normalize_text(local),
                    normalize_text(ministrante),
                ),
            )
            inserted = cursor.fetchone()
            id_onboarding = int(inserted[0] or 0)

            # Snapshot dos itens da trilha no momento da criação, para que
            # futuras edições na trilha não afetem onboardings em andamento.
            for item in trilha_itens:
                cursor.execute(
                    """
                    INSERT INTO onboarding_candidatos_itens
                    (onboarding_candidato_id, trilha_item_id, titulo, descricao, ordem, obrigatorio, concluido)
                    VALUES (?, ?, ?, ?, ?, ?, 0)
                    """,
                    (
                        id_onboarding,
                        int(item["id_item"]),
                        item["titulo"],
                        item.get("descricao"),
                        int(item.get("ordem") or 0),
                        1 if item.get("obrigatorio") else 0,
                    ),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_onboarding_progress(id_registro)

    def get_onboarding_progress(self, id_registro: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            candidato = self._get_candidate_process_row(cursor, id_registro)

            cursor.execute(
                f"""
                SELECT TOP 1 {_ONBOARDING_COLUMNS}
                FROM onboarding_candidatos
                WHERE id_registro = ?
                ORDER BY iniciado_em DESC, id_onboarding DESC
                """,
                (int(candidato["id_registro"]),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                return {
                    "iniciado": False,
                    "candidato": candidato,
                    "onboarding": None,
                    "itens": [],
                    "total_itens": 0,
                    "itens_concluidos": 0,
                    "percentual_concluido": 0,
                }

            onboarding = rows[0]
            cursor.execute(
                f"""
                SELECT {_ONBOARDING_ITEM_COLUMNS}
                FROM onboarding_candidatos_itens
                WHERE onboarding_candidato_id = ?
                ORDER BY ordem ASC, id_onboarding_item ASC
                """,
                (int(onboarding["id_onboarding"]),),
            )
            itens = rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

        total_itens = len(itens)
        itens_concluidos = sum(1 for item in itens if item.get("concluido"))
        percentual = round((itens_concluidos / total_itens) * 100) if total_itens else 0

        return {
            "iniciado": True,
            "candidato": candidato,
            "onboarding": onboarding,
            "itens": itens,
            "total_itens": total_itens,
            "itens_concluidos": itens_concluidos,
            "percentual_concluido": percentual,
        }

    def set_onboarding_item_status(self, id_onboarding_item: int, concluido: bool, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            cursor.execute(
                """
                SELECT oi.id_onboarding_item, oc.id_registro
                FROM onboarding_candidatos_itens oi
                JOIN onboarding_candidatos oc ON oc.id_onboarding = oi.onboarding_candidato_id
                WHERE oi.id_onboarding_item = ?
                """,
                (int(id_onboarding_item or 0),),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item de onboarding não encontrado.")
            id_registro = int(row[1])

            cursor.execute(
                """
                UPDATE onboarding_candidatos_itens
                SET concluido = ?, concluido_em = ?, concluido_por = ?
                WHERE id_onboarding_item = ?
                """,
                (
                    1 if concluido else 0,
                    None if not concluido else None,
                    normalize_text(actor) if concluido else None,
                    int(id_onboarding_item or 0),
                ),
            )
            # concluido_em precisa de GETDATE() quando concluído; ajusta em uma
            # segunda instrução para manter a primeira portátil entre drivers.
            if concluido:
                cursor.execute(
                    """
                    UPDATE onboarding_candidatos_itens
                    SET concluido_em = GETDATE()
                    WHERE id_onboarding_item = ?
                    """,
                    (int(id_onboarding_item or 0),),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_onboarding_progress(id_registro)

    # ------------------------------------------------------------------
    # Visão de gestão (RH): quem está em treinamento, de qual trilha,
    # quando e onde — ver respostas.txt, item "Centro de Treinamentos".
    # ------------------------------------------------------------------
    def list_onboarding_assignments(self, *, status_filtro: str | None = None) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            condicoes = []
            parametros: list = []
            status_normalizado = normalize_text(status_filtro)
            if status_normalizado:
                condicoes.append("oc.status = ?")
                parametros.append(status_normalizado)
            filtro = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""

            cursor.execute(
                f"""
                SELECT
                    oc.id_onboarding,
                    oc.id_registro,
                    oc.trilha_id,
                    oc.iniciado_por,
                    oc.iniciado_em,
                    oc.data_prevista,
                    oc.local,
                    oc.ministrante,
                    oc.status,
                    cp.nome_candidato,
                    cp.vaga,
                    t.nome AS trilha_nome,
                    t.categoria AS trilha_categoria,
                    t.modalidade AS trilha_modalidade
                FROM onboarding_candidatos oc
                JOIN candidatos_processos cp ON cp.id_registro = oc.id_registro
                JOIN trilhas_onboarding t ON t.id_trilha = oc.trilha_id
                {filtro}
                ORDER BY oc.iniciado_em DESC, oc.id_onboarding DESC
                """,
                tuple(parametros),
            )
            atribuicoes = rows_to_dicts(cursor, cursor.fetchall())

            for atribuicao in atribuicoes:
                cursor.execute(
                    """
                    SELECT COUNT(*) AS total, SUM(CASE WHEN concluido = 1 THEN 1 ELSE 0 END) AS concluidos
                    FROM onboarding_candidatos_itens
                    WHERE onboarding_candidato_id = ?
                    """,
                    (int(atribuicao["id_onboarding"]),),
                )
                contagem = rows_to_dicts(cursor, cursor.fetchall())[0]
                total = int(contagem.get("total") or 0)
                concluidos = int(contagem.get("concluidos") or 0)
                atribuicao["total_itens"] = total
                atribuicao["itens_concluidos"] = concluidos
                atribuicao["percentual_concluido"] = round((concluidos / total) * 100) if total else 0

            return atribuicoes
        finally:
            conn.close()

    def update_onboarding_assignment(self, id_onboarding: int, data: dict, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            ensure_notifications_table(cursor)

            cursor.execute(
                """
                SELECT oc.id_registro, oc.status, oc.trilha_id, t.nome AS trilha_nome, cp.nome_candidato
                FROM onboarding_candidatos oc
                JOIN trilhas_onboarding t ON t.id_trilha = oc.trilha_id
                JOIN candidatos_processos cp ON cp.id_registro = oc.id_registro
                WHERE oc.id_onboarding = ?
                """,
                (int(id_onboarding or 0),),
            )
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treinamento do colaborador não encontrado.")
            atual = rows[0]
            id_registro = int(atual["id_registro"])

            status_valor = normalize_text(data.get("status")) or "em_andamento"
            if status_valor not in STATUS_ATRIBUICAO_TREINAMENTO:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status de treinamento inválido.")

            metodo_login = normalize_text(data.get("metodo_login"))
            if metodo_login and metodo_login not in METODOS_LOGIN_TREINAMENTO:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Método de login inválido.")

            cursor.execute(
                """
                UPDATE onboarding_candidatos
                SET data_prevista = ?, local = ?, ministrante = ?, status = ?,
                    acesso_plataforma = ?, metodo_login = ?
                WHERE id_onboarding = ?
                """,
                (
                    data.get("data_prevista"),
                    normalize_text(data.get("local")),
                    normalize_text(data.get("ministrante")),
                    status_valor,
                    1 if data.get("acesso_plataforma") else 0,
                    metodo_login or None,
                    int(id_onboarding or 0),
                ),
            )

            # Prompt.txt §3.6: notifica a gestão quando um treinamento é concluído.
            if status_valor == "concluido" and atual["status"] != "concluido":
                for papel in _PAPEIS_GESTAO_TREINAMENTO:
                    self._criar_notificacao(
                        cursor,
                        destinatario_papel=papel,
                        titulo="Treinamento concluído",
                        mensagem=(
                            f"O treinamento \"{atual['trilha_nome']}\" de {atual.get('nome_candidato') or 'um colaborador'} "
                            "foi marcado como concluído."
                        ),
                        categoria="treinamento_concluido",
                        entidade="onboarding_candidato",
                        entidade_id=str(id_onboarding),
                    )
            conn.commit()
        finally:
            conn.close()

        return self.get_onboarding_progress(id_registro)

    def delete_onboarding_assignment(self, id_onboarding: int, *, actor: str = "") -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)

            cursor.execute(
                "SELECT id_onboarding FROM onboarding_candidatos WHERE id_onboarding = ?",
                (int(id_onboarding or 0),),
            )
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treinamento do colaborador não encontrado.")

            cursor.execute(
                "DELETE FROM onboarding_candidatos_itens WHERE onboarding_candidato_id = ?",
                (int(id_onboarding or 0),),
            )
            cursor.execute(
                "DELETE FROM onboarding_candidatos WHERE id_onboarding = ?",
                (int(id_onboarding or 0),),
            )
            conn.commit()
        finally:
            conn.close()

        return {"success": True}

    def save_onboarding_attendance(self, presencas: list[dict], *, actor: str = "") -> dict:
        """Salva a lista de presença de um ou mais treinamentos agendados.

        Ao salvar, cada linha ganha a tag APLICADO (status='aplicado') — ver
        Correcoes.txt, item Central de Treinamentos."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            ensure_notifications_table(cursor)

            atualizados: list[int] = []
            for item in presencas or []:
                id_onboarding = int(item.get("id_onboarding") or 0)
                if not id_onboarding:
                    continue
                presente = bool(item.get("presente"))
                cursor.execute(
                    """
                    UPDATE onboarding_candidatos
                    SET presenca = ?, status = 'aplicado'
                    WHERE id_onboarding = ?
                    """,
                    ("presente" if presente else "falta", id_onboarding),
                )
                atualizados.append(id_onboarding)

            # Prompt.txt §3.6: notifica a gestão quando um treinamento é aplicado
            # (chamada salva com sucesso).
            if atualizados:
                placeholders = ", ".join("?" for _ in atualizados)
                cursor.execute(
                    f"""
                    SELECT oc.id_onboarding, t.nome AS trilha_nome
                    FROM onboarding_candidatos oc
                    JOIN trilhas_onboarding t ON t.id_trilha = oc.trilha_id
                    WHERE oc.id_onboarding IN ({placeholders})
                    """,
                    tuple(atualizados),
                )
                trilhas_por_atribuicao = {int(row[0]): row[1] for row in cursor.fetchall()}
                nomes_trilhas_notificadas: set[str] = set()
                for id_onboarding in atualizados:
                    nome_trilha = trilhas_por_atribuicao.get(id_onboarding)
                    if not nome_trilha or nome_trilha in nomes_trilhas_notificadas:
                        continue
                    nomes_trilhas_notificadas.add(nome_trilha)
                    for papel in _PAPEIS_GESTAO_TREINAMENTO:
                        self._criar_notificacao(
                            cursor,
                            destinatario_papel=papel,
                            titulo="Treinamento aplicado",
                            mensagem=f"A chamada do treinamento \"{nome_trilha}\" foi salva com sucesso.",
                            categoria="treinamento_aplicado",
                            entidade="trilha_onboarding",
                            entidade_id=str(id_onboarding),
                        )
            conn.commit()
        finally:
            conn.close()

        return {"success": True, "atualizados": atualizados}

    # ------------------------------------------------------------------
    # Treinamentos vinculados a um processo seletivo (Correcoes.txt, rodada
    # 03/set/2026) — bloqueio/liberação de vagas por processo.
    # ------------------------------------------------------------------
    def sync_process_trainings(self, id_processo: str, *, vagas_totais: int, trilha_ids: list[int]) -> None:
        """Chamado ao criar o processo: uma linha por trilha selecionada, com
        todas as vagas do processo inicialmente bloqueadas (AGUARDANDO
        PROCESSO). Idempotente — não duplica se já existir para o par
        (processo, trilha)."""
        safe_process_id = normalize_text(id_processo)
        if not safe_process_id or not trilha_ids:
            return

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_trainings_table(cursor)
            for trilha_id_raw in trilha_ids:
                try:
                    trilha_id = int(trilha_id_raw)
                except (TypeError, ValueError):
                    continue
                cursor.execute(
                    "SELECT 1 FROM processos_treinamentos WHERE id_processo = ? AND trilha_id = ?",
                    (safe_process_id, trilha_id),
                )
                if cursor.fetchone():
                    continue
                cursor.execute(
                    """
                    INSERT INTO processos_treinamentos (id_processo, trilha_id, vagas_totais, vagas_liberadas, criado_em, atualizado_em)
                    VALUES (?, ?, ?, 0, GETDATE(), GETDATE())
                    """,
                    (safe_process_id, trilha_id, int(vagas_totais or 0)),
                )
            conn.commit()
        finally:
            conn.close()

    def list_process_trainings(self, *, id_processo: str | None = None) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_trainings_table(cursor)
            ensure_onboarding_tables(cursor)

            filtro = ""
            parametros: list = []
            if id_processo:
                filtro = "WHERE pt.id_processo = ?"
                parametros.append(normalize_text(id_processo))

            cursor.execute(
                f"""
                SELECT
                    {_PROCESS_TRAINING_COLUMNS},
                    t.nome AS trilha_nome,
                    t.categoria AS trilha_categoria,
                    ps.vaga,
                    ps.status AS processo_status
                FROM processos_treinamentos pt
                JOIN trilhas_onboarding t ON t.id_trilha = pt.trilha_id
                JOIN processos_seletivos ps ON ps.id_processo = pt.id_processo
                {filtro}
                ORDER BY pt.criado_em DESC, pt.id_processo_treinamento DESC
                """,
                tuple(parametros),
            )
            linhas = rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

        for linha in linhas:
            vagas_totais = int(linha.get("vagas_totais") or 0)
            vagas_liberadas = int(linha.get("vagas_liberadas") or 0)
            linha["vagas_bloqueadas"] = max(vagas_totais - vagas_liberadas, 0)
        return linhas

    def list_process_training_release_candidates(self, id_processo_treinamento: int) -> list[dict]:
        """Candidatos aprovados do processo que ainda não entraram nesta
        trilha — para o Gestor escolher quem liberar."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_trainings_table(cursor)
            ensure_onboarding_tables(cursor)

            cursor.execute(
                "SELECT id_processo, trilha_id FROM processos_treinamentos WHERE id_processo_treinamento = ?",
                (int(id_processo_treinamento or 0),),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treinamento do processo não encontrado.")
            id_processo, trilha_id = normalize_text(row[0]), int(row[1])

            cursor.execute(
                """
                SELECT cp.id_registro, cp.nome_candidato
                FROM candidatos_processos cp
                WHERE cp.id_processo = ? AND cp.status_candidato = 'Aprovado'
                  AND NOT EXISTS (
                      SELECT 1 FROM onboarding_candidatos oc
                      WHERE oc.id_registro = cp.id_registro AND oc.trilha_id = ?
                  )
                ORDER BY cp.nome_candidato ASC
                """,
                (id_processo, trilha_id),
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def release_process_training_slots(
        self,
        id_processo_treinamento: int,
        *,
        candidatos: list[int],
        actor: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_process_trainings_table(cursor)
            ensure_onboarding_tables(cursor)

            cursor.execute(
                "SELECT id_processo, trilha_id, vagas_totais, vagas_liberadas FROM processos_treinamentos WHERE id_processo_treinamento = ?",
                (int(id_processo_treinamento or 0),),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Treinamento do processo não encontrado.")
            id_processo, trilha_id, vagas_totais, vagas_liberadas = (
                normalize_text(row[0]),
                int(row[1]),
                int(row[2] or 0),
                int(row[3] or 0),
            )

            candidatos_validos = [int(item) for item in (candidatos or []) if item]
            vagas_disponiveis = vagas_totais - vagas_liberadas
            if len(candidatos_validos) > vagas_disponiveis:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Só é possível liberar até {vagas_disponiveis} vaga(s) neste treinamento.",
                )

            for id_registro in candidatos_validos:
                self.start_onboarding(id_registro, trilha_id, actor=actor)

            if candidatos_validos:
                cursor.execute(
                    """
                    UPDATE processos_treinamentos
                    SET vagas_liberadas = vagas_liberadas + ?, atualizado_em = GETDATE()
                    WHERE id_processo_treinamento = ?
                    """,
                    (len(candidatos_validos), int(id_processo_treinamento or 0)),
                )
            conn.commit()
        finally:
            conn.close()

        return {"success": True, "liberados": len(candidatos_validos)}

    # ------------------------------------------------------------------
    # Wizard de criação de treinamento (Prompt.txt, rodada 06/set/2026) — ver
    # docs/central-treinamentos/01-plano-tecnico.md.
    # ------------------------------------------------------------------
    def search_candidatos_para_treinamento(self, busca: str = "") -> list[dict]:
        """Busca manual de participantes (plano técnico §7 — não há hoje um
        vínculo Operação→colaborador para listar automaticamente por operação;
        `candidatos_processos` é a única lista de pessoas existente no Conecta)."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            termo = normalize_text(busca)
            if termo:
                cursor.execute(
                    """
                    SELECT TOP 50 id_registro, nome_candidato, vaga, status_candidato
                    FROM candidatos_processos
                    WHERE nome_candidato LIKE ?
                    ORDER BY nome_candidato ASC
                    """,
                    (f"%{termo}%",),
                )
            else:
                cursor.execute(
                    """
                    SELECT TOP 50 id_registro, nome_candidato, vaga, status_candidato
                    FROM candidatos_processos
                    ORDER BY nome_candidato ASC
                    """
                )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def create_treinamento_wizard(self, data: dict, *, actor: str = "") -> dict:
        """Publica o treinamento completo (todas as etapas do wizard): cria a
        trilha + módulos (via create_onboarding_trilha) e, para cada ocorrência
        programada, uma atribuição por participante (via start_onboarding).

        Sem tabela de "sessão" nova — a ocorrência é identificada pela tupla
        (trilha_id, data_prevista, ministrante) já existente em
        onboarding_candidatos (plano técnico §1.4)."""
        trilha = self.create_onboarding_trilha(data, actor=actor)
        id_trilha = int(trilha["id_trilha"])

        ocorrencias = data.get("ocorrencias") or []
        participantes = [int(item) for item in (data.get("participantes") or []) if item]

        criadas: list[int] = []
        falhas: list[dict] = []
        for ocorrencia in ocorrencias:
            data_prevista = ocorrencia.get("data_prevista")
            local = normalize_text(ocorrencia.get("local"))
            ministrante = normalize_text(ocorrencia.get("ministrante"))
            for id_registro in participantes:
                try:
                    resultado = self.start_onboarding(
                        id_registro,
                        id_trilha,
                        actor=actor,
                        data_prevista=data_prevista,
                        local=local,
                        ministrante=ministrante,
                    )
                    onboarding = resultado.get("onboarding") or {}
                    if onboarding.get("id_onboarding"):
                        criadas.append(int(onboarding["id_onboarding"]))
                except HTTPException as erro:
                    falhas.append({"id_registro": id_registro, "erro": erro.detail})

        return {
            "trilha": trilha,
            "atribuicoes_criadas": len(criadas),
            "falhas": falhas,
        }

    # ------------------------------------------------------------------
    # Anexos da aba "Saiba +" (nível treinamento ou módulo) — LGPD (plano
    # técnico §1.3).
    # ------------------------------------------------------------------
    def add_trilha_anexo(
        self,
        id_trilha: int,
        *,
        trilha_item_id: int | None,
        nome_arquivo_original: str,
        nome_arquivo_armazenado: str,
        tipo_arquivo: str,
        caminho_arquivo: str,
        tamanho_bytes: int,
        actor: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute("SELECT id_trilha FROM trilhas_onboarding WHERE id_trilha = ?", (int(id_trilha or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trilha de onboarding não encontrada.")
            cursor.execute(
                """
                INSERT INTO trilhas_onboarding_anexos
                (trilha_id, trilha_item_id, nome_arquivo_original, nome_arquivo_armazenado, tipo_arquivo,
                 caminho_arquivo, tamanho_bytes, permite_download, criado_por, criado_em)
                OUTPUT INSERTED.id_anexo
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, GETDATE())
                """,
                (
                    int(id_trilha or 0),
                    int(trilha_item_id) if trilha_item_id else None,
                    nome_arquivo_original,
                    nome_arquivo_armazenado,
                    tipo_arquivo,
                    caminho_arquivo,
                    int(tamanho_bytes or 0),
                    normalize_text(actor),
                ),
            )
            id_anexo = int(cursor.fetchone()[0])
            conn.commit()
        finally:
            conn.close()
        return {"id_anexo": id_anexo}

    def get_trilha_anexo(self, id_anexo: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute(f"SELECT {_ANEXO_COLUMNS} FROM trilhas_onboarding_anexos WHERE id_anexo = ?", (int(id_anexo or 0),))
            rows = rows_to_dicts(cursor, cursor.fetchall())
            if not rows:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anexo não encontrado.")
            return rows[0]
        finally:
            conn.close()

    def toggle_anexo_download(
        self,
        id_anexo: int,
        *,
        permite_download: bool,
        termo_aceito: bool,
        termo_versao: str,
        actor: str = "",
    ) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute("SELECT id_anexo FROM trilhas_onboarding_anexos WHERE id_anexo = ?", (int(id_anexo or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anexo não encontrado.")

            if permite_download and termo_aceito:
                cursor.execute(
                    """
                    UPDATE trilhas_onboarding_anexos
                    SET permite_download = 1, termo_aceito_em = GETDATE(), termo_aceito_por = ?, termo_versao = ?
                    WHERE id_anexo = ?
                    """,
                    (normalize_text(actor), termo_versao, int(id_anexo or 0)),
                )
            else:
                # Desligar o toggle não apaga o aceite anterior (histórico de
                # auditoria) — só desativa o download público.
                cursor.execute(
                    "UPDATE trilhas_onboarding_anexos SET permite_download = 0 WHERE id_anexo = ?",
                    (int(id_anexo or 0),),
                )
            conn.commit()
        finally:
            conn.close()
        return self.get_trilha_anexo(id_anexo)

    def delete_trilha_anexo(self, id_anexo: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute("SELECT caminho_arquivo FROM trilhas_onboarding_anexos WHERE id_anexo = ?", (int(id_anexo or 0),))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anexo não encontrado.")
            cursor.execute("DELETE FROM trilhas_onboarding_anexos WHERE id_anexo = ?", (int(id_anexo or 0),))
            conn.commit()
        finally:
            conn.close()
        return {"success": True}

    # ------------------------------------------------------------------
    # Arquivos "de primeira classe" da trilha/módulo (slide .pptx, vídeo do
    # módulo) — colunas dedicadas, setadas só pelo endpoint de upload.
    # ------------------------------------------------------------------
    def set_trilha_pptx(self, id_trilha: int, *, pptx_path: str, pptx_nome_original: str, pptx_pdf_path: str | None) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute("SELECT id_trilha FROM trilhas_onboarding WHERE id_trilha = ?", (int(id_trilha or 0),))
            if not cursor.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trilha de onboarding não encontrada.")
            cursor.execute(
                """
                UPDATE trilhas_onboarding
                SET pptx_path = ?, pptx_nome_original = ?, pptx_pdf_path = ?, atualizado_em = GETDATE()
                WHERE id_trilha = ?
                """,
                (pptx_path, pptx_nome_original, pptx_pdf_path, int(id_trilha or 0)),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_onboarding_trilha(id_trilha)

    def set_item_video(self, id_item: int, *, video_path: str, video_nome_original: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute("SELECT trilha_id FROM trilhas_onboarding_itens WHERE id_item = ?", (int(id_item or 0),))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Módulo não encontrado.")
            id_trilha = int(row[0])
            cursor.execute(
                "UPDATE trilhas_onboarding_itens SET video_path = ?, video_nome_original = ? WHERE id_item = ?",
                (video_path, video_nome_original, int(id_item or 0)),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_onboarding_trilha(id_trilha)

    # ------------------------------------------------------------------
    # Escalonamento por chamada pendente (job agendado — plano técnico §6).
    # ------------------------------------------------------------------
    def run_training_call_escalation(self) -> dict:
        """Executado periodicamente pelo scheduler (ver `rh_api/scheduler.py`).

        Busca as atribuições candidatas e delega a decisão (o que promover a
        pendente, notificar aos 3 dias, encerrar aos 5 dias) para a função
        pura `compute_training_call_escalation` — testável sem banco."""
        from datetime import datetime

        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            ensure_notifications_table(cursor)

            cursor.execute(
                """
                SELECT oc.id_onboarding, oc.status, oc.presenca, oc.data_prevista, oc.notificado_pendente_em,
                       t.nome AS trilha_nome, cp.nome_candidato
                FROM onboarding_candidatos oc
                JOIN trilhas_onboarding t ON t.id_trilha = oc.trilha_id
                JOIN candidatos_processos cp ON cp.id_registro = oc.id_registro
                WHERE oc.status IN ('em_andamento', 'pendente_chamada')
                  AND oc.data_prevista IS NOT NULL AND oc.presenca IS NULL
                """
            )
            atribuicoes = rows_to_dicts(cursor, cursor.fetchall())
            decisao = compute_training_call_escalation(atribuicoes, agora=datetime.now())

            for id_onboarding in decisao["promover_pendente"]:
                cursor.execute(
                    "UPDATE onboarding_candidatos SET status = 'pendente_chamada' WHERE id_onboarding = ?",
                    (id_onboarding,),
                )

            for linha in decisao["notificar_3_dias"]:
                for papel in _PAPEIS_GESTAO_TREINAMENTO:
                    self._criar_notificacao(
                        cursor,
                        destinatario_papel=papel,
                        titulo="Chamada pendente há 3+ dias",
                        mensagem=(
                            f"O treinamento \"{linha['trilha_nome']}\" de {linha.get('nome_candidato') or 'um colaborador'} "
                            "está com a chamada pendente há mais de 3 dias."
                        ),
                        categoria="treinamento_pendente_chamada",
                        entidade="onboarding_candidato",
                        entidade_id=str(linha["id_onboarding"]),
                    )
                cursor.execute(
                    "UPDATE onboarding_candidatos SET notificado_pendente_em = GETDATE() WHERE id_onboarding = ?",
                    (int(linha["id_onboarding"]),),
                )

            for linha in decisao["encerrar_5_dias"]:
                cursor.execute(
                    "UPDATE onboarding_candidatos SET status = 'encerrado_sem_chamada' WHERE id_onboarding = ?",
                    (int(linha["id_onboarding"]),),
                )
                for papel in _PAPEIS_GESTAO_TREINAMENTO:
                    self._criar_notificacao(
                        cursor,
                        destinatario_papel=papel,
                        titulo="Treinamento encerrado sem chamada",
                        mensagem=(
                            f"O treinamento \"{linha['trilha_nome']}\" de {linha.get('nome_candidato') or 'um colaborador'} "
                            "foi encerrado automaticamente sem chamada registrada (5+ dias)."
                        ),
                        categoria="treinamento_encerrado_sem_chamada",
                        entidade="onboarding_candidato",
                        entidade_id=str(linha["id_onboarding"]),
                    )
            conn.commit()
        finally:
            conn.close()

        return {
            "marcadas_pendentes": len(decisao["promover_pendente"]),
            "notificadas_3_dias": len(decisao["notificar_3_dias"]),
            "encerradas_5_dias": len(decisao["encerrar_5_dias"]),
        }

    # ------------------------------------------------------------------
    # Relatórios da Central de Treinamentos (plano técnico §5 / prompt §3.8).
    # ------------------------------------------------------------------
    def report_treinamentos_status(self, *, id_operacao: int | None = None, data_inicio=None, data_fim=None) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            condicoes = []
            parametros: list = []
            if id_operacao:
                condicoes.append("t.id_operacao = ?")
                parametros.append(int(id_operacao))
            if data_inicio:
                condicoes.append("oc.data_prevista >= ?")
                parametros.append(data_inicio)
            if data_fim:
                condicoes.append("oc.data_prevista <= ?")
                parametros.append(data_fim)
            filtro = f"AND {' AND '.join(condicoes)}" if condicoes else ""
            cursor.execute(
                f"""
                SELECT t.id_trilha, t.nome AS trilha_nome, oc.status, COUNT(*) AS total
                FROM onboarding_candidatos oc
                JOIN trilhas_onboarding t ON t.id_trilha = oc.trilha_id
                WHERE 1=1 {filtro}
                GROUP BY t.id_trilha, t.nome, oc.status
                ORDER BY t.nome ASC, oc.status ASC
                """,
                tuple(parametros),
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def report_presenca_colaborador(self) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute(
                """
                SELECT
                    cp.id_registro,
                    cp.nome_candidato,
                    COUNT(*) AS total_treinamentos,
                    SUM(CASE WHEN oc.presenca = 'presente' THEN 1 ELSE 0 END) AS presencas,
                    SUM(CASE WHEN oc.presenca = 'falta' THEN 1 ELSE 0 END) AS faltas,
                    SUM(CASE WHEN oc.status IN ('pendente_chamada', 'encerrado_sem_chamada') THEN 1 ELSE 0 END) AS pendencias
                FROM onboarding_candidatos oc
                JOIN candidatos_processos cp ON cp.id_registro = oc.id_registro
                GROUP BY cp.id_registro, cp.nome_candidato
                ORDER BY cp.nome_candidato ASC
                """
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def report_conclusao_operacao(self) -> list[dict]:
        """Extra (prompt §3.8: "proponha relatórios adicionais... ex.: taxa de
        conclusão por operação") — baixo custo, reaproveita dados já existentes."""
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_onboarding_tables(cursor)
            cursor.execute(
                """
                SELECT
                    o.id_item AS id_operacao,
                    o.nome AS operacao_nome,
                    COUNT(*) AS total_atribuicoes,
                    SUM(CASE WHEN oc.status = 'aplicado' THEN 1 ELSE 0 END) AS aplicadas,
                    SUM(CASE WHEN oc.status = 'encerrado_sem_chamada' THEN 1 ELSE 0 END) AS encerradas_sem_chamada
                FROM onboarding_candidatos oc
                JOIN trilhas_onboarding t ON t.id_trilha = oc.trilha_id
                JOIN operacoes o ON o.id_item = t.id_operacao
                GROUP BY o.id_item, o.nome
                ORDER BY o.nome ASC
                """
            )
            linhas = rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()
        for linha in linhas:
            total = int(linha.get("total_atribuicoes") or 0)
            aplicadas = int(linha.get("aplicadas") or 0)
            linha["taxa_conclusao_pct"] = round((aplicadas / total) * 100) if total else 0
        return linhas

    # ------------------------------------------------------------------
    # Notificações (central in-app — plano técnico §1.5, mecanismo genérico
    # reaproveitável por outros módulos além de treinamentos).
    # ------------------------------------------------------------------
    @staticmethod
    def _criar_notificacao(
        cursor,
        *,
        destinatario_papel: str | None = None,
        destinatario_usuario: str | None = None,
        titulo: str,
        mensagem: str = "",
        categoria: str,
        entidade: str = "",
        entidade_id: str = "",
    ) -> None:
        cursor.execute(
            """
            INSERT INTO notificacoes
            (destinatario_papel, destinatario_usuario, titulo, mensagem, categoria, entidade, entidade_id, lida, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, GETDATE())
            """,
            (
                normalize_text(destinatario_papel) or None,
                normalize_text(destinatario_usuario) or None,
                normalize_text(titulo),
                normalize_text(mensagem),
                normalize_text(categoria),
                normalize_text(entidade) or None,
                normalize_text(entidade_id) or None,
            ),
        )

    def list_notificacoes(self, *, papel: str, usuario: str, apenas_nao_lidas: bool = False) -> list[dict]:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            condicoes = ["(destinatario_papel = ? OR destinatario_usuario = ?)"]
            parametros: list = [normalize_text(papel), normalize_text(usuario)]
            if apenas_nao_lidas:
                condicoes.append("lida = 0")
            cursor.execute(
                f"""
                SELECT TOP 100 id_notificacao, destinatario_papel, destinatario_usuario, titulo, mensagem,
                       categoria, entidade, entidade_id, lida, lida_em, criado_em
                FROM notificacoes
                WHERE {' AND '.join(condicoes)}
                ORDER BY lida ASC, criado_em DESC
                """,
                tuple(parametros),
            )
            return rows_to_dicts(cursor, cursor.fetchall())
        finally:
            conn.close()

    def marcar_notificacao_lida(self, id_notificacao: int) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            cursor.execute(
                "UPDATE notificacoes SET lida = 1, lida_em = GETDATE() WHERE id_notificacao = ?",
                (int(id_notificacao or 0),),
            )
            conn.commit()
        finally:
            conn.close()
        return {"success": True}

    def marcar_todas_notificacoes_lidas(self, *, papel: str, usuario: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            cursor.execute(
                """
                UPDATE notificacoes SET lida = 1, lida_em = GETDATE()
                WHERE (destinatario_papel = ? OR destinatario_usuario = ?) AND lida = 0
                """,
                (normalize_text(papel), normalize_text(usuario)),
            )
            atualizadas = cursor.rowcount
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "atualizadas": atualizadas}

    def excluir_notificacao(self, id_notificacao: int, *, papel: str, usuario: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            cursor.execute(
                """
                DELETE FROM notificacoes
                WHERE id_notificacao = ? AND (destinatario_papel = ? OR destinatario_usuario = ?)
                """,
                (int(id_notificacao or 0), normalize_text(papel), normalize_text(usuario)),
            )
            conn.commit()
        finally:
            conn.close()
        return {"success": True}

    def excluir_todas_notificacoes(self, *, papel: str, usuario: str) -> dict:
        conn = self._connect()
        try:
            cursor = conn.cursor()
            ensure_notifications_table(cursor)
            cursor.execute(
                "DELETE FROM notificacoes WHERE (destinatario_papel = ? OR destinatario_usuario = ?)",
                (normalize_text(papel), normalize_text(usuario)),
            )
            excluidas = cursor.rowcount
            conn.commit()
        finally:
            conn.close()
        return {"success": True, "excluidas": excluidas}

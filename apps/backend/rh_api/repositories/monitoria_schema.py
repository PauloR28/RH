"""Schema da vertente Monitoria (promt.txt, rodada 20/set/2026).

Fonte ÚNICA do DDL: `ensure_monitoria_schema(cursor)` roda no bootstrap de DEV
e `render_migration_sql()` gera `infra/sql/migrations/V037__monitoria.sql`
(um teste garante que os dois coincidem — ver tests/test_monitoria_schema.py).

Regras de integridade:
  * Tudo aditivo e idempotente (nunca altera/remove dados existentes).
  * Tabelas "IMUTAVEIS" recebem trigger INSTEAD OF UPDATE/DELETE que bloqueia
    qualquer alteração (camada de banco da imutabilidade, promt.txt §5.6).
  * Estado atual (`monitoria_estado`) e planos de ação são mutáveis; todo o
    resto do fluxo é append-only (eventos, feedbacks, contestações...).
"""

from __future__ import annotations

# Tabelas cujo conteúdo jamais pode mudar depois de inserido.
TABELAS_IMUTAVEIS = (
    "monitoria_matriz_versoes",
    "monitorias",
    "monitoria_respostas",
    "monitoria_pilares",
    "monitoria_eventos",
    "monitoria_feedbacks",
    "monitoria_contestacoes",
    "monitoria_replicas",
    "monitoria_reanalises",
    "monitoria_anexos",
    "monitoria_plano_historico",
    "monitoria_logs",
)

_TABELAS: list[tuple[str, str]] = [
    (
        "equipes_operacao",
        """
        id_equipe INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_equipes_operacao_ativo DEFAULT 1,
        criado_em DATETIME NOT NULL CONSTRAINT DF_equipes_operacao_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_equipes_operacao_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "usuarios_supervisores",
        """
        id_operador INT NOT NULL,
        id_supervisor INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_usuarios_supervisores_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_usuarios_supervisores PRIMARY KEY (id_operador, id_supervisor)
        """,
    ),
    (
        "usuarios_operacoes_historico",
        """
        id_historico INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_usuario INT NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        acao NVARCHAR(30) NOT NULL,
        detalhe NVARCHAR(400) NULL,
        por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_usuarios_operacoes_historico_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_catalogo",
        """
        id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        tipo NVARCHAR(30) NOT NULL,
        operacao NVARCHAR(60) NULL,
        valor NVARCHAR(120) NOT NULL,
        ordem INT NOT NULL CONSTRAINT DF_monitoria_catalogo_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_monitoria_catalogo_ativo DEFAULT 1,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_catalogo_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_matrizes",
        """
        id_matriz INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        nome NVARCHAR(180) NOT NULL,
        id_versao_ativa INT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_monitoria_matrizes_ativo DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_matrizes_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_matriz_versoes",
        """
        id_versao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_matriz INT NOT NULL,
        numero INT NOT NULL,
        config_json NVARCHAR(MAX) NOT NULL,
        observacao NVARCHAR(400) NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_matriz_versoes_criado_em DEFAULT GETDATE(),
        CONSTRAINT UX_monitoria_matriz_versoes UNIQUE (id_matriz, numero)
        """,
    ),
    (
        "monitoria_rascunhos",
        """
        id_rascunho INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_avaliador INT NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        payload_json NVARCHAR(MAX) NOT NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_rascunhos_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitorias",
        """
        id_monitoria INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        codigo CHAR(8) NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        operacao_nome NVARCHAR(180) NULL,
        id_equipe INT NULL,
        equipe_nome NVARCHAR(120) NULL,
        turno NVARCHAR(30) NULL,
        id_operador INT NOT NULL,
        operador_nome NVARCHAR(180) NOT NULL,
        operador_email NVARCHAR(180) NULL,
        supervisores_json NVARCHAR(MAX) NULL,
        id_avaliador INT NOT NULL,
        avaliador_nome NVARCHAR(180) NOT NULL,
        id_matriz INT NOT NULL,
        id_versao INT NOT NULL,
        numero_versao INT NOT NULL,
        config_json NVARCHAR(MAX) NOT NULL,
        canal NVARCHAR(120) NOT NULL,
        tipo_atendimento NVARCHAR(120) NOT NULL,
        data_contato DATE NOT NULL,
        telefone NVARCHAR(40) NULL,
        id_interacao NVARCHAR(120) NULL,
        data_monitoria DATETIME NOT NULL,
        respostas_json NVARCHAR(MAX) NOT NULL,
        pilares_json NVARCHAR(MAX) NOT NULL,
        nota DECIMAL(6,2) NOT NULL,
        nivel NVARCHAR(60) NULL,
        possui_ncg BIT NOT NULL CONSTRAINT DF_monitorias_possui_ncg DEFAULT 0,
        motivo_ncg NVARCHAR(MAX) NULL,
        blocos_avaliados INT NOT NULL,
        blocos_nulos INT NOT NULL,
        anulada BIT NOT NULL CONSTRAINT DF_monitorias_anulada DEFAULT 0,
        justificativa_anulacao NVARCHAR(MAX) NULL,
        observacao NVARCHAR(MAX) NULL,
        sugestao_feedback NVARCHAR(MAX) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitorias_criado_em DEFAULT GETDATE(),
        CONSTRAINT UX_monitorias_codigo UNIQUE (codigo)
        """,
    ),
    (
        "monitoria_respostas",
        """
        id_resposta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        id_bloco NVARCHAR(40) NOT NULL,
        bloco_nome NVARCHAR(180) NOT NULL,
        bloco_status NVARCHAR(12) NOT NULL,
        id_criterio NVARCHAR(40) NOT NULL,
        pergunta NVARCHAR(400) NOT NULL,
        peso DECIMAL(8,2) NOT NULL,
        resposta NVARCHAR(4) NOT NULL
        """,
    ),
    (
        "monitoria_pilares",
        """
        id_pilar INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        indicador NVARCHAR(120) NOT NULL,
        nota INT NOT NULL
        """,
    ),
    (
        "monitoria_estado",
        """
        id_monitoria INT NOT NULL PRIMARY KEY,
        status NVARCHAR(40) NOT NULL,
        resultado NVARCHAR(20) NULL,
        sla_tipo NVARCHAR(30) NULL,
        sla_inicio DATETIME NULL,
        sla_limite DATETIME NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_estado_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_eventos",
        """
        id_evento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        status_anterior NVARCHAR(40) NULL,
        status_novo NVARCHAR(40) NOT NULL,
        id_usuario INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        perfil NVARCHAR(40) NULL,
        automatico BIT NOT NULL CONSTRAINT DF_monitoria_eventos_automatico DEFAULT 0,
        observacao NVARCHAR(MAX) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_eventos_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_feedbacks",
        """
        id_feedback INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        aplicado_por INT NOT NULL,
        aplicado_por_nome NVARCHAR(180) NOT NULL,
        data_aplicacao DATETIME NOT NULL CONSTRAINT DF_monitoria_feedbacks_data DEFAULT GETDATE(),
        observacao NVARCHAR(MAX) NULL,
        sugestao_original NVARCHAR(MAX) NULL,
        complemento NVARCHAR(MAX) NULL,
        prazo_sla DATETIME NULL,
        dentro_sla BIT NULL
        """,
    ),
    (
        "monitoria_contestacoes",
        """
        id_contestacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        id_operador INT NOT NULL,
        data_contestacao DATETIME NOT NULL CONSTRAINT DF_monitoria_contestacoes_data DEFAULT GETDATE(),
        criterios_json NVARCHAR(MAX) NOT NULL,
        motivo NVARCHAR(400) NOT NULL,
        justificativa NVARCHAR(MAX) NOT NULL,
        prazo_sla DATETIME NULL,
        dentro_sla BIT NULL
        """,
    ),
    (
        "monitoria_replicas",
        """
        id_replica INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_contestacao INT NOT NULL,
        id_monitoria INT NOT NULL,
        id_autor INT NOT NULL,
        autor_nome NVARCHAR(180) NOT NULL,
        texto NVARCHAR(MAX) NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_replicas_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_reanalises",
        """
        id_reanalise INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_contestacao INT NOT NULL,
        id_monitoria INT NOT NULL,
        id_supervisor INT NULL,
        supervisor_nome NVARCHAR(180) NULL,
        resultado NVARCHAR(20) NOT NULL,
        observacao NVARCHAR(MAX) NOT NULL,
        automatico BIT NOT NULL CONSTRAINT DF_monitoria_reanalises_automatico DEFAULT 0,
        data_reanalise DATETIME NOT NULL CONSTRAINT DF_monitoria_reanalises_data DEFAULT GETDATE(),
        dentro_sla BIT NULL
        """,
    ),
    (
        "monitoria_anexos",
        """
        id_anexo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_contestacao INT NOT NULL,
        id_monitoria INT NOT NULL,
        nome_original NVARCHAR(255) NOT NULL,
        arquivo NVARCHAR(255) NOT NULL,
        mime NVARCHAR(120) NULL,
        tamanho INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_anexos_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_planos_acao",
        """
        id_plano INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NULL,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        operador_nome NVARCHAR(180) NOT NULL,
        origem NVARCHAR(120) NULL,
        id_responsavel INT NULL,
        responsavel_nome NVARCHAR(180) NULL,
        problema NVARCHAR(MAX) NOT NULL,
        criterio NVARCHAR(400) NULL,
        objetivo NVARCHAR(MAX) NOT NULL,
        acao NVARCHAR(MAX) NOT NULL,
        prazo DATE NOT NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_monitoria_planos_status DEFAULT 'ABERTO',
        data_revisao DATE NULL,
        resultado NVARCHAR(MAX) NULL,
        observacoes NVARCHAR(MAX) NULL,
        nota_antes DECIMAL(6,2) NULL,
        nota_depois DECIMAL(6,2) NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_planos_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_planos_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_plano_historico",
        """
        id_historico INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_plano INT NOT NULL,
        evento NVARCHAR(40) NOT NULL,
        status_anterior NVARCHAR(20) NULL,
        status_novo NVARCHAR(20) NULL,
        detalhe NVARCHAR(MAX) NULL,
        por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_plano_historico_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_logs",
        """
        id_log INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_usuario INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        perfil NVARCHAR(40) NULL,
        operacao NVARCHAR(60) NULL,
        acao NVARCHAR(120) NOT NULL,
        modulo NVARCHAR(60) NULL,
        entidade NVARCHAR(60) NULL,
        entidade_id NVARCHAR(80) NULL,
        ip NVARCHAR(64) NULL,
        resultado NVARCHAR(10) NOT NULL CONSTRAINT DF_monitoria_logs_resultado DEFAULT 'SUCESSO',
        detalhes NVARCHAR(MAX) NULL,
        estado_anterior NVARCHAR(MAX) NULL,
        estado_posterior NVARCHAR(MAX) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_logs_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_guia",
        """
        id_guia INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        titulo NVARCHAR(180) NOT NULL,
        conteudo NVARCHAR(MAX) NOT NULL,
        ordem INT NOT NULL CONSTRAINT DF_monitoria_guia_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_monitoria_guia_ativo DEFAULT 1,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_guia_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "monitoria_config",
        """
        chave NVARCHAR(80) NOT NULL PRIMARY KEY,
        valor NVARCHAR(MAX) NOT NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_config_atualizado_em DEFAULT GETDATE()
        """,
    ),
]

# Colunas aditivas em tabelas existentes: (tabela, coluna, tipo SQL).
_COLUNAS_ADITIVAS: list[tuple[str, str, str]] = [
    ("operacoes", "cor_primaria", "NVARCHAR(9)"),
    ("operacoes", "logo_arquivo", "NVARCHAR(255)"),
    ("usuarios", "turno", "NVARCHAR(30)"),
    ("usuarios", "id_equipe", "INT"),
    ("usuarios", "deve_trocar_senha", "BIT"),
    ("usuarios", "tema_operacao", "NVARCHAR(60)"),
    ("usuarios", "tema_operacao_alterado", "BIT"),
]

_INDICES: list[tuple[str, str, str]] = [
    ("IX_monitorias_operacao_data", "monitorias", "operacao, data_monitoria"),
    ("IX_monitorias_operador", "monitorias", "id_operador, data_monitoria"),
    ("IX_monitorias_avaliador", "monitorias", "id_avaliador"),
    ("IX_monitorias_interacao", "monitorias", "id_interacao"),
    ("IX_monitoria_respostas_monitoria", "monitoria_respostas", "id_monitoria"),
    ("IX_monitoria_eventos_monitoria", "monitoria_eventos", "id_monitoria, criado_em"),
    ("IX_monitoria_estado_status", "monitoria_estado", "status, sla_limite"),
    ("IX_monitoria_logs_data", "monitoria_logs", "criado_em, operacao"),
    ("IX_equipes_operacao_operacao", "equipes_operacao", "operacao, ativo"),
]


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").splitlines())
    return (
        f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\n"
        f"BEGIN\n"
        f"    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\n"
        f"END;"
    )


def _add_column_sql(tabela: str, coluna: str, tipo: str) -> str:
    return (
        f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL AND COL_LENGTH('dbo.{tabela}', '{coluna}') IS NULL\n"
        f"BEGIN\n    ALTER TABLE dbo.{tabela} ADD {coluna} {tipo} NULL;\nEND;"
    )


def _index_sql(nome: str, tabela: str, colunas: str) -> str:
    return (
        f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{nome}' AND object_id = OBJECT_ID('dbo.{tabela}'))\n"
        f"BEGIN\n    CREATE INDEX {nome} ON dbo.{tabela}({colunas});\nEND;"
    )


def _trigger_sql(tabela: str) -> str:
    nome = f"TR_{tabela}_imutavel"
    return (
        f"IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = '{nome}')\n"
        f"BEGIN\n"
        f"    EXEC(N'CREATE TRIGGER dbo.{nome} ON dbo.{tabela} INSTEAD OF UPDATE, DELETE AS "
        f"BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: {tabela} nao aceita UPDATE nem DELETE.'', 1; END');\n"
        f"END;"
    )


def schema_statements() -> list[str]:
    """Todas as instruções do schema, na ordem de execução."""
    instrucoes = [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    instrucoes += [_add_column_sql(*item) for item in _COLUNAS_ADITIVAS]
    instrucoes += [_index_sql(*item) for item in _INDICES]
    instrucoes += [_trigger_sql(tabela) for tabela in TABELAS_IMUTAVEIS]
    return instrucoes


def ensure_monitoria_schema(cursor) -> None:
    for instrucao in schema_statements() + schema_ambiente_statements() + schema_tipos_atendimento_statements():
        cursor.execute(instrucao)


# ---------------------------------------------------------------------------
# Ambiente da operação e canais do usuário (Correções.txt, 21/set/2026).
# Aditivo e separado da V037 (que continua idêntica ao DDL acima); gera a V039.
# ---------------------------------------------------------------------------
_TABELAS_AMBIENTE: list[tuple[str, str]] = [
    (
        "usuarios_canais",
        """
        id_usuario INT NOT NULL,
        id_item_canal INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_usuarios_canais_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_usuarios_canais PRIMARY KEY (id_usuario, id_item_canal)
        """,
    ),
    (
        "operacoes_ambiente",
        """
        operacao NVARCHAR(60) NOT NULL PRIMARY KEY,
        possui_qualidade BIT NOT NULL CONSTRAINT DF_operacoes_ambiente_qualidade DEFAULT 0,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_operacoes_ambiente_atualizado_em DEFAULT GETDATE()
        """,
    ),
]


def schema_ambiente_statements() -> list[str]:
    return [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS_AMBIENTE]


def render_migration_ambiente_sql() -> str:
    cabecalho = (
        "-- Conecta - Monitoria: canais de atendimento por usuario e configuracao de ambiente\n"
        "-- por operacao (Correcoes.txt, 21/set/2026). Aditiva e idempotente. Gerada a partir de\n"
        "-- rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_ambiente_statements()) + "\n"


def render_migration_sql() -> str:
    cabecalho = (
        "-- Vertente Monitoria (promt.txt, rodada 20/set/2026). Aditiva e idempotente:\n"
        "-- nao altera nem remove dados existentes. Gerada a partir de\n"
        "-- rh_api/repositories/monitoria_schema.py (fonte unica do DDL; um teste garante\n"
        "-- que este arquivo e o bootstrap runtime coincidem). Tabelas de fluxo/historico\n"
        "-- recebem trigger INSTEAD OF UPDATE/DELETE (imutabilidade em camada de banco).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


# ---------------------------------------------------------------------------
# Tipos de atendimento por canal (Correções.txt, 21/set/2026). Aditivo e separado
# da V037/V039; gera a V040. `id_item_canal` NULL = o tipo vale para todos os canais
# da operação (comportamento anterior, preservado para os itens existentes).
# ---------------------------------------------------------------------------
_COLUNAS_TIPOS_ATENDIMENTO: list[tuple[str, str, str]] = [
    ("monitoria_catalogo", "id_item_canal", "INT"),
]


def schema_tipos_atendimento_statements() -> list[str]:
    return [_add_column_sql(*item) for item in _COLUNAS_TIPOS_ATENDIMENTO]


def render_migration_tipos_atendimento_sql() -> str:
    cabecalho = (
        "-- Conecta - Monitoria: tipo de atendimento vinculado a um canal de atendimento\n"
        "-- (Correcoes.txt, 21/set/2026). Aditiva e idempotente. Gerada a partir de\n"
        "-- rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_tipos_atendimento_statements()) + "\n"

"""Schema do WFM — Turnos e Plantões (Fase 1, branch wfm).

Fonte ÚNICA do DDL: `ensure_wfm_schema(cursor)` roda no bootstrap de DEV e
`render_migration_sql()` gera `infra/sql/migrations/V046__wfm_turnos_plantoes.sql`
(um teste garante que os dois coincidem).

Regras:
  * Aditivo e idempotente; nada existente é alterado ou removido.
  * Toda tabela carrega `operacao` (chave de dbo.operacoes, NVARCHAR(60), o
    mesmo identificador da Monitoria). Todo acesso filtra por ela no servidor.
  * `wfm_escala_versoes` (histórico de publicações) e `wfm_auditoria` são
    IMUTÁVEIS por trigger INSTEAD OF UPDATE/DELETE. Publicar cria uma versão
    nova; nunca sobrescreve a anterior.
  * Atestado guarda só período, tipo e quem validou — NUNCA o arquivo nem CID
    (dado de saúde; SUPOSIÇÃO restritiva pendente de validação do DPO).
"""

from __future__ import annotations

TABELAS_IMUTAVEIS = ("wfm_escala_versoes", "wfm_auditoria")

# Tipos de escala do setor de TI semeados (o Analista de TI cadastra/edita/exclui os demais).
TIPOS_ESCALA_TI_PADRAO = (
    ("PLANTAO-SABADO", "Plantão de sábado", "Escala de plantão de sábado da equipe de TI."),
    ("SOBREAVISO", "Sobreaviso", "Escala de sobreaviso da equipe de TI."),
)

_TABELAS: list[tuple[str, str]] = [
    (
        "wfm_contratos",
        """
        id_contrato INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        codigo NVARCHAR(30) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        jornada_diaria_max_min INT NOT NULL,
        interjornada_min_min INT NOT NULL,
        max_dias_consecutivos INT NOT NULL,
        jornada_feriado_max_min INT NULL,
        jornada_bloqueio_duro BIT NOT NULL CONSTRAINT DF_wfm_contratos_duro DEFAULT 0,
        exigencias_pausa_json NVARCHAR(MAX) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_contratos_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_contratos_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_contratos UNIQUE (operacao, codigo)
        """,
    ),
    (
        "wfm_turnos",
        """
        id_turno INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        codigo NVARCHAR(20) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        tipo NVARCHAR(12) NOT NULL CONSTRAINT DF_wfm_turnos_tipo DEFAULT 'TRABALHO',
        cor NVARCHAR(9) NOT NULL CONSTRAINT DF_wfm_turnos_cor DEFAULT '#1f5fbf',
        entrada NVARCHAR(5) NULL,
        saida NVARCHAR(5) NULL,
        pausas_json NVARCHAR(MAX) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_turnos_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_turnos_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_turnos UNIQUE (operacao, codigo)
        """,
    ),
    (
        "wfm_skills",
        """
        id_skill INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        categoria NVARCHAR(20) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_skills_ativo DEFAULT 1,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_skills_criado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_skills UNIQUE (operacao, categoria, nome)
        """,
    ),
    (
        "wfm_usuario_skills",
        """
        operacao NVARCHAR(60) NOT NULL,
        id_usuario INT NOT NULL,
        id_skill INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_usuario_skills_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_wfm_usuario_skills PRIMARY KEY (operacao, id_usuario, id_skill)
        """,
    ),
    (
        "wfm_operador_contratos",
        """
        id_vinculo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        id_contrato INT NOT NULL,
        vigencia_ini DATE NOT NULL,
        vigencia_fim DATE NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_operador_contratos_criado_em DEFAULT GETDATE()
        """,
    ),
    (
        "wfm_calendario_especial",
        """
        id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        data_ini DATE NOT NULL,
        data_fim DATE NOT NULL,
        descricao NVARCHAR(200) NOT NULL,
        id_turno INT NULL,
        entrada NVARCHAR(5) NULL,
        saida NVARCHAR(5) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_calendario_especial_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_calendario_especial_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "wfm_escalas",
        """
        operacao NVARCHAR(60) NOT NULL,
        ano_mes NVARCHAR(7) NOT NULL,
        versao_publicada INT NOT NULL CONSTRAINT DF_wfm_escalas_versao DEFAULT 0,
        fechada BIT NOT NULL CONSTRAINT DF_wfm_escalas_fechada DEFAULT 0,
        fechada_por NVARCHAR(180) NULL,
        fechada_em DATETIME NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_escalas_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT PK_wfm_escalas PRIMARY KEY (operacao, ano_mes)
        """,
    ),
    (
        "wfm_escala_itens",
        """
        id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        ano_mes NVARCHAR(7) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        id_turno INT NOT NULL,
        versao_linha INT NOT NULL CONSTRAINT DF_wfm_escala_itens_versao DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_escala_itens_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_escala_itens UNIQUE (operacao, id_operador, data)
        """,
    ),
    (
        "wfm_escala_versoes",
        """
        id_versao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        ano_mes NVARCHAR(7) NOT NULL,
        versao INT NOT NULL,
        publicado_por INT NULL,
        publicado_por_nome NVARCHAR(180) NULL,
        publicado_em DATETIME NOT NULL CONSTRAINT DF_wfm_escala_versoes_publicado_em DEFAULT GETDATE(),
        com_violacao BIT NOT NULL CONSTRAINT DF_wfm_escala_versoes_violacao DEFAULT 0,
        justificativa NVARCHAR(400) NULL,
        violacoes_json NVARCHAR(MAX) NULL,
        snapshot_json NVARCHAR(MAX) NOT NULL,
        CONSTRAINT UQ_wfm_escala_versoes UNIQUE (operacao, ano_mes, versao)
        """,
    ),
    (
        "wfm_presencas",
        """
        id_presenca INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        status NVARCHAR(20) NOT NULL,
        observacao NVARCHAR(300) NULL,
        lancado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_presencas_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_presencas UNIQUE (operacao, id_operador, data)
        """,
    ),
    (
        "wfm_atestados",
        """
        id_atestado INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data_ini DATE NOT NULL,
        data_fim DATE NOT NULL,
        tipo NVARCHAR(30) NOT NULL,
        validado_por NVARCHAR(180) NOT NULL,
        validado_em DATETIME NOT NULL CONSTRAINT DF_wfm_atestados_validado_em DEFAULT GETDATE()
        """,
    ),
    (
        "wfm_auditoria",
        """
        id_auditoria INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_usuario INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        perfil NVARCHAR(40) NULL,
        acao NVARCHAR(40) NOT NULL,
        entidade NVARCHAR(40) NOT NULL,
        entidade_id NVARCHAR(60) NULL,
        antes_json NVARCHAR(MAX) NULL,
        depois_json NVARCHAR(MAX) NULL,
        justificativa NVARCHAR(400) NULL,
        ip NVARCHAR(64) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_auditoria_criado_em DEFAULT GETDATE()
        """,
    ),
]

_INDICES: list[tuple[str, str, str]] = [
    ("IX_wfm_escala_itens_periodo", "wfm_escala_itens", "operacao, ano_mes, id_operador"),
    ("IX_wfm_presencas_data", "wfm_presencas", "operacao, data"),
    ("IX_wfm_auditoria_operacao", "wfm_auditoria", "operacao, criado_em"),
    ("IX_wfm_calendario_periodo", "wfm_calendario_especial", "operacao, data_ini, data_fim"),
    ("IX_wfm_operador_contratos", "wfm_operador_contratos", "operacao, id_operador, vigencia_ini"),
]


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").splitlines())
    return (
        f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\n"
        f"BEGIN\n"
        f"    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\n"
        f"END;"
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
    instrucoes = [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    instrucoes += [_index_sql(*item) for item in _INDICES]
    instrucoes += [_trigger_sql(tabela) for tabela in TABELAS_IMUTAVEIS]
    return instrucoes


def ensure_wfm_schema(cursor) -> None:
    for instrucao in schema_statements() + schema_trocas_statements() + schema_ajustes_statements() + schema_pausas_statements() + schema_horarios_statements() + schema_aprovacao_ti_statements() + schema_config_escala_statements() + schema_gestao_escalas_statements() + schema_troca_antecedencia_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM (Turnos e Plantoes), Fase 1. Aditiva e idempotente: nao altera nem\n"
        "-- remove dados existentes. Gerada a partir de rh_api/repositories/wfm_schema.py (um\n"
        "-- teste garante que coincide com o bootstrap runtime). wfm_escala_versoes e\n"
        "-- wfm_auditoria recebem trigger INSTEAD OF UPDATE/DELETE (imutaveis).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


# ---------------------------------------------------------------------------
# Trocas de plantão (V047, branch wfm). Separada da V046 para não alterá-la.
# `wfm_trocas` é mutável (estado do fluxo); `wfm_trocas_eventos` é o histórico imutável.
# ---------------------------------------------------------------------------
TABELAS_IMUTAVEIS_TROCAS = ("wfm_trocas_eventos",)

_TABELAS_TROCAS: list[tuple[str, str]] = [
    (
        "wfm_trocas",
        """
        id_troca INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_solicitante INT NOT NULL,
        id_alvo INT NOT NULL,
        data_a DATE NOT NULL,
        data_b DATE NOT NULL,
        estado NVARCHAR(24) NOT NULL,
        motivo NVARCHAR(300) NULL,
        prazo_resposta DATETIME NOT NULL,
        prazo_decisao DATETIME NULL,
        base_json NVARCHAR(MAX) NOT NULL,
        alertas_json NVARCHAR(MAX) NULL,
        bloqueios_json NVARCHAR(MAX) NULL,
        decidido_por NVARCHAR(180) NULL,
        decidido_em DATETIME NULL,
        justificativa NVARCHAR(400) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_trocas_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_trocas_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "wfm_trocas_eventos",
        """
        id_evento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_troca INT NOT NULL,
        evento NVARCHAR(40) NOT NULL,
        por_id INT NULL,
        por_nome NVARCHAR(180) NULL,
        detalhe NVARCHAR(600) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_trocas_eventos_criado_em DEFAULT GETDATE()
        """,
    ),
]

_INDICES_TROCAS: list[tuple[str, str, str]] = [
    ("IX_wfm_trocas_estado", "wfm_trocas", "operacao, estado"),
    ("IX_wfm_trocas_operadores", "wfm_trocas", "id_solicitante, id_alvo"),
    ("IX_wfm_trocas_eventos", "wfm_trocas_eventos", "id_troca"),
]


def schema_trocas_statements() -> list[str]:
    instrucoes = [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS_TROCAS]
    instrucoes += [_index_sql(*item) for item in _INDICES_TROCAS]
    instrucoes += [_trigger_sql(tabela) for tabela in TABELAS_IMUTAVEIS_TROCAS]
    return instrucoes


def render_migration_trocas_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM: solicitacao de troca de plantoes. Aditiva e idempotente. Gerada a partir de\n"
        "-- rh_api/repositories/wfm_schema.py (um teste garante que coincide com o bootstrap).\n"
        "-- wfm_trocas_eventos recebe trigger INSTEAD OF UPDATE/DELETE (historico imutavel).\n\n"
    )
    return cabecalho + "\n\n".join(schema_trocas_statements()) + "\n"


# ---------------------------------------------------------------------------
# Ajustes (V048): alarga wfm_presencas.status (12 -> 20; 'FALTA_JUSTIFICADA' tem 17). Idempotente.
# Bancos criados pela V046 original ficam com NVARCHAR(12); os novos já nascem com 20.
# ---------------------------------------------------------------------------
def schema_ajustes_statements() -> list[str]:
    return [
        "IF OBJECT_ID('dbo.wfm_presencas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_presencas', 'status') < 40\n"
        "BEGIN\n    ALTER TABLE dbo.wfm_presencas ALTER COLUMN status NVARCHAR(20) NOT NULL;\nEND;"
    ]


def render_migration_ajustes_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM: ajustes de schema (alarga wfm_presencas.status para NVARCHAR(20)).\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py (teste garante que coincide).\n\n"
    )
    return cabecalho + "\n\n".join(schema_ajustes_statements()) + "\n"


# ---------------------------------------------------------------------------
# V049: turno-modelo ligado a contrato, capacidade de pausas por operação e escala de pausas
# individual (cada operador tem 3 pausas por dia: 2 de 10 min e 1 de 20 min). Aditiva e idempotente.
# ---------------------------------------------------------------------------
_TABELAS_PAUSAS: list[tuple[str, str]] = [
    (
        "wfm_operacao_config",
        """
        operacao NVARCHAR(60) NOT NULL PRIMARY KEY,
        pausas_simultaneas INT NOT NULL CONSTRAINT DF_wfm_operacao_config_simult DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_operacao_config_atualizado_em DEFAULT GETDATE()
        """,
    ),
    (
        "wfm_pausas",
        """
        id_pausa INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        ordem INT NOT NULL,
        tipo NVARCHAR(12) NOT NULL,
        inicio NVARCHAR(5) NOT NULL,
        duracao_min INT NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_pausas_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_pausas UNIQUE (operacao, id_operador, data, ordem)
        """,
    ),
]


def schema_pausas_statements() -> list[str]:
    instrucoes = [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS_PAUSAS]
    instrucoes.append(
        "IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'id_contrato') IS NULL\n"
        "BEGIN\n    ALTER TABLE dbo.wfm_turnos ADD id_contrato INT NULL;\nEND;"
    )
    instrucoes.append(_index_sql("IX_wfm_pausas_dia", "wfm_pausas", "operacao, data"))
    return instrucoes


def render_migration_pausas_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM: turno-modelo ligado a contrato, capacidade de pausas por operacao e escala de\n"
        "-- pausas individual. Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_pausas_statements()) + "\n"


# ---------------------------------------------------------------------------
# V050: horário ajustado por dia (ex.: sábado flexível) na escala e lançamento de hora extra.
# Aditiva e idempotente.
# ---------------------------------------------------------------------------
_TABELAS_HORARIOS: list[tuple[str, str]] = [
    (
        "wfm_horas_extras",
        """
        id_hora_extra INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        minutos INT NOT NULL,
        observacao NVARCHAR(200) NULL,
        lancado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_horas_extras_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_horas_extras UNIQUE (operacao, id_operador, data)
        """,
    ),
]


def schema_horarios_statements() -> list[str]:
    instrucoes = []
    for tabela, coluna, tipo in (
        ("wfm_escala_itens", "entrada_ajuste", "NVARCHAR(5)"),
        ("wfm_escala_itens", "saida_ajuste", "NVARCHAR(5)"),
        ("wfm_turnos", "id_supervisor", "INT"),  # supervisor responsável pelo turno (a equipe vem do supervisor)
    ):
        instrucoes.append(
            f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL AND COL_LENGTH('dbo.{tabela}', '{coluna}') IS NULL\n"
            f"BEGIN\n    ALTER TABLE dbo.{tabela} ADD {coluna} {tipo} NULL;\nEND;"
        )
    instrucoes += [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS_HORARIOS]
    instrucoes.append(_index_sql("IX_wfm_horas_extras_data", "wfm_horas_extras", "operacao, data"))
    return instrucoes


def render_migration_horarios_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM: horario ajustado por dia na escala (entrada_ajuste/saida_ajuste) e lancamento de\n"
        "-- hora extra. Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_horarios_statements()) + "\n"


# ---------------------------------------------------------------------------
# V051: aprovação da escala antes da publicação (Gestor/Supervisor) e setor de Tecnologia (TI) com
# tipos de escala cadastráveis (Plantão de sábado, Sobreaviso...). Aditiva e idempotente.
# ---------------------------------------------------------------------------
_TABELAS_TI: list[tuple[str, str]] = [
    (
        "wfm_tipos_escala",
        """
        id_tipo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao_base NVARCHAR(60) NOT NULL,
        chave NVARCHAR(60) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        descricao NVARCHAR(200) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_tipos_escala_ativo DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_tipos_escala_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_tipos_escala_chave UNIQUE (chave)
        """,
    ),
]

_COLUNAS_APROVACAO = (
    ("aprov_estado", "NVARCHAR(20) NOT NULL CONSTRAINT DF_wfm_escalas_aprov_estado DEFAULT 'RASCUNHO'"),
    ("aprov_enviado_por", "INT NULL"),
    ("aprov_enviado_nome", "NVARCHAR(180) NULL"),
    ("aprov_enviado_em", "DATETIME NULL"),
    ("aprov_decidido_por", "NVARCHAR(180) NULL"),
    ("aprov_decidido_em", "DATETIME NULL"),
    ("aprov_motivo", "NVARCHAR(400) NULL"),
    ("aprov_hash", "NVARCHAR(64) NULL"),
)

_OPERACAO_TI_SQL = (
    "IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.operacoes WHERE chave = 'TI')\n"
    "BEGIN\n    INSERT INTO dbo.operacoes (chave, nome, descricao, categoria, payload_json, ativo, usado)\n"
    "    VALUES ('TI', N'Tecnologia (TI)', NULL, N'Tecnologia', N'{}', 1, 1);\nEND;"
)


def _tipos_padrao_ti_sql() -> str:
    linhas = []
    for chave, nome, descricao in TIPOS_ESCALA_TI_PADRAO:
        linhas.append(
            f"IF NOT EXISTS (SELECT 1 FROM dbo.wfm_tipos_escala WHERE chave = 'TI::{chave}')\n"
            f"    INSERT INTO dbo.wfm_tipos_escala (operacao_base, chave, nome, descricao, criado_por)\n"
            f"    VALUES ('TI', 'TI::{chave}', N'{nome}', N'{descricao}', 'sistema');"
        )
    return "IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NOT NULL\nBEGIN\n" + "\n".join(linhas) + "\nEND;"


def schema_aprovacao_ti_statements() -> list[str]:
    instrucoes = []
    for coluna, definicao in _COLUNAS_APROVACAO:
        instrucoes.append(
            f"IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', '{coluna}') IS NULL\n"
            f"BEGIN\n    ALTER TABLE dbo.wfm_escalas ADD {coluna} {definicao};\nEND;"
        )
    instrucoes += [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS_TI]
    instrucoes.append(_OPERACAO_TI_SQL)
    instrucoes.append(_tipos_padrao_ti_sql())
    return instrucoes


def render_migration_aprovacao_ti_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM: aprovacao da escala antes da publicacao e setor de Tecnologia (TI) com tipos de\n"
        "-- escala cadastraveis. Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_aprovacao_ti_statements()) + "\n"


# ---------------------------------------------------------------------------
# V052: nome da escala e quem aprova (perfis e/ou usuários) por escala/operação. Aditiva e idempotente.
# Sem linhas em wfm_aprovadores vale o padrão: Supervisor ou Gestor.
# ---------------------------------------------------------------------------
_TABELAS_CONFIG_ESCALA: list[tuple[str, str]] = [
    (
        "wfm_aprovadores",
        """
        id_aprovador INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        tipo NVARCHAR(10) NOT NULL,
        valor NVARCHAR(60) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_aprovadores_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_aprovadores UNIQUE (operacao, tipo, valor)
        """,
    ),
]


def schema_config_escala_statements() -> list[str]:
    instrucoes = [
        "IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'nome_escala') IS NULL@@N@@"
        "BEGIN@@N@@    ALTER TABLE dbo.wfm_operacao_config ADD nome_escala NVARCHAR(120) NULL;@@N@@END;".replace("@@N@@", chr(10))
    ]
    instrucoes += [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS_CONFIG_ESCALA]
    return instrucoes


def render_migration_config_escala_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM: nome da escala e aprovadores (perfis/usuarios) por escala. Aditiva e idempotente.@@N@@"
        "-- Gerada de rh_api/repositories/wfm_schema.py.@@N@@@@N@@".replace("@@N@@", chr(10))
    )
    return cabecalho + (chr(10) * 2).join(schema_config_escala_statements()) + chr(10)


# ---------------------------------------------------------------------------
# V053: gestão de escalas — ativar/desativar a escala principal da operação e jornada (contrato) padrão da escala.
# Escalas criadas pelo usuário reutilizam wfm_tipos_escala (ativo já existe ali). Aditiva e idempotente.
# ---------------------------------------------------------------------------
def schema_gestao_escalas_statements() -> list[str]:
    nl = chr(10)
    return [
        "IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'ativa') IS NULL" + nl
        + "BEGIN" + nl + "    ALTER TABLE dbo.wfm_operacao_config ADD ativa BIT NOT NULL CONSTRAINT DF_wfm_operacao_config_ativa DEFAULT 1;" + nl + "END;",
        "IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'id_contrato') IS NULL" + nl
        + "BEGIN" + nl + "    ALTER TABLE dbo.wfm_operacao_config ADD id_contrato INT NULL;" + nl + "END;",
        "IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'excluida') IS NULL" + nl
        + "BEGIN" + nl + "    ALTER TABLE dbo.wfm_operacao_config ADD excluida BIT NOT NULL CONSTRAINT DF_wfm_operacao_config_excluida DEFAULT 0;" + nl + "END;",
        "IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'excluido') IS NULL" + nl
        + "BEGIN" + nl + "    ALTER TABLE dbo.wfm_turnos ADD excluido BIT NOT NULL CONSTRAINT DF_wfm_turnos_excluido DEFAULT 0;" + nl + "END;",
        "IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_wfm_turnos')" + nl
        + "BEGIN" + nl + "    ALTER TABLE dbo.wfm_turnos DROP CONSTRAINT UQ_wfm_turnos;" + nl + "END;",
        "IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_wfm_turnos_codigo' AND object_id = OBJECT_ID('dbo.wfm_turnos'))" + nl
        + "BEGIN" + nl + "    CREATE UNIQUE INDEX UX_wfm_turnos_codigo ON dbo.wfm_turnos (operacao, codigo) WHERE excluido = 0;" + nl + "END;",
    ]


# ---------------------------------------------------------------------------
# V054: antecedência mínima (em dias) para pedir troca de plantão, configurável por escala (padrão 3). Aditiva e idempotente.
# ---------------------------------------------------------------------------
def schema_troca_antecedencia_statements() -> list[str]:
    nl = chr(10)
    return [
        "IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'troca_antecedencia_dias') IS NULL" + nl
        + "BEGIN" + nl + "    ALTER TABLE dbo.wfm_operacao_config ADD troca_antecedencia_dias INT NOT NULL CONSTRAINT DF_wfm_operacao_config_troca_ant DEFAULT 3;" + nl + "END;",
    ]


def render_migration_troca_antecedencia_sql() -> str:
    nl = chr(10)
    cabecalho = (
        "-- Conecta - WFM: antecedencia minima (dias) para pedir troca de plantao, configuravel por escala (padrao 3)." + nl
        + "-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py." + nl + nl
    )
    return cabecalho + (nl * 2).join(schema_troca_antecedencia_statements()) + nl


def render_migration_gestao_escalas_sql() -> str:
    nl = chr(10)
    cabecalho = (
        "-- Conecta - WFM: escala ativa/inativa, excluida (logica) e jornada padrao da escala; turno excluido (logico) e codigo reutilizavel." + nl
        + "-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py." + nl + nl
    )
    return cabecalho + (nl * 2).join(schema_gestao_escalas_statements()) + nl

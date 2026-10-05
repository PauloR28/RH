"""Schema V060 dos Chamados / módulos: reabertura, "resolvido remotamente", lembretes por e-mail e acesso a módulos por perfil/usuário.

Fonte ÚNICA do DDL: `ensure_chamados_v060(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V060__chamados_reabertura_modulos.sql` (um teste garante que coincidem). A V059 é imutável, por isso
tudo que muda nela entra aqui. Aditivo e idempotente; nenhum dado existente é apagado.

  * chamados.resolvido_remotamente / reaberto_vezes / reaberto_ultimo_em / parado_notificado_em
  * CK de chamado_eventos.tipo ganha 'reabertura' (a reabertura mantém o MESMO chamado: mesmo id e número)
  * chamado_email_destinatarios: quem recebe e-mail de alerta e de quais tipos
  * chamado_config: janela de reabertura e parâmetros de lembrete (só seed; nada fixo no código)
  * modulos_acesso_perfil / modulos_acesso_usuario: módulos liberados por perfil ou usuário (somam ao que as permissões já abrem)
"""

from __future__ import annotations

CONFIG_V060 = (
    ("reabertura_dias", "7"),  # janela, em dias após resolver/encerrar, em que o solicitante pode reabrir (0 = reabertura desligada)
    ("lembrete_email_ativo", "1"),
    ("lembrete_sla_horas_antes", "1"),  # avisa por e-mail quando faltar até N horas para o SLA estourar
    ("lembrete_parado_horas", "72"),  # avisa quando o chamado fica N horas aberto sem movimentação
)

_COLUNAS_CHAMADOS = (
    ("resolvido_remotamente", "BIT NOT NULL CONSTRAINT DF_chamados_resolvido_remoto DEFAULT 0"),
    ("reaberto_vezes", "INT NOT NULL CONSTRAINT DF_chamados_reaberto_vezes DEFAULT 0"),
    ("reaberto_ultimo_em", "DATETIME2 NULL"),
    ("parado_notificado_em", "DATETIME2 NULL"),
)
_DEFAULTS_CHAMADOS = ("DF_chamados_resolvido_remoto", "DF_chamados_reaberto_vezes")

_TABELAS: list[tuple[str, str]] = [
    (
        "chamado_email_destinatarios",
        """
        id_destinatario INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_email_destinatarios PRIMARY KEY,
        email NVARCHAR(180) NOT NULL,
        nome NVARCHAR(120) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_chamado_email_dest_ativo DEFAULT 1,
        notif_novo BIT NOT NULL CONSTRAINT DF_chamado_email_dest_novo DEFAULT 0,
        notif_sla_proximo BIT NOT NULL CONSTRAINT DF_chamado_email_dest_sla_prox DEFAULT 1,
        notif_sla_vencido BIT NOT NULL CONSTRAINT DF_chamado_email_dest_sla_venc DEFAULT 1,
        notif_parado BIT NOT NULL CONSTRAINT DF_chamado_email_dest_parado DEFAULT 1,
        notif_reaberto BIT NOT NULL CONSTRAINT DF_chamado_email_dest_reaberto DEFAULT 0,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_email_dest_criado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_chamado_email_destinatarios_email UNIQUE (email)
        """,
    ),
    (
        "modulos_acesso_perfil",
        """
        id_perfil NVARCHAR(40) NOT NULL,
        modulo NVARCHAR(30) NOT NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_modulos_acesso_perfil_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_modulos_acesso_perfil PRIMARY KEY (id_perfil, modulo)
        """,
    ),
    (
        "modulos_acesso_usuario",
        """
        id_usuario INT NOT NULL,
        modulo NVARCHAR(30) NOT NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_modulos_acesso_usuario_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_modulos_acesso_usuario PRIMARY KEY (id_usuario, modulo)
        """,
    ),
]

# Tipos de evento da V059 + 'reabertura'.
_TIPOS_V059 = ("mensagem", "status", "atribuicao", "anexo", "urgencia", "sistema")
_TIPOS_EVENTO = _TIPOS_V059 + ("reabertura",)


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").rstrip().splitlines())
    return f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\nBEGIN\n    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\nEND;"


def _ck_eventos(tipos: tuple[str, ...]) -> str:
    lista = ",".join(f"''{t}''" for t in tipos)
    return f"    EXEC(N'ALTER TABLE dbo.chamado_eventos ADD CONSTRAINT CK_chamado_eventos_tipo CHECK (tipo IN ({lista}))');\n"


_DROP_CK_EVENTOS = (
    "    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_chamado_eventos_tipo' AND parent_object_id = OBJECT_ID('dbo.chamado_eventos'))\n"
    "        ALTER TABLE dbo.chamado_eventos DROP CONSTRAINT CK_chamado_eventos_tipo;\n"
)


def schema_statements() -> list[str]:
    instrucoes = []
    for coluna, definicao in _COLUNAS_CHAMADOS:
        instrucoes.append(
            f"IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND COL_LENGTH('dbo.chamados', '{coluna}') IS NULL\n"
            f"BEGIN\n    ALTER TABLE dbo.chamados ADD {coluna} {definicao};\nEND;"
        )
    # A CK da V059 não conhece 'reabertura': recria só quando ainda não a contém (idempotente).
    instrucoes.append(
        "IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NOT NULL\n"
        "   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_chamado_eventos_tipo' AND parent_object_id = OBJECT_ID('dbo.chamado_eventos') AND definition LIKE '%reabertura%')\n"
        "BEGIN\n" + _DROP_CK_EVENTOS + _ck_eventos(_TIPOS_EVENTO) + "END;"
    )
    instrucoes += [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    for chave, valor in CONFIG_V060:
        instrucoes.append(
            "IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL\n"
            f"   AND NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = '{chave}')\n"
            f"    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('{chave}', '{valor}');"
        )
    return instrucoes


def ensure_chamados_v060(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Chamados V060: reabertura, resolvido remotamente, lembretes por e-mail e acesso a modulos por perfil/usuario.\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/chamados_schema_v060.py (um teste garante que coincide com o bootstrap).\n"
        "-- A V059 permanece intocada; tudo que muda nela entra aqui.\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    linhas = [
        "-- Rollback da V060. Recusa se algum chamado foi reaberto (o historico de reabertura seria perdido).",
        "IF COL_LENGTH('dbo.chamados', 'reaberto_vezes') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.chamados WHERE reaberto_vezes > 0)",
        "    THROW 50000, 'Existem chamados reabertos: exporte os dados antes do rollback.', 1;",
        "IF OBJECT_ID('dbo.modulos_acesso_usuario', 'U') IS NOT NULL DROP TABLE dbo.modulos_acesso_usuario;",
        "IF OBJECT_ID('dbo.modulos_acesso_perfil', 'U') IS NOT NULL DROP TABLE dbo.modulos_acesso_perfil;",
        "IF OBJECT_ID('dbo.chamado_email_destinatarios', 'U') IS NOT NULL DROP TABLE dbo.chamado_email_destinatarios;",
        "IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL",
        "    DELETE FROM dbo.chamado_config WHERE chave IN (" + ", ".join(f"'{c}'" for c, _ in CONFIG_V060) + ");",
        "IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NOT NULL",
        "BEGIN",
        "    DELETE FROM dbo.chamado_eventos WHERE tipo = 'reabertura';",
    ]
    texto = "\n".join(linhas) + "\n" + _DROP_CK_EVENTOS + _ck_eventos(_TIPOS_V059) + "END;\n"
    for nome in _DEFAULTS_CHAMADOS:
        texto += f"IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = '{nome}') ALTER TABLE dbo.chamados DROP CONSTRAINT {nome};\n"
    for coluna, _ in _COLUNAS_CHAMADOS:
        texto += f"IF COL_LENGTH('dbo.chamados', '{coluna}') IS NOT NULL ALTER TABLE dbo.chamados DROP COLUMN {coluna};\n"
    return texto

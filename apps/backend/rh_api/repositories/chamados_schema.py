"""Schema dos Chamados (Suporte TI) — V059. Fonte ÚNICA do DDL: `ensure_chamados_schema(cursor)` roda no bootstrap e
`render_migration_sql()` gera `infra/sql/migrations/V059__chamados.sql` (um teste garante que coincidem).

Aditivo e idempotente; nada existente é alterado ou removido.
Datas em DATETIME2 UTC (`SYSUTCDATETIME()`), convenção só deste módulo (o resto do Conecta grava `GETDATE()`).
Status e urgência são códigos ASCII (aberto, em_andamento..., baixa/media/alta/critica): o rótulo acentuado
é da camada de apresentação, e a migration fica imune à página de código do sqlcmd.
A operação do chamado é a CHAVE da operação (NVARCHAR(60)), o mesmo identificador de `usuarios_operacoes`, WFM e Monitoria.
"""

from __future__ import annotations

from ..modulos_catalogo import abre_modulo_padrao, modulo_dono_padrao

CATEGORIAS_PADRAO = (
    ("Hardware", 10),
    ("Software/Sistemas", 20),
    ("Rede/Internet", 30),
    ("Telefonia", 40),
    ("Acessos/Login", 50),
    ("Outros", 99),
)

# chave, valor padrão. Nenhum prazo fica fixo no código: estes são só o seed.
CONFIG_PADRAO = (
    ("sla_horas_critica", "2"),
    ("sla_horas_alta", "4"),
    ("sla_horas_media", "8"),
    ("sla_horas_baixa", "24"),
    ("encerramento_auto_horas", "48"),
    ("anexo_max_mb", "25"),
    ("anexo_max_mb_chamado", "100"),
    ("anexo_retencao_exclusao_dias", "30"),
)

_TABELAS: list[tuple[str, str]] = [
    (
        "chamado_categorias",
        """
        id_categoria INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_categorias PRIMARY KEY,
        nome NVARCHAR(80) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_chamado_categorias_ativo DEFAULT 1,
        ordem INT NOT NULL CONSTRAINT DF_chamado_categorias_ordem DEFAULT 0,
        CONSTRAINT UQ_chamado_categorias_nome UNIQUE (nome)
        """,
    ),
    (
        "chamado_config",
        """
        chave NVARCHAR(60) NOT NULL CONSTRAINT PK_chamado_config PRIMARY KEY,
        valor NVARCHAR(200) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_config_atualizado_em DEFAULT SYSUTCDATETIME()
        """,
    ),
    (
        "chamados",
        """
        id_chamado BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamados PRIMARY KEY,
        numero INT NOT NULL CONSTRAINT DF_chamados_numero DEFAULT (NEXT VALUE FOR dbo.seq_chamado_numero),
        titulo NVARCHAR(160) NOT NULL,
        descricao NVARCHAR(MAX) NOT NULL,
        id_categoria INT NOT NULL CONSTRAINT FK_chamados_categoria REFERENCES dbo.chamado_categorias(id_categoria),
        operacao NVARCHAR(60) NOT NULL,
        id_solicitante INT NOT NULL,
        solicitante_nome NVARCHAR(180) NOT NULL,
        solicitante_email NVARCHAR(180) NULL,
        solicitante_cargo NVARCHAR(120) NULL,
        id_responsavel INT NULL,
        tipo_impacto NVARCHAR(10) NOT NULL,
        pa_posto NVARCHAR(40) NULL,
        pa_parada BIT NOT NULL CONSTRAINT DF_chamados_pa_parada DEFAULT 0,
        urgencia NVARCHAR(10) NOT NULL,
        urgencia_solicitada NVARCHAR(10) NOT NULL,
        status NVARCHAR(24) NOT NULL CONSTRAINT DF_chamados_status DEFAULT 'aberto',
        prazo_sla DATETIME2 NOT NULL,
        sla_pausado_seg INT NOT NULL CONSTRAINT DF_chamados_sla_pausado DEFAULT 0,
        sla_pausa_inicio DATETIME2 NULL,
        resolvido_em DATETIME2 NULL,
        encerrado_em DATETIME2 NULL,
        encerramento_automatico BIT NOT NULL CONSTRAINT DF_chamados_enc_auto DEFAULT 0,
        sla_aviso_notificado_em DATETIME2 NULL,
        sla_vencido_notificado_em DATETIME2 NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamados_criado_em DEFAULT SYSUTCDATETIME(),
        atualizado_em DATETIME2 NOT NULL CONSTRAINT DF_chamados_atualizado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_chamados_numero UNIQUE (numero),
        CONSTRAINT CK_chamados_status CHECK (status IN ('aberto','em_andamento','aguardando_solicitante','resolvido','encerrado','cancelado')),
        CONSTRAINT CK_chamados_urgencia CHECK (urgencia IN ('baixa','media','alta','critica')),
        CONSTRAINT CK_chamados_impacto CHECK (tipo_impacto IN ('agente','celula'))
        """,
    ),
    (
        "chamado_agentes",
        """
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_agentes_chamado REFERENCES dbo.chamados(id_chamado),
        id_usuario INT NOT NULL,
        CONSTRAINT PK_chamado_agentes PRIMARY KEY (id_chamado, id_usuario)
        """,
    ),
    (
        "chamado_eventos",
        """
        id_evento BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_eventos PRIMARY KEY,
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_eventos_chamado REFERENCES dbo.chamados(id_chamado),
        id_autor INT NULL,
        autor_nome NVARCHAR(180) NULL,
        tipo NVARCHAR(12) NOT NULL,
        conteudo NVARCHAR(MAX) NULL,
        dados_json NVARCHAR(MAX) NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_eventos_criado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_chamado_eventos_tipo CHECK (tipo IN ('mensagem','status','atribuicao','anexo','urgencia','sistema'))
        """,
    ),
    (
        "chamado_anexos",
        """
        id_anexo BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_anexos PRIMARY KEY,
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_anexos_chamado REFERENCES dbo.chamados(id_chamado),
        id_evento BIGINT NULL,
        nome_original NVARCHAR(255) NOT NULL,
        mime NVARCHAR(120) NOT NULL,
        tamanho BIGINT NOT NULL,
        sha256 CHAR(64) NOT NULL,
        chave_storage NVARCHAR(260) NOT NULL,
        provider NVARCHAR(20) NOT NULL CONSTRAINT DF_chamado_anexos_provider DEFAULT 'local',
        enviado_por INT NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_anexos_criado_em DEFAULT SYSUTCDATETIME(),
        excluido_em DATETIME2 NULL,
        excluido_por INT NULL
        """,
    ),
    (
        "chamado_observadores",
        """
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_observadores_chamado REFERENCES dbo.chamados(id_chamado),
        id_usuario INT NOT NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_observadores_criado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_chamado_observadores PRIMARY KEY (id_chamado, id_usuario)
        """,
    ),
]

_INDICES: list[tuple[str, str, str, str]] = [
    ("IX_chamados_status", "chamados", "status, prazo_sla", ""),
    ("IX_chamados_responsavel", "chamados", "id_responsavel, status", ""),
    ("IX_chamados_solicitante", "chamados", "id_solicitante, status", ""),
    ("IX_chamados_operacao", "chamados", "operacao, status", ""),
    ("IX_chamados_prazo_aberto", "chamados", "prazo_sla", "WHERE status IN ('aberto','em_andamento','aguardando_solicitante','resolvido')"),
    ("IX_chamado_eventos_chamado", "chamado_eventos", "id_chamado, criado_em", ""),
    ("IX_chamado_anexos_chamado", "chamado_anexos", "id_chamado", ""),
]


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").rstrip().splitlines())
    return f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\nBEGIN\n    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\nEND;"


def _index_sql(nome: str, tabela: str, colunas: str, filtro: str) -> str:
    sufixo = f" {filtro}" if filtro else ""
    return (
        f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{nome}' AND object_id = OBJECT_ID('dbo.{tabela}'))\n"
        f"BEGIN\n    CREATE INDEX {nome} ON dbo.{tabela}({colunas}){sufixo};\nEND;"
    )


def _lit(texto: str) -> str:
    return texto.replace("'", "''")


def _nstr(texto: str) -> str:
    """Literal NVARCHAR 100% ASCII (acentos viram NCHAR), imune à página de código do sqlcmd (ver modulos_schema._nstr)."""
    partes, atual = [], ""
    for ch in texto:
        if ord(ch) < 128:
            atual += ch.replace("'", "''")
        else:
            if atual:
                partes.append(f"N'{atual}'")
                atual = ""
            partes.append(f"NCHAR({ord(ch)})")
    if atual or not partes:
        partes.append(f"N'{atual}'")
    return " + ".join(partes)


def _permissoes_chamados() -> list:
    from ..rbac import PERMISSION_DEFINITIONS

    return [d for chave, d in PERMISSION_DEFINITIONS.items() if chave.startswith("chamados.")]


def _perfis_iniciais() -> list[tuple[str, str]]:
    from ..rbac import ROLE_PERMISSIONS

    pares = []
    for perfil, chaves in sorted(ROLE_PERMISSIONS.items()):
        for chave in sorted(chaves):
            if chave.startswith("chamados."):
                pares.append((perfil, chave))
    return pares


def schema_statements() -> list[str]:
    instrucoes = [
        "IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_chamado_numero' AND schema_id = SCHEMA_ID('dbo'))\n"
        "BEGIN\n    CREATE SEQUENCE dbo.seq_chamado_numero AS INT START WITH 1 INCREMENT BY 1;\nEND;"
    ]
    instrucoes += [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    instrucoes += [_index_sql(*item) for item in _INDICES]
    for nome, ordem in CATEGORIAS_PADRAO:
        instrucoes.append(
            f"IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = {_nstr(nome)})\n"
            f"    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES ({_nstr(nome)}, 1, {ordem});"
        )
    for chave, valor in CONFIG_PADRAO:
        instrucoes.append(
            f"IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = '{chave}')\n"
            f"    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('{chave}', '{valor}');"
        )
    # Permissões do módulo (o bootstrap faz o mesmo em DEV; em PROD a migration garante as linhas). Só insere quando falta:
    # nunca sobrescreve dono/abre_modulo nem o que o admin marcou em Perfis e Permissões.
    for d in _permissoes_chamados():
        dono = modulo_dono_padrao(d.key, d.module)
        abre = 1 if abre_modulo_padrao(d.key) else 0
        instrucoes.append(
            "IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
            "BEGIN\n"
            f"    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = '{d.key}')\n"
            "        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)\n"
            f"        VALUES ('{d.key}', {_nstr(d.module)}, {_nstr(d.description)}, {1 if d.critical else 0}, GETDATE());\n"
            "END;"
        )
        instrucoes.append(
            "IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL\n"
            f"    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''{dono}'', abre_modulo = {abre} "
            f"WHERE chave = ''{d.key}'' AND modulo_dono IS NULL;');"
        )
    for perfil, chave in _perfis_iniciais():
        instrucoes.append(
            "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
            "BEGIN\n"
            f"    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = '{perfil}')\n"
            f"       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = '{chave}')\n"
            f"       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = '{perfil}' AND chave_permissao = '{chave}')\n"
            "        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)\n"
            f"        VALUES ('{perfil}', '{chave}', 1, GETDATE(), GETDATE());\n"
            "END;"
        )
    return instrucoes


def ensure_chamados_schema(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Chamados (Suporte TI), V059. Aditiva e idempotente: nao altera nem remove dados existentes.\n"
        "-- Gerada de rh_api/repositories/chamados_schema.py (um teste garante que coincide com o bootstrap runtime).\n"
        "-- Datas em UTC (DATETIME2/SYSUTCDATETIME). Insere as permissoes chamados.* e o seed inicial dos perfis\n"
        "-- apenas quando faltam (nunca sobrescreve o que foi editado em Perfis e Permissoes).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V059 (Chamados). Recusa se houver chamados; remove tabelas, sequence e permissoes chamados.*.\n"
        "IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.chamados)\n"
        "    THROW 50000, 'Existem chamados: exporte/remova os dados manualmente antes do rollback.', 1;\n"
        "IF OBJECT_ID('dbo.chamado_observadores', 'U') IS NOT NULL DROP TABLE dbo.chamado_observadores;\n"
        "IF OBJECT_ID('dbo.chamado_anexos', 'U') IS NOT NULL DROP TABLE dbo.chamado_anexos;\n"
        "IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NOT NULL DROP TABLE dbo.chamado_eventos;\n"
        "IF OBJECT_ID('dbo.chamado_agentes', 'U') IS NOT NULL DROP TABLE dbo.chamado_agentes;\n"
        "IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL DROP TABLE dbo.chamados;\n"
        "IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL DROP TABLE dbo.chamado_config;\n"
        "IF OBJECT_ID('dbo.chamado_categorias', 'U') IS NOT NULL DROP TABLE dbo.chamado_categorias;\n"
        "IF EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_chamado_numero') DROP SEQUENCE dbo.seq_chamado_numero;\n"
        "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao LIKE 'chamados.%';\n"
        "IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave LIKE 'chamados.%';\n"
    )

"""Schema do Painel (V072, 14/nov/2026). Fonte ÚNICA do DDL: `ensure_painel_schema(cursor)` roda na primeira necessidade e
`render_migration_sql()` gera `infra/sql/migrations/V072__painel.sql` (um teste garante que coincidem).

Aditivo e idempotente; nada existente é alterado ou removido.

Um painel = um MÓDULO + uma UNIDADE (operação/setor de `dbo.operacoes`). A Tecnologia escolhe as métricas (e a forma e a
ordem de cada uma), de quanto em quanto tempo a tela atualiza e quais perfis podem ver. Toda mudança fica em
`painel_alteracao` (antes -> depois).
"""

from __future__ import annotations

from ..modulos_catalogo import abre_modulo_padrao, modulo_dono_padrao

_TABELAS: list[tuple[str, str]] = [
    (
        "painel",
        """
        id_painel INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_painel PRIMARY KEY,
        modulo NVARCHAR(20) NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_painel_ativo DEFAULT 1,
        intervalo_seg INT NOT NULL CONSTRAINT DF_painel_intervalo DEFAULT 60,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_painel_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL,
        CONSTRAINT UQ_painel UNIQUE (modulo, operacao)
        """,
    ),
    (
        "painel_metrica",
        """
        id_painel INT NOT NULL CONSTRAINT FK_painel_metrica_painel REFERENCES dbo.painel(id_painel),
        metrica NVARCHAR(40) NOT NULL,
        forma NVARCHAR(30) NOT NULL,
        ordem INT NOT NULL,
        CONSTRAINT PK_painel_metrica PRIMARY KEY (id_painel, metrica)
        """,
    ),
    (
        "painel_perfil",
        """
        id_painel INT NOT NULL CONSTRAINT FK_painel_perfil_painel REFERENCES dbo.painel(id_painel),
        id_perfil NVARCHAR(40) NOT NULL,
        CONSTRAINT PK_painel_perfil PRIMARY KEY (id_painel, id_perfil)
        """,
    ),
    (
        "painel_alteracao",
        """
        id_alteracao BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_painel_alteracao PRIMARY KEY,
        id_painel INT NULL,
        acao NVARCHAR(20) NOT NULL,
        antes NVARCHAR(MAX) NULL,
        depois NVARCHAR(MAX) NULL,
        usuario_id INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_painel_alteracao_criado_em DEFAULT SYSDATETIME()
        """,
    ),
]

_INDICES: list[tuple[str, str, str]] = [
    ("IX_painel_alteracao_painel", "painel_alteracao", "id_painel, criado_em"),
]


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").rstrip().splitlines())
    return f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\nBEGIN\n    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\nEND;"


def _index_sql(nome: str, tabela: str, colunas: str) -> str:
    return (
        f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{nome}' AND object_id = OBJECT_ID('dbo.{tabela}'))\n"
        f"BEGIN\n    CREATE INDEX {nome} ON dbo.{tabela}({colunas});\nEND;"
    )


def _nstr(texto: str) -> str:
    """Literal NVARCHAR 100% ASCII (acentos viram NCHAR), imune à página de código do sqlcmd (ver diario_schema._nstr)."""
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


def _eh_do_painel(chave: str) -> bool:
    return chave.startswith(("painel.", "sessao.painel."))


def _permissoes_painel() -> list:
    from ..rbac import PERMISSION_DEFINITIONS

    return [d for chave, d in PERMISSION_DEFINITIONS.items() if _eh_do_painel(chave)]


def _perfis_iniciais() -> list[tuple[str, str]]:
    from ..rbac import ROLE_PERMISSIONS

    return [(perfil, chave) for perfil, chaves in sorted(ROLE_PERMISSIONS.items()) for chave in sorted(chaves) if _eh_do_painel(chave)]


def schema_statements() -> list[str]:
    instrucoes = [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    instrucoes += [_index_sql(*item) for item in _INDICES]
    # Permissões: só insere quando falta; nunca sobrescreve dono/abre_modulo nem o que o admin marcou em Perfis.
    for d in _permissoes_painel():
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


def ensure_painel_schema(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Painel (V072). Aditiva e idempotente: nao altera nem remove dados existentes.\n"
        "-- Gerada de rh_api/repositories/painel_schema.py (um teste garante que coincide com o bootstrap runtime).\n"
        "-- Tabelas painel_* (paineis por modulo e unidade, metricas, perfis que veem, alteracoes), permissoes painel.*\n"
        "-- e o valor inicial dos perfis, inseridos apenas quando faltam (nunca sobrescreve Perfis e Permissoes).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    linhas = ["-- Rollback da V072 (Painel). Remove tabelas painel_* e permissoes painel.* (a configuracao dos paineis se perde).\n"]
    for nome in ("painel_alteracao", "painel_perfil", "painel_metrica", "painel"):
        linhas.append(f"IF OBJECT_ID('dbo.{nome}', 'U') IS NOT NULL DROP TABLE dbo.{nome};\n")
    linhas.append(
        "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes "
        "WHERE chave_permissao LIKE 'painel.%' OR chave_permissao = 'sessao.painel.acessar';\n"
    )
    linhas.append("IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave LIKE 'painel.%' OR chave = 'sessao.painel.acessar';\n")
    return "".join(linhas)

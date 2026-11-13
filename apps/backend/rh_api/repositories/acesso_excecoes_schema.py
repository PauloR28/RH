"""Schema V071: exceções de acesso num lugar só (Central de Acessos, Etapa 5).

Uma linha = um ajuste ao padrão do perfil, para um PERFIL (opcionalmente só numa unidade) ou para uma PESSOA
(opcionalmente só numa unidade). `efeito` = 'conceder' (pode) ou 'retirar' (não pode). Precedência na regra única:
pessoa > perfil na unidade > padrão do perfil; no mesmo nível, 'retirar' vence. Nenhuma exceção reabre módulo ou função
desligados (a camada de fora sempre fecha).

Acesso extra a módulo (V060: `modulos_acesso_perfil` / `modulos_acesso_usuario`) é copiado para cá como a chave
`modulo.<chave>.abrir`. As tabelas antigas NÃO são apagadas e continuam sendo lidas até a última etapa.

Fonte ÚNICA do DDL: `ensure_acesso_excecoes(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V071__acesso_excecoes.sql` (um teste garante que coincidem). Aditiva, idempotente e reversível.
"""

from __future__ import annotations

EFEITOS = ("conceder", "retirar")
ALVOS = ("perfil", "usuario")
_T = "OBJECT_ID('dbo.acesso_excecoes', 'U') IS NOT NULL"

_CREATE = (
    "IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NULL\n"
    "BEGIN\n"
    "    CREATE TABLE dbo.acesso_excecoes (\n"
    "        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_acesso_excecoes PRIMARY KEY,\n"
    "        alvo_tipo NVARCHAR(10) NOT NULL,\n"
    "        id_perfil NVARCHAR(60) NULL,\n"
    "        id_usuario INT NULL,\n"
    "        unidade NVARCHAR(60) NULL,\n"
    "        unidade_chave AS ISNULL(unidade, N'') PERSISTED,\n"
    "        chave_permissao NVARCHAR(120) NOT NULL,\n"
    "        efeito NVARCHAR(10) NOT NULL,\n"
    "        motivo NVARCHAR(400) NULL,\n"
    "        criado_por NVARCHAR(180) NULL,\n"
    "        criado_em DATETIME NOT NULL CONSTRAINT DF_acesso_excecoes_criado_em DEFAULT GETDATE(),\n"
    "        CONSTRAINT CK_acesso_excecoes_efeito CHECK (efeito IN (N'conceder', N'retirar')),\n"
    "        CONSTRAINT CK_acesso_excecoes_alvo CHECK (\n"
    "            (alvo_tipo = N'perfil' AND id_perfil IS NOT NULL AND id_usuario IS NULL)\n"
    "            OR (alvo_tipo = N'usuario' AND id_usuario IS NOT NULL AND id_perfil IS NULL))\n"
    "    );\n"
    "END;"
)


def schema_statements() -> list[str]:
    return [
        _CREATE,
        f"IF {_T} AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_acesso_excecoes' AND object_id = OBJECT_ID('dbo.acesso_excecoes'))\n"
        "    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_acesso_excecoes ON dbo.acesso_excecoes "
        "(alvo_tipo, id_perfil, id_usuario, unidade_chave, chave_permissao);';",
        # Cópia dos acessos extras a módulo de hoje (V060). Só insere o que falta; nunca apaga as tabelas antigas.
        f"IF {_T} AND OBJECT_ID('dbo.modulos_acesso_perfil', 'U') IS NOT NULL\n"
        "    EXEC sp_executesql N'INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_perfil, chave_permissao, efeito, motivo, criado_por) "
        "SELECT N''perfil'', a.id_perfil, N''modulo.'' + a.modulo + N''.abrir'', N''conceder'', N''Copiado de modulos_acesso_perfil (V060)'', N''V071'' "
        "FROM dbo.modulos_acesso_perfil a WHERE NOT EXISTS (SELECT 1 FROM dbo.acesso_excecoes e WHERE e.alvo_tipo = N''perfil'' "
        "AND e.id_perfil = a.id_perfil AND e.unidade IS NULL AND e.chave_permissao = N''modulo.'' + a.modulo + N''.abrir'');';",
        f"IF {_T} AND OBJECT_ID('dbo.modulos_acesso_usuario', 'U') IS NOT NULL\n"
        "    EXEC sp_executesql N'INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_usuario, chave_permissao, efeito, motivo, criado_por) "
        "SELECT N''usuario'', a.id_usuario, N''modulo.'' + a.modulo + N''.abrir'', N''conceder'', N''Copiado de modulos_acesso_usuario (V060)'', N''V071'' "
        "FROM dbo.modulos_acesso_usuario a WHERE NOT EXISTS (SELECT 1 FROM dbo.acesso_excecoes e WHERE e.alvo_tipo = N''usuario'' "
        "AND e.id_usuario = a.id_usuario AND e.unidade IS NULL AND e.chave_permissao = N''modulo.'' + a.modulo + N''.abrir'');';",
    ]


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Central de Acessos, Etapa 5 (V071): excecoes de acesso num lugar so (perfil na unidade e pessoa).\n"
        "-- Copia os acessos extras a modulo da V060 sem apagar as tabelas antigas. Aditiva, idempotente e reversivel.\n"
        "-- Gerada de rh_api/repositories/acesso_excecoes_schema.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V071: remove a tabela de excecoes. Os acessos extras a modulo continuam nas tabelas da V060.\n"
        "IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NOT NULL\n    DROP TABLE dbo.acesso_excecoes;\n"
    )


def ensure_acesso_excecoes(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)

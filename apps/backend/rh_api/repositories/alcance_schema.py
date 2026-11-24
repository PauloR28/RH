"""Schema V074 (17/nov/2026, reestruturação Etapa 6): alcance de cada perfil gravado pela tela Acessos.

Fonte ÚNICA do DDL: `ensure_alcance_schema(cursor)` roda antes de gravar e `render_migration_sql()` gera
`infra/sql/migrations/V074__perfis_alcance.sql` (um teste garante que coincidem). Aditiva e idempotente.

  * perfis_alcance   uma linha por (perfil, área) que DIFERE do padrão do código (`rh_api/alcance.py`).
                     Sem linha = vale o padrão. area: wfm | monitoria | chamados. nivel: todos | unidade | equipe | proprio.
"""

from __future__ import annotations

_CREATE = (
    "IF OBJECT_ID('dbo.perfis_alcance', 'U') IS NULL\n"
    "BEGIN\n"
    "    CREATE TABLE dbo.perfis_alcance (\n"
    "        id_perfil NVARCHAR(40) NOT NULL,\n"
    "        area NVARCHAR(20) NOT NULL,\n"
    "        nivel NVARCHAR(10) NOT NULL,\n"
    "        atualizado_por NVARCHAR(180) NULL,\n"
    "        atualizado_em DATETIME2(0) NOT NULL CONSTRAINT DF_perfis_alcance_em DEFAULT SYSDATETIME(),\n"
    "        CONSTRAINT PK_perfis_alcance PRIMARY KEY (id_perfil, area),\n"
    "        CONSTRAINT CK_perfis_alcance_area CHECK (area IN ('wfm', 'monitoria', 'chamados')),\n"
    "        CONSTRAINT CK_perfis_alcance_nivel CHECK (nivel IN ('todos', 'unidade', 'equipe', 'proprio'))\n"
    "    );\n"
    "END;"
)


def schema_statements() -> list[str]:
    return [_CREATE]


def ensure_alcance_schema(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - V074: alcance de cada perfil (todos/unidade/equipe/proprio) por area, gravado pela tela Acessos.\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/alcance_schema.py (um teste garante que coincide).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V074. Remove a tabela de alcance: todos os perfis voltam ao alcance padrao do codigo.\n"
        "IF OBJECT_ID('dbo.perfis_alcance', 'U') IS NOT NULL DROP TABLE dbo.perfis_alcance;\n"
    )

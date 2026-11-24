"""Schema V075 (21/nov/2026, reestruturação Etapa 9): perfis no banco.

Fonte ÚNICA do DDL: `ensure_perfis_schema(cursor)` roda no bootstrap e antes de criar perfil, e `render_migration_sql()`
gera `infra/sql/migrations/V075__perfis_funciona_como.sql` (um teste garante que coincidem). Aditiva e idempotente.

  * perfis.funciona_como   para perfis criados pela tela (sistema = 0): o perfil do código com que ele funciona nas
                           regras sobre a pessoa (quem lidera equipe, quem é avaliado, quem entra na escala).
                           NULL nos 15 perfis do código (funcionam como eles mesmos).
"""

from __future__ import annotations

_COLUNA = (
    "IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'funciona_como') IS NULL\n"
    "    ALTER TABLE dbo.perfis ADD funciona_como NVARCHAR(40) NULL;"
)


def schema_statements() -> list[str]:
    return [_COLUNA]


def ensure_perfis_schema(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - V075: perfis no banco. Perfil criado pela tela diz com que perfil do codigo ele funciona.\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/perfis_schema.py (um teste garante que coincide).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V075. Apaga os perfis criados pela tela (e o que e deles) e tira a coluna funciona_como.\n"
        "-- Antes, mude de perfil quem estiver num perfil criado: o rollback nao mexe em usuarios.\n"
        "IF COL_LENGTH('dbo.perfis', 'funciona_como') IS NOT NULL\n"
        "BEGIN\n"
        "    EXEC('DELETE FROM dbo.perfil_permissoes WHERE id_perfil IN (SELECT id_perfil FROM dbo.perfis WHERE sistema = 0)');\n"
        "    EXEC('DELETE FROM dbo.perfis WHERE sistema = 0 AND id_perfil NOT IN (SELECT perfil_id FROM dbo.usuarios)');\n"
        "    ALTER TABLE dbo.perfis DROP COLUMN funciona_como;\n"
        "END;\n"
    )

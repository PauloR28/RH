"""Schema V070: Unidade = Operação ou Setor (Central de Acessos, Etapa 3).

Reaproveita `dbo.operacoes` (sem tabela nova): todo vínculo que já usa `operacoes.chave` continua igual
(`usuarios_operacoes`, WFM, Monitoria, Chamados, `operacoes_modulos`). Ganha duas colunas:

  * `tipo`   — 'operacao' ou 'setor'. Padrão 'operacao' (tudo que existe hoje é operação).
  * `modulo` — o ÚNICO módulo a que a unidade pertence (obrigatório). Padrão 'operacao'. Um módulo tem várias unidades;
               uma unidade pertence a um módulo só. Nunca 'core'. FK para `modulos_sistema` quando a tabela existe.

A operação técnica 'TI' (catálogo `OPERACAO_TI`) vira setor do módulo Tecnologia.

Fonte ÚNICA do DDL: `ensure_unidades(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V070__unidades_tipo_modulo.sql` (um teste garante que coincidem). Aditiva, idempotente e reversível.
Comandos que leem as colunas novas vão por `sp_executesql`, para compilar só depois que elas existirem (lote único no sqlcmd).
"""

from __future__ import annotations

from ..modulos_catalogo import MODULO_OPERACAO, MODULO_TECNOLOGIA, OPERACAO_TI

TIPOS_UNIDADE = ("operacao", "setor")
_T = "OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL"


def schema_statements() -> list[str]:
    return [
        f"IF {_T} AND COL_LENGTH('dbo.operacoes', 'tipo') IS NULL\n"
        "BEGIN\n"
        "    ALTER TABLE dbo.operacoes ADD tipo NVARCHAR(10) NOT NULL CONSTRAINT DF_operacoes_tipo DEFAULT 'operacao';\n"
        "END;",
        f"IF {_T} AND COL_LENGTH('dbo.operacoes', 'modulo') IS NULL\n"
        "BEGIN\n"
        f"    ALTER TABLE dbo.operacoes ADD modulo NVARCHAR(30) NOT NULL CONSTRAINT DF_operacoes_modulo DEFAULT '{MODULO_OPERACAO}';\n"
        "END;",
        f"IF {_T} AND OBJECT_ID('dbo.CK_operacoes_tipo', 'C') IS NULL\n"
        "    EXEC sp_executesql N'ALTER TABLE dbo.operacoes ADD CONSTRAINT CK_operacoes_tipo CHECK (tipo IN (''operacao'', ''setor''));';",
        f"IF {_T} AND OBJECT_ID('dbo.CK_operacoes_modulo', 'C') IS NULL\n"
        "    EXEC sp_executesql N'ALTER TABLE dbo.operacoes ADD CONSTRAINT CK_operacoes_modulo CHECK (modulo <> ''core'');';",
        # Semente: a operação técnica TI é setor da Tecnologia. Só mexe enquanto ainda está no padrão (não desfaz escolha manual).
        f"IF {_T}\n"
        f"    EXEC sp_executesql N'UPDATE dbo.operacoes SET tipo = ''setor'', modulo = ''{MODULO_TECNOLOGIA}'' "
        f"WHERE chave = ''{OPERACAO_TI}'' AND tipo = ''operacao'' AND modulo = ''{MODULO_OPERACAO}'';';",
        f"IF {_T} AND OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND OBJECT_ID('dbo.FK_operacoes_modulo', 'F') IS NULL\n"
        "    EXEC sp_executesql N'ALTER TABLE dbo.operacoes ADD CONSTRAINT FK_operacoes_modulo FOREIGN KEY (modulo) REFERENCES dbo.modulos_sistema (chave);';",
        f"IF {_T} AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_operacoes_modulo' AND object_id = OBJECT_ID('dbo.operacoes'))\n"
        "    EXEC sp_executesql N'CREATE INDEX IX_operacoes_modulo ON dbo.operacoes (modulo, ativo) INCLUDE (chave, nome, tipo);';",
    ]


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Central de Acessos, Etapa 3 (V070): Unidade = Operacao ou Setor, com tipo e modulo obrigatorio.\n"
        "-- Reaproveita dbo.operacoes; vinculos por operacoes.chave continuam iguais. Aditiva, idempotente e reversivel.\n"
        "-- Gerada de rh_api/repositories/unidades_schema.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V070: remove tipo e modulo das operacoes. Seguro: nenhuma rota antiga le essas colunas.\n"
        "IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_operacoes_modulo' AND object_id = OBJECT_ID('dbo.operacoes'))\n"
        "    DROP INDEX IX_operacoes_modulo ON dbo.operacoes;\n"
        "IF OBJECT_ID('dbo.FK_operacoes_modulo', 'F') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP CONSTRAINT FK_operacoes_modulo;\n"
        "IF OBJECT_ID('dbo.CK_operacoes_modulo', 'C') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP CONSTRAINT CK_operacoes_modulo;\n"
        "IF OBJECT_ID('dbo.CK_operacoes_tipo', 'C') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP CONSTRAINT CK_operacoes_tipo;\n"
        "IF OBJECT_ID('dbo.DF_operacoes_modulo', 'D') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP CONSTRAINT DF_operacoes_modulo;\n"
        "IF OBJECT_ID('dbo.DF_operacoes_tipo', 'D') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP CONSTRAINT DF_operacoes_tipo;\n"
        "IF COL_LENGTH('dbo.operacoes', 'modulo') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP COLUMN modulo;\n"
        "IF COL_LENGTH('dbo.operacoes', 'tipo') IS NOT NULL\n    ALTER TABLE dbo.operacoes DROP COLUMN tipo;\n"
    )


def ensure_unidades(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)

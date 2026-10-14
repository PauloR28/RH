"""Schema V062: funções que cada módulo exibe no menu (`dbo.modulos_funcoes`).

Fonte ÚNICA do DDL: `ensure_modulos_funcoes(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V062__modulos_funcoes.sql` (um teste garante que coincidem). Aditivo e idempotente; o seed só insere
as linhas que faltam, nunca sobrescreve uma escolha já feita em Tecnologia. O padrão reproduz o menu de antes.
"""

from __future__ import annotations

from ..modulos_catalogo import FUNCOES_POR_MODULO, funcao_padrao_ativa

_CREATE = (
    "IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NULL\n"
    "BEGIN\n"
    "    CREATE TABLE dbo.modulos_funcoes (\n"
    "        modulo NVARCHAR(30) NOT NULL,\n"
    "        funcao NVARCHAR(40) NOT NULL,\n"
    "        ativo BIT NOT NULL CONSTRAINT DF_modulos_funcoes_ativo DEFAULT 0,\n"
    "        atualizado_em DATETIME NOT NULL CONSTRAINT DF_modulos_funcoes_atualizado_em DEFAULT GETDATE(),\n"
    "        atualizado_por NVARCHAR(180) NULL,\n"
    "        CONSTRAINT PK_modulos_funcoes PRIMARY KEY (modulo, funcao)\n"
    "    );\n"
    "END;"
)


def schema_statements() -> list[str]:
    instrucoes = [_CREATE]
    for modulo, funcoes in FUNCOES_POR_MODULO.items():
        for funcao in funcoes:
            instrucoes.append(
                "IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS "
                f"(SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = '{modulo}' AND funcao = '{funcao}')\n"
                f"    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('{modulo}', '{funcao}', {1 if funcao_padrao_ativa(modulo, funcao) else 0});"
            )
    return instrucoes


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Modularizacao (V062): funcoes que cada modulo exibe no menu (modulos_funcoes).\n"
        "-- Aditiva e idempotente; o seed nao sobrescreve escolhas ja feitas. Gerada de rh_api/repositories/modulos_funcoes_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V062: remove a tabela de funcoes por modulo. Seguro: o menu volta ao padrao do codigo.\n"
        "IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL\n    DROP TABLE dbo.modulos_funcoes;\n"
    )


def ensure_modulos_funcoes(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)

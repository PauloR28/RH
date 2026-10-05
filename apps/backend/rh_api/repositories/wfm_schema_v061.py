"""Schema V061 do WFM: limite semanal da jornada e personalização de turno por colaborador.

Fonte ÚNICA do DDL: `ensure_wfm_v061(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V061__wfm_semana_personalizacao.sql` (um teste garante que coincidem). Aditiva e idempotente.

  * wfm_contratos.jornada_semanal_max_min   limite de horas na semana (seg–dom); NULL = sem limite semanal
  * wfm_turno_personalizacoes               horário próprio de UM colaborador num turno ("ramificação"): o turno-modelo
                                            continua igual para todos os outros
"""

from __future__ import annotations

_TABELAS = [
    (
        "wfm_turno_personalizacoes",
        """
        id_personalizacao INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_wfm_turno_personalizacoes PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_turno INT NOT NULL,
        id_operador INT NOT NULL,
        entrada NVARCHAR(5) NOT NULL,
        saida NVARCHAR(5) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_turno_personalizacoes_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_turno_personalizacoes UNIQUE (id_turno, id_operador)
        """,
    ),
]


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").rstrip().splitlines())
    return f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\nBEGIN\n    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\nEND;"


def schema_statements() -> list[str]:
    instrucoes = [
        "IF OBJECT_ID('dbo.wfm_contratos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_contratos', 'jornada_semanal_max_min') IS NULL\n"
        "BEGIN\n    ALTER TABLE dbo.wfm_contratos ADD jornada_semanal_max_min INT NULL;\nEND;"
    ]
    instrucoes += [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    instrucoes.append(
        "IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NOT NULL\n"
        "   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_turno_personalizacoes_operador' AND object_id = OBJECT_ID('dbo.wfm_turno_personalizacoes'))\n"
        "BEGIN\n    CREATE INDEX IX_wfm_turno_personalizacoes_operador ON dbo.wfm_turno_personalizacoes(operacao, id_operador);\nEND;"
    )
    return instrucoes


def ensure_wfm_v061(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM V061: limite semanal da jornada e personalizacao de turno por colaborador.\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema_v061.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V061. Recusa se existir personalizacao de turno (os horarios proprios seriam perdidos).\n"
        "IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.wfm_turno_personalizacoes)\n"
        "    THROW 50000, 'Existem turnos personalizados: exporte/remova-os antes do rollback.', 1;\n"
        "IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NOT NULL DROP TABLE dbo.wfm_turno_personalizacoes;\n"
        "IF COL_LENGTH('dbo.wfm_contratos', 'jornada_semanal_max_min') IS NOT NULL ALTER TABLE dbo.wfm_contratos DROP COLUMN jornada_semanal_max_min;\n"
    )

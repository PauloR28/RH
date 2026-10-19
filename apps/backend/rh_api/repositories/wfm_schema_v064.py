"""Schema V064 do WFM: escala por dia da semana.

Fonte ÚNICA do DDL: `ensure_wfm_v064(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V064__wfm_dias_semana.sql` (um teste garante que coincidem). Aditiva e idempotente.

  * wfm_turnos.weekdays        dias da semana em que o turno vale: 7 posições, seg..dom ('1111111' = todos os dias).
                               Todo turno existente fica com os 7 dias, então nada do que já está publicado muda.
  * wfm_escala_itens.manual    1 = o dia foi configurado à mão fora dos dias do turno (o ajuste manual vence o padrão).
  * wfm_pausas.origem          'AUTO' (segue a escala / distribuída pelo sistema) ou 'MANUAL' (definida à mão).
"""

from __future__ import annotations

_COLUNAS = [
    ("wfm_turnos", "weekdays", "NVARCHAR(7) NOT NULL CONSTRAINT DF_wfm_turnos_weekdays DEFAULT '1111111'"),
    ("wfm_escala_itens", "manual", "BIT NOT NULL CONSTRAINT DF_wfm_escala_itens_manual DEFAULT 0"),
    ("wfm_pausas", "origem", "NVARCHAR(6) NOT NULL CONSTRAINT DF_wfm_pausas_origem DEFAULT 'AUTO'"),
]


def schema_statements() -> list[str]:
    return [
        f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL AND COL_LENGTH('dbo.{tabela}', '{coluna}') IS NULL\n"
        f"BEGIN\n    ALTER TABLE dbo.{tabela} ADD {coluna} {definicao};\nEND;"
        for tabela, coluna, definicao in _COLUNAS
    ]


def ensure_wfm_v064(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM V064: escala por dia da semana (weekdays do turno, dia manual na escala, origem da pausa).\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema_v064.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    return (
        "-- Rollback da V064. Remove as colunas aditivas (os dias do turno e as marcas manuais sao perdidos).\n"
        "IF COL_LENGTH('dbo.wfm_turnos', 'weekdays') IS NOT NULL\n"
        "BEGIN\n    ALTER TABLE dbo.wfm_turnos DROP CONSTRAINT DF_wfm_turnos_weekdays;\n    ALTER TABLE dbo.wfm_turnos DROP COLUMN weekdays;\nEND;\n"
        "IF COL_LENGTH('dbo.wfm_escala_itens', 'manual') IS NOT NULL\n"
        "BEGIN\n    ALTER TABLE dbo.wfm_escala_itens DROP CONSTRAINT DF_wfm_escala_itens_manual;\n    ALTER TABLE dbo.wfm_escala_itens DROP COLUMN manual;\nEND;\n"
        "IF COL_LENGTH('dbo.wfm_pausas', 'origem') IS NOT NULL\n"
        "BEGIN\n    ALTER TABLE dbo.wfm_pausas DROP CONSTRAINT DF_wfm_pausas_origem;\n    ALTER TABLE dbo.wfm_pausas DROP COLUMN origem;\nEND;\n"
    )

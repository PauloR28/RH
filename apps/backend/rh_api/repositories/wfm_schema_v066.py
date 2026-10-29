"""Schema V066 do WFM: turno especial, limite de escalas por operador e feriado que gera serviço.

Fonte ÚNICA do DDL: `ensure_wfm_v066(cursor)` roda no bootstrap e `render_migration_sql()` gera
`infra/sql/migrations/V066__wfm_turno_especial_feriado.sql` (um teste garante que coincidem). Aditiva e idempotente.

  * wfm_turnos.especial                  1 = turno de "Escala Especial": dias fora da escala tradicional, com horário e rotina
                                         próprios. Não exige dias da semana e não entra no limite de escalas do operador.
  * wfm_operacao_config.max_escalas_operador   quantas escalas (turnos em dias diferentes) cada operador pode ter nesta escala.
  * wfm_calendario_especial.gera_servico 1 = o feriado tem serviço (quem trabalha vem de `servico_json`); 0 = folga para todos.
  * wfm_calendario_especial.servico_json {"id_turno", "entrada", "saida", "ids_operadores"} do serviço no feriado.
"""

from __future__ import annotations

PADRAO_MAX_ESCALAS = 4

_COLUNAS = [
    ("wfm_turnos", "especial", "BIT NOT NULL CONSTRAINT DF_wfm_turnos_especial DEFAULT 0"),
    ("wfm_operacao_config", "max_escalas_operador", f"INT NOT NULL CONSTRAINT DF_wfm_operacao_config_max_escalas DEFAULT {PADRAO_MAX_ESCALAS}"),
    ("wfm_calendario_especial", "gera_servico", "BIT NOT NULL CONSTRAINT DF_wfm_calendario_especial_gera_servico DEFAULT 0"),
    ("wfm_calendario_especial", "servico_json", "NVARCHAR(MAX) NULL"),
]


def schema_statements() -> list[str]:
    return [
        f"IF OBJECT_ID('dbo.{tabela}', 'U') IS NOT NULL AND COL_LENGTH('dbo.{tabela}', '{coluna}') IS NULL\n"
        f"BEGIN\n    ALTER TABLE dbo.{tabela} ADD {coluna} {definicao};\nEND;"
        for tabela, coluna, definicao in _COLUNAS
    ]


def ensure_wfm_v066(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - WFM V066: turno especial, limite de escalas por operador e feriado que gera servico.\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema_v066.py (um teste garante que coincide com o bootstrap).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    linhas = ["-- Rollback da V066. Remove as colunas aditivas (turnos especiais, limite por escala e servico de feriado sao perdidos).\n"]
    for tabela, coluna, definicao in _COLUNAS:
        restricao = ""
        if "CONSTRAINT" in definicao:
            nome = definicao.split("CONSTRAINT ", 1)[1].split(" ", 1)[0]
            restricao = f"    ALTER TABLE dbo.{tabela} DROP CONSTRAINT {nome};\n"
        linhas.append(f"IF COL_LENGTH('dbo.{tabela}', '{coluna}') IS NOT NULL\nBEGIN\n{restricao}    ALTER TABLE dbo.{tabela} DROP COLUMN {coluna};\nEND;\n")
    return "".join(linhas)

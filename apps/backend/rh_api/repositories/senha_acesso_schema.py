"""Schema V077 (26/nov/2026): fluxo de senha do acesso por Login.

Fonte ÚNICA do DDL: `ensure_senha_acesso_schema(cursor)` roda no bootstrap e antes das operações do fluxo, e
`render_migration_sql()` gera `infra/sql/migrations/V077__senha_acesso.sql` (um teste garante que coincidem).
Aditiva e idempotente. Doc: CONECTA_REBRANDING/27_SENHA_E_ACESSO/Fluxo_de_Senha.md.

  * usuarios.sessao_web_id              sessão web aberta agora (uma conta, um computador por vez).
  * usuarios.falhas_login               senhas erradas seguidas (5 = bloqueio de 15 min).
  * usuarios.bloqueado_ate              fim do bloqueio por senha errada.
  * usuarios.senha_temporaria_expira_em validade da senha temporária definida pelo admin (7 dias).
  * senha_recuperacoes                  pedidos do "Esqueci a senha": senha provisória (ao supervisor) ou código (por
                                        e-mail). Só o hash fica guardado; vale uma vez; tem prazo e limite de erros.
"""

from __future__ import annotations

_COLUNAS = (
    ("sessao_web_id", "NVARCHAR(40) NULL"),
    ("falhas_login", "INT NULL"),
    ("bloqueado_ate", "DATETIME NULL"),
    ("senha_temporaria_expira_em", "DATETIME NULL"),
)

_TABELA = (
    "IF OBJECT_ID('dbo.senha_recuperacoes', 'U') IS NULL\n"
    "BEGIN\n"
    "    CREATE TABLE dbo.senha_recuperacoes (\n"
    "        id_recuperacao INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_senha_recuperacoes PRIMARY KEY,\n"
    "        id_usuario INT NOT NULL,\n"
    "        tipo NVARCHAR(20) NOT NULL,\n"
    "        segredo_hash NVARCHAR(255) NOT NULL,\n"
    "        enviado_para NVARCHAR(255) NULL,\n"
    "        id_destinatario INT NULL,\n"
    "        expira_em DATETIME NOT NULL,\n"
    "        tentativas INT NOT NULL CONSTRAINT DF_senha_recuperacoes_tentativas DEFAULT 0,\n"
    "        usado_em DATETIME NULL,\n"
    "        cancelado_em DATETIME NULL,\n"
    "        origem NVARCHAR(64) NULL,\n"
    "        criado_em DATETIME NOT NULL CONSTRAINT DF_senha_recuperacoes_criado_em DEFAULT GETDATE()\n"
    "    );\n"
    "END;"
)

_INDICE = (
    "IF OBJECT_ID('dbo.senha_recuperacoes', 'U') IS NOT NULL AND NOT EXISTS (\n"
    "    SELECT 1 FROM sys.indexes WHERE name = 'IX_senha_recuperacoes_usuario' AND object_id = OBJECT_ID('dbo.senha_recuperacoes'))\n"
    "    CREATE INDEX IX_senha_recuperacoes_usuario ON dbo.senha_recuperacoes (id_usuario, criado_em DESC);"
)


def schema_statements() -> list[str]:
    colunas = [
        f"IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', '{nome}') IS NULL\n"
        f"    ALTER TABLE dbo.usuarios ADD {nome} {tipo};"
        for nome, tipo in _COLUNAS
    ]
    return [*colunas, _TABELA, _INDICE]


_garantido = False


def ensure_senha_acesso_schema(cursor, *, forcar: bool = False) -> None:
    """Idempotente. Depois da 1ª vez no processo, só roda de novo com `forcar` (economiza idas ao banco no login)."""
    global _garantido
    if _garantido and not forcar:
        return
    for instrucao in schema_statements():
        cursor.execute(instrucao)
    _garantido = True


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - V077: fluxo de senha do acesso por Login (esqueci a senha, senha temporaria, bloqueio, sessao unica).\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/senha_acesso_schema.py (um teste garante que coincide).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    linhas = [
        "-- Rollback da V077. Tira a tabela de pedidos do Esqueci a senha e as colunas novas de usuarios.",
        "-- As senhas ja trocadas continuam valendo.",
        "IF OBJECT_ID('dbo.senha_recuperacoes', 'U') IS NOT NULL DROP TABLE dbo.senha_recuperacoes;",
    ]
    for nome, _ in reversed(_COLUNAS):
        linhas.append(f"IF COL_LENGTH('dbo.usuarios', '{nome}') IS NOT NULL ALTER TABLE dbo.usuarios DROP COLUMN {nome};")
    return "\n".join(linhas) + "\n"

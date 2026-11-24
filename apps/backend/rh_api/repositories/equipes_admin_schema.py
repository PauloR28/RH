"""Schema V076 (24/nov/2026): administração de Equipes na Tecnologia.

Fonte ÚNICA do DDL: `ensure_equipes_admin_schema(cursor)` roda no bootstrap e antes de cada operação da tela, e
`render_migration_sql()` gera `infra/sql/migrations/V076__equipes_admin.sql` (um teste garante que coincidem).
Aditiva e idempotente.

  * equipes_operacao.id_supervisor  supervisor RESPONSÁVEL pela equipe (recebe as pendências dos operadores).
  * equipes_operacao.id_apoio       supervisor de apoio (opcional; vê a equipe, não recebe pendências).
  * Preenche id_supervisor das equipes que já existem quando há UM supervisor só com aquela equipe no cadastro.
  * Permissões novas da função Equipes (tela Acessos): ver, criar/editar, mover operadores, exportar.
"""

from __future__ import annotations

from ..rbac import PERMISSOES_EQUIPES_V076

PERMISSOES_V076 = PERMISSOES_EQUIPES_V076

_COLUNAS = tuple(
    f"IF OBJECT_ID('dbo.equipes_operacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.equipes_operacao', '{coluna}') IS NULL\n"
    f"    ALTER TABLE dbo.equipes_operacao ADD {coluna} INT NULL;"
    for coluna in ("id_supervisor", "id_apoio")
)

# Equipe sem responsável: se exatamente UM supervisor tem esta equipe no cadastro, ele vira o responsável.
_PREENCHER = (
    "IF COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'id_equipe') IS NOT NULL\n"
    "    EXEC(N'UPDATE e SET id_supervisor = x.id_usuario FROM dbo.equipes_operacao e\n"
    "        JOIN (SELECT u.id_equipe, MIN(u.id_usuario) AS id_usuario FROM dbo.usuarios u\n"
    "              WHERE u.perfil_id = ''supervisor'' AND u.id_equipe IS NOT NULL AND ISNULL(u.status, ''Ativo'') = ''Ativo''\n"
    "              GROUP BY u.id_equipe HAVING COUNT(*) = 1) x ON x.id_equipe = e.id_equipe\n"
    "        WHERE e.id_supervisor IS NULL');"
)


# Ainda sem responsável: o supervisor que supervisiona MAIS operadores da equipe (empate: o de menor id).
_PREENCHER_POR_VINCULO = (
    "IF COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NOT NULL AND OBJECT_ID('dbo.usuarios_supervisores', 'U') IS NOT NULL\n"
    "    EXEC(N'UPDATE e SET id_supervisor = x.id_supervisor FROM dbo.equipes_operacao e\n"
    "        JOIN (SELECT o.id_equipe, us.id_supervisor,\n"
    "                     ROW_NUMBER() OVER (PARTITION BY o.id_equipe ORDER BY COUNT(*) DESC, us.id_supervisor) AS rn\n"
    "              FROM dbo.usuarios_supervisores us JOIN dbo.usuarios o ON o.id_usuario = us.id_operador\n"
    "              WHERE o.id_equipe IS NOT NULL AND ISNULL(o.status, ''Ativo'') = ''Ativo''\n"
    "              GROUP BY o.id_equipe, us.id_supervisor) x ON x.id_equipe = e.id_equipe AND x.rn = 1\n"
    "        WHERE e.id_supervisor IS NULL');"
)


def _texto_sql(valor: str) -> str:
    """Literal N'...' só com ASCII (acentos viram NCHAR), igual às migrations anteriores."""
    partes: list[str] = []
    atual = ""
    for ch in valor:
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


def _permissao_sql(chave: str, descricao: str, critica: bool, perfis: tuple[str, ...]) -> str:
    blocos = [
        "IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
        "BEGIN\n"
        f"    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = '{chave}')\n"
        "        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)\n"
        f"        VALUES ('{chave}', N'Equipes', {_texto_sql(descricao)}, {1 if critica else 0}, GETDATE());\n"
        "END;",
        "IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL\n"
        f"    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''{chave}'' AND modulo_dono IS NULL;');",
    ]
    for perfil in perfis:
        blocos.append(
            "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
            "BEGIN\n"
            f"    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = '{perfil}')\n"
            f"       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = '{chave}')\n"
            f"       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = '{perfil}' AND chave_permissao = '{chave}')\n"
            "        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)\n"
            f"        VALUES ('{perfil}', '{chave}', 1, GETDATE(), GETDATE());\n"
            "END;"
        )
    return "\n\n".join(blocos)


def schema_statements() -> list[str]:
    return [*_COLUNAS, _PREENCHER, _PREENCHER_POR_VINCULO]


def ensure_equipes_admin_schema(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - V076: Equipes na Tecnologia. Supervisor responsavel e apoio por equipe; permissoes da funcao Equipes.\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/equipes_admin_schema.py (um teste garante que coincide).\n\n"
    )
    permissoes = [_permissao_sql(*p) for p in PERMISSOES_V076]
    return cabecalho + "\n\n".join([*schema_statements(), *permissoes]) + "\n"


def render_rollback_sql() -> str:
    chaves = ", ".join(f"'{p[0]}'" for p in PERMISSOES_V076)
    return (
        "-- Rollback da V076. Tira as permissoes da funcao Equipes e as colunas de responsavel/apoio.\n"
        "-- Nao mexe em usuarios nem na escala: as mudancas de equipe ja feitas continuam valendo.\n"
        f"IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao IN ({chaves});\n"
        f"IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave IN ({chaves});\n"
        "IF COL_LENGTH('dbo.equipes_operacao', 'id_apoio') IS NOT NULL ALTER TABLE dbo.equipes_operacao DROP COLUMN id_apoio;\n"
        "IF COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NOT NULL ALTER TABLE dbo.equipes_operacao DROP COLUMN id_supervisor;\n"
    )

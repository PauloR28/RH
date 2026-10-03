"""Schema da modularização (V055–V057). Fonte ÚNICA do DDL: `ensure_modulos_schema(cursor)` roda no bootstrap e as funções
`render_*` geram os arquivos de `infra/sql/migrations/` (um teste garante que coincidem).

Aditivo e idempotente. Nada existente é apagado ou renomeado.
  V055  dbo.modulos_sistema          registro dos módulos (ativo/protegido)
  V056  dbo.permissoes.modulo_dono / abre_modulo   dono de cada permissão (seed pelo catálogo; reatribuível em Tecnologia)
  V057  perfis de TI                 administração completa (decisão 2), com log para rollback exato
"""

from __future__ import annotations

from collections import defaultdict

from ..modulos_catalogo import MODULOS_PADRAO, abre_modulo_padrao, modulo_dono_padrao

PERFIS_TI_IDS = ("tecnico_junior", "tecnico_pleno", "tecnico_senior", "analista_ti")


def _lit(texto: str) -> str:
    return texto.replace("'", "''")


def _nstr(texto: str) -> str:
    """Literal NVARCHAR 100% ASCII: caracteres acentuados viram NCHAR(código). O `sqlcmd` da implantação lê o arquivo na
    página de código do console e gravaria "Operação" como "OperaÃ§Ã£o"; assim a migration é imune à codificação do arquivo."""
    partes, atual = [], ""
    for ch in texto:
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


# ---------------------------------------------------------------- V055
def schema_modulos_statements() -> list[str]:
    instrucoes = [
        "IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NULL\n"
        "BEGIN\n"
        "    CREATE TABLE dbo.modulos_sistema (\n"
        "        chave NVARCHAR(30) NOT NULL CONSTRAINT PK_modulos_sistema PRIMARY KEY,\n"
        "        nome NVARCHAR(80) NOT NULL,\n"
        "        ordem INT NOT NULL CONSTRAINT DF_modulos_sistema_ordem DEFAULT 0,\n"
        "        ativo BIT NOT NULL CONSTRAINT DF_modulos_sistema_ativo DEFAULT 1,\n"
        "        protegido BIT NOT NULL CONSTRAINT DF_modulos_sistema_protegido DEFAULT 0,\n"
        "        atualizado_em DATETIME NOT NULL CONSTRAINT DF_modulos_sistema_atualizado_em DEFAULT GETDATE(),\n"
        "        atualizado_por NVARCHAR(180) NULL\n"
        "    );\n"
        "END;"
    ]
    for chave, nome, ordem, protegido in MODULOS_PADRAO:
        instrucoes.append(
            f"IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_sistema WHERE chave = '{chave}')\n"
            f"    INSERT INTO dbo.modulos_sistema (chave, nome, ordem, ativo, protegido) VALUES ('{chave}', {_nstr(nome)}, {ordem}, 1, {1 if protegido else 0});"
        )
    return instrucoes


def render_migration_modulos_sql() -> str:
    cabecalho = (
        "-- Conecta - Modularizacao (V055): registro dos modulos (core, rh, operacao, tecnologia).\n"
        "-- Aditiva e idempotente. Gerada de rh_api/repositories/modulos_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_modulos_statements()) + "\n"


def render_rollback_modulos_sql() -> str:
    return (
        "-- Rollback da V055: remove o registro de modulos. Seguro: nenhuma outra tabela depende dele.\n"
        "IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL\n    DROP TABLE dbo.modulos_sistema;\n"
    )


# ---------------------------------------------------------------- V056
def _grupos_de_seed() -> dict[tuple[str, int], list[str]]:
    from ..rbac import PERMISSION_DEFINITIONS

    grupos: dict[tuple[str, int], list[str]] = defaultdict(list)
    for chave, definicao in PERMISSION_DEFINITIONS.items():
        grupos[(modulo_dono_padrao(chave, definicao.module), 1 if abre_modulo_padrao(chave) else 0)].append(chave)
    return {k: sorted(v) for k, v in sorted(grupos.items())}


def schema_modulo_dono_statements() -> list[str]:
    instrucoes = [
        "IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NULL\n"
        "BEGIN\n    ALTER TABLE dbo.permissoes ADD modulo_dono NVARCHAR(30) NULL;\nEND;",
        "IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.permissoes', 'abre_modulo') IS NULL\n"
        "BEGIN\n    ALTER TABLE dbo.permissoes ADD abre_modulo BIT NOT NULL CONSTRAINT DF_permissoes_abre_modulo DEFAULT 0;\nEND;",
    ]
    # Seed só onde modulo_dono ainda é NULL: nunca sobrescreve uma reatribuição feita em Tecnologia.
    # Dinâmico (EXEC) porque a coluna acaba de ser criada no mesmo lote.
    for (dono, abre), chaves in _grupos_de_seed().items():
        lista = ", ".join(f"''{_lit(c)}''" for c in chaves)
        instrucoes.append(
            "IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL\n"
            f"    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''{dono}'', abre_modulo = {abre} "
            f"WHERE modulo_dono IS NULL AND chave IN ({lista});');"
        )
    return instrucoes


def render_migration_modulo_dono_sql() -> str:
    cabecalho = (
        "-- Conecta - Modularizacao (V056): dono de cada permissao (modulo_dono) e se ela abre o modulo (abre_modulo).\n"
        "-- Aditiva e idempotente; o seed nao sobrescreve valores ja definidos. Gerada de rh_api/repositories/modulos_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_modulo_dono_statements()) + "\n"


def render_rollback_modulo_dono_sql() -> str:
    return (
        "-- Rollback da V056: remove as colunas de dono do modulo. Nao toca em perfil_permissoes.\n"
        "IF COL_LENGTH('dbo.permissoes', 'abre_modulo') IS NOT NULL\n"
        "BEGIN\n"
        "    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_permissoes_abre_modulo')\n"
        "        ALTER TABLE dbo.permissoes DROP CONSTRAINT DF_permissoes_abre_modulo;\n"
        "    ALTER TABLE dbo.permissoes DROP COLUMN abre_modulo;\n"
        "END;\n"
        "IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL\n"
        "    ALTER TABLE dbo.permissoes DROP COLUMN modulo_dono;\n"
    )


# ---------------------------------------------------------------- V057
def _grants_ti() -> list[tuple[str, str]]:
    from ..rbac import PERMISSOES_ADMINISTRACAO_TI

    return [(perfil, chave) for perfil in PERFIS_TI_IDS for chave in sorted(PERMISSOES_ADMINISTRACAO_TI)]


def schema_perfis_ti_statements() -> list[str]:
    valores = ",\n            ".join(f"('{p}', '{c}')" for p, c in _grants_ti())
    return [
        "IF OBJECT_ID('dbo.modularizacao_grants_log', 'U') IS NULL\n"
        "BEGIN\n"
        "    CREATE TABLE dbo.modularizacao_grants_log (\n"
        "        id_perfil NVARCHAR(40) NOT NULL,\n"
        "        chave_permissao NVARCHAR(120) NOT NULL,\n"
        "        migration NVARCHAR(20) NOT NULL,\n"
        "        valor_anterior BIT NULL,\n"
        "        criado_em DATETIME NOT NULL CONSTRAINT DF_modularizacao_grants_log_criado_em DEFAULT GETDATE(),\n"
        "        CONSTRAINT PK_modularizacao_grants_log PRIMARY KEY (id_perfil, chave_permissao, migration)\n"
        "    );\n"
        "END;",
        # Cada par (perfil, permissão) é tratado UMA ÚNICA vez (o log marca): as migrations são reaplicadas a cada deploy e
        # não podem desfazer uma decisão posterior do Administrador/Tecnologia.
        # 1) A tela de Perfis grava uma linha para TODA permissão (0 = não marcada); portanto a negação existente não é uma
        #    decisão explícita contra a TI. Liga a linha e registra o valor anterior (0) para o rollback restaurar.
        "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
        "BEGIN\n"
        "    UPDATE pp SET permitido = 1, atualizado_em = GETDATE()\n"
        "    OUTPUT INSERTED.id_perfil, INSERTED.chave_permissao, 'V057', 0, GETDATE()\n"
        "        INTO dbo.modularizacao_grants_log (id_perfil, chave_permissao, migration, valor_anterior, criado_em)\n"
        "    FROM dbo.perfil_permissoes pp\n"
        "    INNER JOIN (VALUES\n"
        f"            {valores}\n"
        "        ) AS v (id_perfil, chave) ON v.id_perfil = pp.id_perfil AND v.chave = pp.chave_permissao\n"
        "    WHERE pp.permitido = 0\n"
        "      AND NOT EXISTS (SELECT 1 FROM dbo.modularizacao_grants_log l WHERE l.id_perfil = pp.id_perfil AND l.chave_permissao = pp.chave_permissao AND l.migration = 'V057');\n"
        "END;",
        # 2) Linhas que faltam são inseridas (valor_anterior NULL = a migration criou a linha).
        "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
        "BEGIN\n"
        "    INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)\n"
        "    OUTPUT INSERTED.id_perfil, INSERTED.chave_permissao, 'V057', NULL, GETDATE()\n"
        "        INTO dbo.modularizacao_grants_log (id_perfil, chave_permissao, migration, valor_anterior, criado_em)\n"
        "    SELECT v.id_perfil, v.chave, 1, GETDATE(), GETDATE()\n"
        "    FROM (VALUES\n"
        f"        {valores}\n"
        "    ) AS v (id_perfil, chave)\n"
        "    WHERE EXISTS (SELECT 1 FROM dbo.perfis p WHERE p.id_perfil = v.id_perfil)\n"
        "      AND EXISTS (SELECT 1 FROM dbo.permissoes x WHERE x.chave = v.chave)\n"
        "      AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes e WHERE e.id_perfil = v.id_perfil AND e.chave_permissao = v.chave)\n"
        "      AND NOT EXISTS (SELECT 1 FROM dbo.modularizacao_grants_log l WHERE l.id_perfil = v.id_perfil AND l.chave_permissao = v.chave AND l.migration = 'V057');\n"
        "END;",
    ]


def render_migration_perfis_ti_sql() -> str:
    cabecalho = (
        "-- Conecta - Modularizacao (V057): administracao completa (modulos core e tecnologia) para os perfis de TI.\n"
        "-- Aditiva e idempotente: liga linhas negadas e insere as que faltam, cada par (perfil, permissao) uma unica vez,\n"
        "-- registrando tudo em modularizacao_grants_log. Gerada de rh_api/repositories/modulos_schema.py.\n\n"
    )
    return cabecalho + "\n\n".join(schema_perfis_ti_statements()) + "\n"


def render_rollback_perfis_ti_sql() -> str:
    return (
        "-- Rollback da V057: restaura SOMENTE o que a V057 mexeu (registrado no log): linhas ligadas voltam a 0 e as\n"
        "-- linhas inseridas sao removidas. O que ja existia antes (ou foi inserido por outro caminho) nao e tocado.\n"
        "IF OBJECT_ID('dbo.modularizacao_grants_log', 'U') IS NOT NULL\n"
        "BEGIN\n"
        "    UPDATE pp SET permitido = 0, atualizado_em = GETDATE()\n"
        "    FROM dbo.perfil_permissoes pp\n"
        "    INNER JOIN dbo.modularizacao_grants_log l\n"
        "        ON l.id_perfil = pp.id_perfil AND l.chave_permissao = pp.chave_permissao AND l.migration = 'V057'\n"
        "    WHERE l.valor_anterior = 0;\n"
        "    DELETE pp FROM dbo.perfil_permissoes pp\n"
        "    INNER JOIN dbo.modularizacao_grants_log l\n"
        "        ON l.id_perfil = pp.id_perfil AND l.chave_permissao = pp.chave_permissao AND l.migration = 'V057'\n"
        "    WHERE l.valor_anterior IS NULL;\n"
        "    DROP TABLE dbo.modularizacao_grants_log;\n"
        "END;\n"
    )


# ---------------------------------------------------------------- bootstrap
def ensure_modulos_schema(cursor) -> None:
    """Bootstrap de DEV: cria/semeia o registro de módulos e o dono das permissões. NÃO aplica a V057 (concessão aos
    perfis de TI): no bootstrap isso já vem do `ROLE_PERMISSIONS` em código (seed de `perfil_permissoes`)."""
    for instrucao in schema_modulos_statements() + schema_modulo_dono_statements():
        cursor.execute(instrucao)

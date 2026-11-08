"""Schema do Diário de bordo (V068, 08/nov/2026). Fonte ÚNICA do DDL: `ensure_diario_schema(cursor)` roda no bootstrap e
`render_migration_sql()` gera `infra/sql/migrations/V068__diario_de_bordo.sql` (um teste garante que coincidem).

Aditivo e idempotente; nada existente é alterado ou removido.

O Diário de bordo é o registro do DIA DA OPERAÇÃO (não de uma pessoa): 1 diário por dia por operação, 3 turnos
(abertura, intermediario, fechamento), cada um rascunho -> concluido. Códigos de status/turno/canal são ASCII no banco;
o rótulo acentuado é da tela. Horários são os do relógio da operação (DATETIME2 local, `SYSDATETIME()`), como o resto do
Conecta; a Central 24h registra intercorrências pela hora local.

Vazio NUNCA vira 0: as colunas de número (início, fim, NS, parciais) aceitam NULL e NULL quer dizer "não informado".
"""

from __future__ import annotations

from ..modulos_catalogo import abre_modulo_padrao, modulo_dono_padrao

OPERACAO_INICIAL = "CRF"  # CRF / Flamengo (já semeada no bootstrap: ensure_operacoes_seed)

# Listas cadastráveis (D5). tipo, nome, chave do protótipo (para a importação dos .json antigos), ordem.
CADASTROS_PADRAO: tuple[tuple[str, str, str, int], ...] = (
    ("demanda", "Formulário", "formulario", 10),
    ("demanda", "Fale Conosco", "faleConosco", 20),
    ("demanda", "Reclame Aqui (e-mails)", "reclameAquiEmail", 30),
    ("demanda", "Reclame Aqui (portal)", "reclameAquiPortal", 40),
    ("demanda", "Biometria", "biometria", 50),
    ("demanda", "Chargeback (CBK)", "chargeback", 60),
    ("demanda", "Call Back", "callBack", 70),
    ("canal_ns", "Digital", "digital", 10),
    ("canal_ns", "Voz", "voz", 20),
    ("canal_parcial", "Web Chat", "webChat", 10),
    ("canal_parcial", "WhatsApp", "whatsapp", 20),
    ("canal_parcial", "Telefone", "telefone", 30),
    ("ferramenta", "Telefonia (URA)", "", 10),
    ("ferramenta", "WhatsApp Business", "", 20),
    ("ferramenta", "Chat do site", "", 30),
    ("ferramenta", "Sistema de atendimento", "", 40),
    ("ferramenta", "Rede / internet", "", 50),
    ("ferramenta", "Outra", "", 99),
)

_TABELAS: list[tuple[str, str]] = [
    (
        "diario_cadastro",
        """
        id_item INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_cadastro PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        chave_prototipo NVARCHAR(60) NULL,
        ordem INT NOT NULL CONSTRAINT DF_diario_cadastro_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_diario_cadastro_ativo DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_cadastro_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL,
        CONSTRAINT UQ_diario_cadastro UNIQUE (operacao, tipo, nome)
        """,
    ),
    (
        "diario_dia",
        """
        id_dia BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_dia PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        data DATE NOT NULL,
        status NVARCHAR(12) NOT NULL CONSTRAINT DF_diario_dia_status DEFAULT 'aberto',
        encerramento_tipo NVARCHAR(20) NULL,
        passagem NVARCHAR(2000) NULL,
        encerrado_por NVARCHAR(180) NULL,
        encerrado_em DATETIME2(0) NULL,
        envio_gerado_por NVARCHAR(180) NULL,
        envio_gerado_em DATETIME2(0) NULL,
        envio_copiado_em DATETIME2(0) NULL,
        envio_baixado_em DATETIME2(0) NULL,
        envio_enviado_por NVARCHAR(180) NULL,
        envio_enviado_em DATETIME2(0) NULL,
        importado BIT NOT NULL CONSTRAINT DF_diario_dia_importado DEFAULT 0,
        versao INT NOT NULL CONSTRAINT DF_diario_dia_versao DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_dia_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL,
        CONSTRAINT UQ_diario_dia UNIQUE (operacao, data)
        """,
    ),
    (
        "diario_turno",
        """
        id_turno BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_turno PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_turno_dia REFERENCES dbo.diario_dia(id_dia),
        turno NVARCHAR(16) NOT NULL,
        status NVARCHAR(12) NOT NULL CONSTRAINT DF_diario_turno_status DEFAULT 'rascunho',
        observacoes NVARCHAR(1000) NULL,
        versao INT NOT NULL CONSTRAINT DF_diario_turno_versao DEFAULT 1,
        salvo_por NVARCHAR(180) NULL,
        salvo_por_id INT NULL,
        salvo_em DATETIME2(0) NULL,
        concluido_por NVARCHAR(180) NULL,
        concluido_em DATETIME2(0) NULL,
        reaberto_vezes INT NOT NULL CONSTRAINT DF_diario_turno_reaberto DEFAULT 0,
        editando_por NVARCHAR(180) NULL,
        editando_id INT NULL,
        editando_em DATETIME2(0) NULL,
        CONSTRAINT UQ_diario_turno UNIQUE (id_dia, turno)
        """,
    ),
    (
        "diario_demanda",
        """
        id_turno BIGINT NOT NULL CONSTRAINT FK_diario_demanda_turno REFERENCES dbo.diario_turno(id_turno),
        id_item INT NOT NULL CONSTRAINT FK_diario_demanda_item REFERENCES dbo.diario_cadastro(id_item),
        inicio INT NULL,
        fim INT NULL,
        CONSTRAINT PK_diario_demanda PRIMARY KEY (id_turno, id_item)
        """,
    ),
    (
        "diario_nivel_servico",
        """
        id_turno BIGINT NOT NULL CONSTRAINT FK_diario_ns_turno REFERENCES dbo.diario_turno(id_turno),
        id_item INT NOT NULL CONSTRAINT FK_diario_ns_item REFERENCES dbo.diario_cadastro(id_item),
        valor DECIMAL(5,2) NULL,
        CONSTRAINT PK_diario_nivel_servico PRIMARY KEY (id_turno, id_item)
        """,
    ),
    (
        "diario_intercorrencia",
        """
        id_intercorrencia BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_intercorrencia PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_interc_dia REFERENCES dbo.diario_dia(id_dia),
        operacao NVARCHAR(60) NOT NULL,
        turno NVARCHAR(16) NOT NULL,
        id_ferramenta INT NULL CONSTRAINT FK_diario_interc_ferramenta REFERENCES dbo.diario_cadastro(id_item),
        ferramenta NVARCHAR(120) NOT NULL,
        canal NVARCHAR(12) NOT NULL,
        inicio DATETIME2(0) NOT NULL,
        fim DATETIME2(0) NULL,
        descricao NVARCHAR(1000) NOT NULL,
        acao NVARCHAR(1000) NULL,
        chamado NVARCHAR(40) NULL,
        excluida BIT NOT NULL CONSTRAINT DF_diario_interc_excluida DEFAULT 0,
        excluida_por NVARCHAR(180) NULL,
        excluida_em DATETIME2(0) NULL,
        motivo_exclusao NVARCHAR(500) NULL,
        versao INT NOT NULL CONSTRAINT DF_diario_interc_versao DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_interc_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL
        """,
    ),
    (
        "diario_parcial",
        """
        id_parcial BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_parcial PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_parcial_dia REFERENCES dbo.diario_dia(id_dia),
        hora TIME(0) NOT NULL,
        valores_json NVARCHAR(MAX) NOT NULL,
        excluida BIT NOT NULL CONSTRAINT DF_diario_parcial_excluida DEFAULT 0,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_parcial_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL
        """,
    ),
    (
        "diario_abs_correcao",
        """
        id_correcao BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_abs_correcao PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_abs_dia REFERENCES dbo.diario_dia(id_dia),
        origem NVARCHAR(12) NOT NULL CONSTRAINT DF_diario_abs_origem DEFAULT 'correcao',
        presenca_json NVARCHAR(MAX) NULL,
        corrigido_json NVARCHAR(MAX) NOT NULL,
        motivo NVARCHAR(500) NOT NULL,
        corrigido_por NVARCHAR(180) NULL,
        corrigido_por_id INT NULL,
        corrigido_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_abs_corrigido_em DEFAULT SYSDATETIME()
        """,
    ),
    (
        "diario_alteracao",
        """
        id_alteracao BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_alteracao PRIMARY KEY,
        id_dia BIGINT NULL,
        operacao NVARCHAR(60) NOT NULL,
        data DATE NULL,
        turno NVARCHAR(16) NULL,
        entidade NVARCHAR(30) NOT NULL,
        acao NVARCHAR(40) NOT NULL,
        campo NVARCHAR(160) NULL,
        antes NVARCHAR(MAX) NULL,
        depois NVARCHAR(MAX) NULL,
        motivo NVARCHAR(1000) NULL,
        usuario_id INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_alteracao_criado_em DEFAULT SYSDATETIME()
        """,
    ),
    (
        "diario_aceite",
        """
        id_aceite INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_aceite PRIMARY KEY,
        username NVARCHAR(180) NOT NULL,
        id_usuario INT NULL,
        versao_termos NVARCHAR(20) NOT NULL,
        aceito_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_aceite_aceito_em DEFAULT SYSDATETIME(),
        ip NVARCHAR(64) NULL,
        CONSTRAINT UQ_diario_aceite UNIQUE (username, versao_termos)
        """,
    ),
]

# nome, tabela, colunas
_INDICES: list[tuple[str, str, str]] = [
    ("IX_diario_turno_dia", "diario_turno", "id_dia"),
    ("IX_diario_interc_operacao_inicio", "diario_intercorrencia", "operacao, inicio"),
    ("IX_diario_interc_dia", "diario_intercorrencia", "id_dia"),
    ("IX_diario_parcial_dia", "diario_parcial", "id_dia"),
    ("IX_diario_abs_dia", "diario_abs_correcao", "id_dia"),
    ("IX_diario_alteracao_dia", "diario_alteracao", "id_dia, criado_em"),
    ("IX_diario_alteracao_operacao_data", "diario_alteracao", "operacao, data"),
]


def _create_table_sql(nome: str, corpo: str) -> str:
    corpo_limpo = "\n".join(linha.rstrip() for linha in corpo.strip("\n").rstrip().splitlines())
    return f"IF OBJECT_ID('dbo.{nome}', 'U') IS NULL\nBEGIN\n    CREATE TABLE dbo.{nome} (\n{corpo_limpo}\n    );\nEND;"


def _index_sql(nome: str, tabela: str, colunas: str) -> str:
    return (
        f"IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '{nome}' AND object_id = OBJECT_ID('dbo.{tabela}'))\n"
        f"BEGIN\n    CREATE INDEX {nome} ON dbo.{tabela}({colunas});\nEND;"
    )


def _nstr(texto: str) -> str:
    """Literal NVARCHAR 100% ASCII (acentos viram NCHAR), imune à página de código do sqlcmd (ver chamados_schema._nstr)."""
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


def _permissoes_diario() -> list:
    from ..rbac import PERMISSION_DEFINITIONS

    return [d for chave, d in PERMISSION_DEFINITIONS.items() if chave.startswith(("diario.", "sessao.diario."))]


def _perfis_iniciais() -> list[tuple[str, str]]:
    from ..rbac import ROLE_PERMISSIONS

    pares = []
    for perfil, chaves in sorted(ROLE_PERMISSIONS.items()):
        for chave in sorted(chaves):
            if chave.startswith(("diario.", "sessao.diario.")):
                pares.append((perfil, chave))
    return pares


def schema_statements() -> list[str]:
    instrucoes = [_create_table_sql(nome, corpo) for nome, corpo in _TABELAS]
    instrucoes += [_index_sql(*item) for item in _INDICES]
    for tipo, nome, chave, ordem in CADASTROS_PADRAO:
        chave_sql = f"'{chave}'" if chave else "NULL"
        instrucoes.append(
            f"IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = '{OPERACAO_INICIAL}' AND tipo = '{tipo}' AND nome = {_nstr(nome)})\n"
            f"    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)\n"
            f"    VALUES ('{OPERACAO_INICIAL}', '{tipo}', {_nstr(nome)}, {chave_sql}, {ordem}, 1, N'V068');"
        )
    # Permissões do módulo: só insere quando falta; nunca sobrescreve dono/abre_modulo nem o que o admin marcou em Perfis.
    for d in _permissoes_diario():
        dono = modulo_dono_padrao(d.key, d.module)
        abre = 1 if abre_modulo_padrao(d.key) else 0
        instrucoes.append(
            "IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
            "BEGIN\n"
            f"    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = '{d.key}')\n"
            "        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)\n"
            f"        VALUES ('{d.key}', {_nstr(d.module)}, {_nstr(d.description)}, {1 if d.critical else 0}, GETDATE());\n"
            "END;"
        )
        instrucoes.append(
            "IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL\n"
            f"    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''{dono}'', abre_modulo = {abre} "
            f"WHERE chave = ''{d.key}'' AND modulo_dono IS NULL;');"
        )
    for perfil, chave in _perfis_iniciais():
        instrucoes.append(
            "IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL\n"
            "BEGIN\n"
            f"    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = '{perfil}')\n"
            f"       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = '{chave}')\n"
            f"       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = '{perfil}' AND chave_permissao = '{chave}')\n"
            "        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)\n"
            f"        VALUES ('{perfil}', '{chave}', 1, GETDATE(), GETDATE());\n"
            "END;"
        )
    return instrucoes


def ensure_diario_schema(cursor) -> None:
    for instrucao in schema_statements():
        cursor.execute(instrucao)


def render_migration_sql() -> str:
    cabecalho = (
        "-- Conecta - Diario de bordo (V068). Aditiva e idempotente: nao altera nem remove dados existentes.\n"
        "-- Gerada de rh_api/repositories/diario_schema.py (um teste garante que coincide com o bootstrap runtime).\n"
        "-- Tabelas diario_*, listas iniciais da operacao CRF (tipos de demanda, canais e ferramentas), permissoes diario.*\n"
        "-- e o valor inicial dos perfis, inseridos apenas quando faltam (nunca sobrescreve Perfis e Permissoes).\n\n"
    )
    return cabecalho + "\n\n".join(schema_statements()) + "\n"


def render_rollback_sql() -> str:
    linhas = [
        "-- Rollback da V068 (Diario de bordo). Recusa se houver dias registrados; remove tabelas e permissoes diario.*.\n",
        "IF OBJECT_ID('dbo.diario_dia', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.diario_dia)\n"
        "    THROW 50000, 'Existem dias no Diario de bordo: exporte/remova os dados manualmente antes do rollback.', 1;\n",
    ]
    for nome in ("diario_aceite", "diario_alteracao", "diario_abs_correcao", "diario_parcial", "diario_intercorrencia",
                 "diario_nivel_servico", "diario_demanda", "diario_turno", "diario_dia", "diario_cadastro"):
        linhas.append(f"IF OBJECT_ID('dbo.{nome}', 'U') IS NOT NULL DROP TABLE dbo.{nome};\n")
    linhas.append("IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao LIKE 'diario.%';\n")
    linhas.append("IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave LIKE 'diario.%';\n")
    return "".join(linhas)

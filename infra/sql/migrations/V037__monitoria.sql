-- Vertente Monitoria (promt.txt, rodada 20/set/2026). Aditiva e idempotente:
-- nao altera nem remove dados existentes. Gerada a partir de
-- rh_api/repositories/monitoria_schema.py (fonte unica do DDL; um teste garante
-- que este arquivo e o bootstrap runtime coincidem). Tabelas de fluxo/historico
-- recebem trigger INSTEAD OF UPDATE/DELETE (imutabilidade em camada de banco).

IF OBJECT_ID('dbo.equipes_operacao', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.equipes_operacao (
        id_equipe INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_equipes_operacao_ativo DEFAULT 1,
        criado_em DATETIME NOT NULL CONSTRAINT DF_equipes_operacao_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_equipes_operacao_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.usuarios_supervisores', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuarios_supervisores (
        id_operador INT NOT NULL,
        id_supervisor INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_usuarios_supervisores_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_usuarios_supervisores PRIMARY KEY (id_operador, id_supervisor)

    );
END;

IF OBJECT_ID('dbo.usuarios_operacoes_historico', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuarios_operacoes_historico (
        id_historico INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_usuario INT NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        acao NVARCHAR(30) NOT NULL,
        detalhe NVARCHAR(400) NULL,
        por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_usuarios_operacoes_historico_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_catalogo', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_catalogo (
        id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        tipo NVARCHAR(30) NOT NULL,
        operacao NVARCHAR(60) NULL,
        valor NVARCHAR(120) NOT NULL,
        ordem INT NOT NULL CONSTRAINT DF_monitoria_catalogo_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_monitoria_catalogo_ativo DEFAULT 1,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_catalogo_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_matrizes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_matrizes (
        id_matriz INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        nome NVARCHAR(180) NOT NULL,
        id_versao_ativa INT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_monitoria_matrizes_ativo DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_matrizes_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_matriz_versoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_matriz_versoes (
        id_versao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_matriz INT NOT NULL,
        numero INT NOT NULL,
        config_json NVARCHAR(MAX) NOT NULL,
        observacao NVARCHAR(400) NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_matriz_versoes_criado_em DEFAULT GETDATE(),
        CONSTRAINT UX_monitoria_matriz_versoes UNIQUE (id_matriz, numero)

    );
END;

IF OBJECT_ID('dbo.monitoria_rascunhos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_rascunhos (
        id_rascunho INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_avaliador INT NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        payload_json NVARCHAR(MAX) NOT NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_rascunhos_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitorias', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitorias (
        id_monitoria INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        codigo CHAR(8) NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        operacao_nome NVARCHAR(180) NULL,
        id_equipe INT NULL,
        equipe_nome NVARCHAR(120) NULL,
        turno NVARCHAR(30) NULL,
        id_operador INT NOT NULL,
        operador_nome NVARCHAR(180) NOT NULL,
        operador_email NVARCHAR(180) NULL,
        supervisores_json NVARCHAR(MAX) NULL,
        id_avaliador INT NOT NULL,
        avaliador_nome NVARCHAR(180) NOT NULL,
        id_matriz INT NOT NULL,
        id_versao INT NOT NULL,
        numero_versao INT NOT NULL,
        config_json NVARCHAR(MAX) NOT NULL,
        canal NVARCHAR(120) NOT NULL,
        tipo_atendimento NVARCHAR(120) NOT NULL,
        data_contato DATE NOT NULL,
        telefone NVARCHAR(40) NULL,
        id_interacao NVARCHAR(120) NULL,
        data_monitoria DATETIME NOT NULL,
        respostas_json NVARCHAR(MAX) NOT NULL,
        pilares_json NVARCHAR(MAX) NOT NULL,
        nota DECIMAL(6,2) NOT NULL,
        nivel NVARCHAR(60) NULL,
        possui_ncg BIT NOT NULL CONSTRAINT DF_monitorias_possui_ncg DEFAULT 0,
        motivo_ncg NVARCHAR(MAX) NULL,
        blocos_avaliados INT NOT NULL,
        blocos_nulos INT NOT NULL,
        anulada BIT NOT NULL CONSTRAINT DF_monitorias_anulada DEFAULT 0,
        justificativa_anulacao NVARCHAR(MAX) NULL,
        observacao NVARCHAR(MAX) NULL,
        sugestao_feedback NVARCHAR(MAX) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitorias_criado_em DEFAULT GETDATE(),
        CONSTRAINT UX_monitorias_codigo UNIQUE (codigo)

    );
END;

IF OBJECT_ID('dbo.monitoria_respostas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_respostas (
        id_resposta INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        id_bloco NVARCHAR(40) NOT NULL,
        bloco_nome NVARCHAR(180) NOT NULL,
        bloco_status NVARCHAR(12) NOT NULL,
        id_criterio NVARCHAR(40) NOT NULL,
        pergunta NVARCHAR(400) NOT NULL,
        peso DECIMAL(8,2) NOT NULL,
        resposta NVARCHAR(4) NOT NULL

    );
END;

IF OBJECT_ID('dbo.monitoria_pilares', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_pilares (
        id_pilar INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        indicador NVARCHAR(120) NOT NULL,
        nota INT NOT NULL

    );
END;

IF OBJECT_ID('dbo.monitoria_estado', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_estado (
        id_monitoria INT NOT NULL PRIMARY KEY,
        status NVARCHAR(40) NOT NULL,
        resultado NVARCHAR(20) NULL,
        sla_tipo NVARCHAR(30) NULL,
        sla_inicio DATETIME NULL,
        sla_limite DATETIME NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_estado_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_eventos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_eventos (
        id_evento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        status_anterior NVARCHAR(40) NULL,
        status_novo NVARCHAR(40) NOT NULL,
        id_usuario INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        perfil NVARCHAR(40) NULL,
        automatico BIT NOT NULL CONSTRAINT DF_monitoria_eventos_automatico DEFAULT 0,
        observacao NVARCHAR(MAX) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_eventos_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_feedbacks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_feedbacks (
        id_feedback INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        aplicado_por INT NOT NULL,
        aplicado_por_nome NVARCHAR(180) NOT NULL,
        data_aplicacao DATETIME NOT NULL CONSTRAINT DF_monitoria_feedbacks_data DEFAULT GETDATE(),
        observacao NVARCHAR(MAX) NULL,
        sugestao_original NVARCHAR(MAX) NULL,
        complemento NVARCHAR(MAX) NULL,
        prazo_sla DATETIME NULL,
        dentro_sla BIT NULL

    );
END;

IF OBJECT_ID('dbo.monitoria_contestacoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_contestacoes (
        id_contestacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NOT NULL,
        id_operador INT NOT NULL,
        data_contestacao DATETIME NOT NULL CONSTRAINT DF_monitoria_contestacoes_data DEFAULT GETDATE(),
        criterios_json NVARCHAR(MAX) NOT NULL,
        motivo NVARCHAR(400) NOT NULL,
        justificativa NVARCHAR(MAX) NOT NULL,
        prazo_sla DATETIME NULL,
        dentro_sla BIT NULL

    );
END;

IF OBJECT_ID('dbo.monitoria_replicas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_replicas (
        id_replica INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_contestacao INT NOT NULL,
        id_monitoria INT NOT NULL,
        id_autor INT NOT NULL,
        autor_nome NVARCHAR(180) NOT NULL,
        texto NVARCHAR(MAX) NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_replicas_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_reanalises', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_reanalises (
        id_reanalise INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_contestacao INT NOT NULL,
        id_monitoria INT NOT NULL,
        id_supervisor INT NULL,
        supervisor_nome NVARCHAR(180) NULL,
        resultado NVARCHAR(20) NOT NULL,
        observacao NVARCHAR(MAX) NOT NULL,
        automatico BIT NOT NULL CONSTRAINT DF_monitoria_reanalises_automatico DEFAULT 0,
        data_reanalise DATETIME NOT NULL CONSTRAINT DF_monitoria_reanalises_data DEFAULT GETDATE(),
        dentro_sla BIT NULL

    );
END;

IF OBJECT_ID('dbo.monitoria_anexos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_anexos (
        id_anexo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_contestacao INT NOT NULL,
        id_monitoria INT NOT NULL,
        nome_original NVARCHAR(255) NOT NULL,
        arquivo NVARCHAR(255) NOT NULL,
        mime NVARCHAR(120) NULL,
        tamanho INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_anexos_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_planos_acao', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_planos_acao (
        id_plano INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_monitoria INT NULL,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        operador_nome NVARCHAR(180) NOT NULL,
        origem NVARCHAR(120) NULL,
        id_responsavel INT NULL,
        responsavel_nome NVARCHAR(180) NULL,
        problema NVARCHAR(MAX) NOT NULL,
        criterio NVARCHAR(400) NULL,
        objetivo NVARCHAR(MAX) NOT NULL,
        acao NVARCHAR(MAX) NOT NULL,
        prazo DATE NOT NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_monitoria_planos_status DEFAULT 'ABERTO',
        data_revisao DATE NULL,
        resultado NVARCHAR(MAX) NULL,
        observacoes NVARCHAR(MAX) NULL,
        nota_antes DECIMAL(6,2) NULL,
        nota_depois DECIMAL(6,2) NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_planos_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_planos_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_plano_historico', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_plano_historico (
        id_historico INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_plano INT NOT NULL,
        evento NVARCHAR(40) NOT NULL,
        status_anterior NVARCHAR(20) NULL,
        status_novo NVARCHAR(20) NULL,
        detalhe NVARCHAR(MAX) NULL,
        por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_plano_historico_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_logs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_logs (
        id_log INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_usuario INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        perfil NVARCHAR(40) NULL,
        operacao NVARCHAR(60) NULL,
        acao NVARCHAR(120) NOT NULL,
        modulo NVARCHAR(60) NULL,
        entidade NVARCHAR(60) NULL,
        entidade_id NVARCHAR(80) NULL,
        ip NVARCHAR(64) NULL,
        resultado NVARCHAR(10) NOT NULL CONSTRAINT DF_monitoria_logs_resultado DEFAULT 'SUCESSO',
        detalhes NVARCHAR(MAX) NULL,
        estado_anterior NVARCHAR(MAX) NULL,
        estado_posterior NVARCHAR(MAX) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_logs_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_guia', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_guia (
        id_guia INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        titulo NVARCHAR(180) NOT NULL,
        conteudo NVARCHAR(MAX) NOT NULL,
        ordem INT NOT NULL CONSTRAINT DF_monitoria_guia_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_monitoria_guia_ativo DEFAULT 1,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_guia_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.monitoria_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_config (
        chave NVARCHAR(80) NOT NULL PRIMARY KEY,
        valor NVARCHAR(MAX) NOT NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_monitoria_config_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.operacoes', 'cor_primaria') IS NULL
BEGIN
    ALTER TABLE dbo.operacoes ADD cor_primaria NVARCHAR(9) NULL;
END;

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.operacoes', 'logo_arquivo') IS NULL
BEGIN
    ALTER TABLE dbo.operacoes ADD logo_arquivo NVARCHAR(255) NULL;
END;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'turno') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD turno NVARCHAR(30) NULL;
END;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'id_equipe') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD id_equipe INT NULL;
END;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'deve_trocar_senha') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD deve_trocar_senha BIT NULL;
END;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'tema_operacao') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD tema_operacao NVARCHAR(60) NULL;
END;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'tema_operacao_alterado') IS NULL
BEGIN
    ALTER TABLE dbo.usuarios ADD tema_operacao_alterado BIT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitorias_operacao_data' AND object_id = OBJECT_ID('dbo.monitorias'))
BEGIN
    CREATE INDEX IX_monitorias_operacao_data ON dbo.monitorias(operacao, data_monitoria);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitorias_operador' AND object_id = OBJECT_ID('dbo.monitorias'))
BEGIN
    CREATE INDEX IX_monitorias_operador ON dbo.monitorias(id_operador, data_monitoria);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitorias_avaliador' AND object_id = OBJECT_ID('dbo.monitorias'))
BEGIN
    CREATE INDEX IX_monitorias_avaliador ON dbo.monitorias(id_avaliador);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitorias_interacao' AND object_id = OBJECT_ID('dbo.monitorias'))
BEGIN
    CREATE INDEX IX_monitorias_interacao ON dbo.monitorias(id_interacao);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitoria_respostas_monitoria' AND object_id = OBJECT_ID('dbo.monitoria_respostas'))
BEGIN
    CREATE INDEX IX_monitoria_respostas_monitoria ON dbo.monitoria_respostas(id_monitoria);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitoria_eventos_monitoria' AND object_id = OBJECT_ID('dbo.monitoria_eventos'))
BEGIN
    CREATE INDEX IX_monitoria_eventos_monitoria ON dbo.monitoria_eventos(id_monitoria, criado_em);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitoria_estado_status' AND object_id = OBJECT_ID('dbo.monitoria_estado'))
BEGIN
    CREATE INDEX IX_monitoria_estado_status ON dbo.monitoria_estado(status, sla_limite);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_monitoria_logs_data' AND object_id = OBJECT_ID('dbo.monitoria_logs'))
BEGIN
    CREATE INDEX IX_monitoria_logs_data ON dbo.monitoria_logs(criado_em, operacao);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_equipes_operacao_operacao' AND object_id = OBJECT_ID('dbo.equipes_operacao'))
BEGIN
    CREATE INDEX IX_equipes_operacao_operacao ON dbo.equipes_operacao(operacao, ativo);
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_matriz_versoes_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_matriz_versoes_imutavel ON dbo.monitoria_matriz_versoes INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_matriz_versoes nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitorias_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitorias_imutavel ON dbo.monitorias INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitorias nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_respostas_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_respostas_imutavel ON dbo.monitoria_respostas INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_respostas nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_pilares_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_pilares_imutavel ON dbo.monitoria_pilares INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_pilares nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_eventos_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_eventos_imutavel ON dbo.monitoria_eventos INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_eventos nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_feedbacks_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_feedbacks_imutavel ON dbo.monitoria_feedbacks INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_feedbacks nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_contestacoes_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_contestacoes_imutavel ON dbo.monitoria_contestacoes INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_contestacoes nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_replicas_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_replicas_imutavel ON dbo.monitoria_replicas INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_replicas nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_reanalises_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_reanalises_imutavel ON dbo.monitoria_reanalises INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_reanalises nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_anexos_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_anexos_imutavel ON dbo.monitoria_anexos INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_anexos nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_plano_historico_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_plano_historico_imutavel ON dbo.monitoria_plano_historico INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_plano_historico nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_monitoria_logs_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_monitoria_logs_imutavel ON dbo.monitoria_logs INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: monitoria_logs nao aceita UPDATE nem DELETE.'', 1; END');
END;

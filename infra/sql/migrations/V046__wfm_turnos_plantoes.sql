-- Conecta - WFM (Turnos e Plantoes), Fase 1. Aditiva e idempotente: nao altera nem
-- remove dados existentes. Gerada a partir de rh_api/repositories/wfm_schema.py (um
-- teste garante que coincide com o bootstrap runtime). wfm_escala_versoes e
-- wfm_auditoria recebem trigger INSTEAD OF UPDATE/DELETE (imutaveis).

IF OBJECT_ID('dbo.wfm_contratos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_contratos (
        id_contrato INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        codigo NVARCHAR(30) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        jornada_diaria_max_min INT NOT NULL,
        interjornada_min_min INT NOT NULL,
        max_dias_consecutivos INT NOT NULL,
        jornada_feriado_max_min INT NULL,
        jornada_bloqueio_duro BIT NOT NULL CONSTRAINT DF_wfm_contratos_duro DEFAULT 0,
        exigencias_pausa_json NVARCHAR(MAX) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_contratos_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_contratos_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_contratos UNIQUE (operacao, codigo)

    );
END;

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_turnos (
        id_turno INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        codigo NVARCHAR(20) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        tipo NVARCHAR(12) NOT NULL CONSTRAINT DF_wfm_turnos_tipo DEFAULT 'TRABALHO',
        cor NVARCHAR(9) NOT NULL CONSTRAINT DF_wfm_turnos_cor DEFAULT '#1f5fbf',
        entrada NVARCHAR(5) NULL,
        saida NVARCHAR(5) NULL,
        pausas_json NVARCHAR(MAX) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_turnos_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_turnos_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_turnos UNIQUE (operacao, codigo)

    );
END;

IF OBJECT_ID('dbo.wfm_skills', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_skills (
        id_skill INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        categoria NVARCHAR(20) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_skills_ativo DEFAULT 1,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_skills_criado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_skills UNIQUE (operacao, categoria, nome)

    );
END;

IF OBJECT_ID('dbo.wfm_usuario_skills', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_usuario_skills (
        operacao NVARCHAR(60) NOT NULL,
        id_usuario INT NOT NULL,
        id_skill INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_usuario_skills_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_wfm_usuario_skills PRIMARY KEY (operacao, id_usuario, id_skill)

    );
END;

IF OBJECT_ID('dbo.wfm_operador_contratos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_operador_contratos (
        id_vinculo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        id_contrato INT NOT NULL,
        vigencia_ini DATE NOT NULL,
        vigencia_fim DATE NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_operador_contratos_criado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.wfm_calendario_especial', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_calendario_especial (
        id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        data_ini DATE NOT NULL,
        data_fim DATE NOT NULL,
        descricao NVARCHAR(200) NOT NULL,
        id_turno INT NULL,
        entrada NVARCHAR(5) NULL,
        saida NVARCHAR(5) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_calendario_especial_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_calendario_especial_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_escalas (
        operacao NVARCHAR(60) NOT NULL,
        ano_mes NVARCHAR(7) NOT NULL,
        versao_publicada INT NOT NULL CONSTRAINT DF_wfm_escalas_versao DEFAULT 0,
        fechada BIT NOT NULL CONSTRAINT DF_wfm_escalas_fechada DEFAULT 0,
        fechada_por NVARCHAR(180) NULL,
        fechada_em DATETIME NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_escalas_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT PK_wfm_escalas PRIMARY KEY (operacao, ano_mes)

    );
END;

IF OBJECT_ID('dbo.wfm_escala_itens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_escala_itens (
        id_item INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        ano_mes NVARCHAR(7) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        id_turno INT NOT NULL,
        versao_linha INT NOT NULL CONSTRAINT DF_wfm_escala_itens_versao DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_escala_itens_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_escala_itens UNIQUE (operacao, id_operador, data)

    );
END;

IF OBJECT_ID('dbo.wfm_escala_versoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_escala_versoes (
        id_versao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        ano_mes NVARCHAR(7) NOT NULL,
        versao INT NOT NULL,
        publicado_por INT NULL,
        publicado_por_nome NVARCHAR(180) NULL,
        publicado_em DATETIME NOT NULL CONSTRAINT DF_wfm_escala_versoes_publicado_em DEFAULT GETDATE(),
        com_violacao BIT NOT NULL CONSTRAINT DF_wfm_escala_versoes_violacao DEFAULT 0,
        justificativa NVARCHAR(400) NULL,
        violacoes_json NVARCHAR(MAX) NULL,
        snapshot_json NVARCHAR(MAX) NOT NULL,
        CONSTRAINT UQ_wfm_escala_versoes UNIQUE (operacao, ano_mes, versao)

    );
END;

IF OBJECT_ID('dbo.wfm_presencas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_presencas (
        id_presenca INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        status NVARCHAR(12) NOT NULL,
        observacao NVARCHAR(300) NULL,
        lancado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_presencas_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_presencas UNIQUE (operacao, id_operador, data)

    );
END;

IF OBJECT_ID('dbo.wfm_atestados', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_atestados (
        id_atestado INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data_ini DATE NOT NULL,
        data_fim DATE NOT NULL,
        tipo NVARCHAR(30) NOT NULL,
        validado_por NVARCHAR(180) NOT NULL,
        validado_em DATETIME NOT NULL CONSTRAINT DF_wfm_atestados_validado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.wfm_auditoria', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_auditoria (
        id_auditoria INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_usuario INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        perfil NVARCHAR(40) NULL,
        acao NVARCHAR(40) NOT NULL,
        entidade NVARCHAR(40) NOT NULL,
        entidade_id NVARCHAR(60) NULL,
        antes_json NVARCHAR(MAX) NULL,
        depois_json NVARCHAR(MAX) NULL,
        justificativa NVARCHAR(400) NULL,
        ip NVARCHAR(64) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_auditoria_criado_em DEFAULT GETDATE()

    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_escala_itens_periodo' AND object_id = OBJECT_ID('dbo.wfm_escala_itens'))
BEGIN
    CREATE INDEX IX_wfm_escala_itens_periodo ON dbo.wfm_escala_itens(operacao, ano_mes, id_operador);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_presencas_data' AND object_id = OBJECT_ID('dbo.wfm_presencas'))
BEGIN
    CREATE INDEX IX_wfm_presencas_data ON dbo.wfm_presencas(operacao, data);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_auditoria_operacao' AND object_id = OBJECT_ID('dbo.wfm_auditoria'))
BEGIN
    CREATE INDEX IX_wfm_auditoria_operacao ON dbo.wfm_auditoria(operacao, criado_em);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_calendario_periodo' AND object_id = OBJECT_ID('dbo.wfm_calendario_especial'))
BEGIN
    CREATE INDEX IX_wfm_calendario_periodo ON dbo.wfm_calendario_especial(operacao, data_ini, data_fim);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_operador_contratos' AND object_id = OBJECT_ID('dbo.wfm_operador_contratos'))
BEGIN
    CREATE INDEX IX_wfm_operador_contratos ON dbo.wfm_operador_contratos(operacao, id_operador, vigencia_ini);
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_wfm_escala_versoes_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_wfm_escala_versoes_imutavel ON dbo.wfm_escala_versoes INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: wfm_escala_versoes nao aceita UPDATE nem DELETE.'', 1; END');
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_wfm_auditoria_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_wfm_auditoria_imutavel ON dbo.wfm_auditoria INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: wfm_auditoria nao aceita UPDATE nem DELETE.'', 1; END');
END;

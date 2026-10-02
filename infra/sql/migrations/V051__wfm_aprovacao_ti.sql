-- Conecta - WFM: aprovacao da escala antes da publicacao e setor de Tecnologia (TI) com tipos de
-- escala cadastraveis. Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_estado') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_estado NVARCHAR(20) NOT NULL CONSTRAINT DF_wfm_escalas_aprov_estado DEFAULT 'RASCUNHO';
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_enviado_por') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_enviado_por INT NULL;
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_enviado_nome') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_enviado_nome NVARCHAR(180) NULL;
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_enviado_em') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_enviado_em DATETIME NULL;
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_decidido_por') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_decidido_por NVARCHAR(180) NULL;
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_decidido_em') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_decidido_em DATETIME NULL;
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_motivo') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_motivo NVARCHAR(400) NULL;
END;

IF OBJECT_ID('dbo.wfm_escalas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escalas', 'aprov_hash') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escalas ADD aprov_hash NVARCHAR(64) NULL;
END;

IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_tipos_escala (
        id_tipo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao_base NVARCHAR(60) NOT NULL,
        chave NVARCHAR(60) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        descricao NVARCHAR(200) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_wfm_tipos_escala_ativo DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_tipos_escala_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_tipos_escala_chave UNIQUE (chave)

    );
END;

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.operacoes WHERE chave = 'TI')
BEGIN
    INSERT INTO dbo.operacoes (chave, nome, descricao, categoria, payload_json, ativo, usado)
    VALUES ('TI', N'Tecnologia (TI)', NULL, N'Tecnologia', N'{}', 1, 1);
END;

IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NOT NULL
BEGIN
IF NOT EXISTS (SELECT 1 FROM dbo.wfm_tipos_escala WHERE chave = 'TI::PLANTAO-SABADO')
    INSERT INTO dbo.wfm_tipos_escala (operacao_base, chave, nome, descricao, criado_por)
    VALUES ('TI', 'TI::PLANTAO-SABADO', N'Plantão de sábado', N'Escala de plantão de sábado da equipe de TI.', 'sistema');
IF NOT EXISTS (SELECT 1 FROM dbo.wfm_tipos_escala WHERE chave = 'TI::SOBREAVISO')
    INSERT INTO dbo.wfm_tipos_escala (operacao_base, chave, nome, descricao, criado_por)
    VALUES ('TI', 'TI::SOBREAVISO', N'Sobreaviso', N'Escala de sobreaviso da equipe de TI.', 'sistema');
END;

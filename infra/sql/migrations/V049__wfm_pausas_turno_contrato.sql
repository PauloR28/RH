-- Conecta - WFM: turno-modelo ligado a contrato, capacidade de pausas por operacao e escala de
-- pausas individual. Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_operacao_config (
        operacao NVARCHAR(60) NOT NULL PRIMARY KEY,
        pausas_simultaneas INT NOT NULL CONSTRAINT DF_wfm_operacao_config_simult DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_operacao_config_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.wfm_pausas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_pausas (
        id_pausa INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        ordem INT NOT NULL,
        tipo NVARCHAR(12) NOT NULL,
        inicio NVARCHAR(5) NOT NULL,
        duracao_min INT NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_pausas_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_pausas UNIQUE (operacao, id_operador, data, ordem)

    );
END;

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'id_contrato') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos ADD id_contrato INT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_pausas_dia' AND object_id = OBJECT_ID('dbo.wfm_pausas'))
BEGIN
    CREATE INDEX IX_wfm_pausas_dia ON dbo.wfm_pausas(operacao, data);
END;

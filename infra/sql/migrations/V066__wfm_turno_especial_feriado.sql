-- Conecta - WFM V066: turno especial, limite de escalas por operador e feriado que gera servico.
-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema_v066.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'especial') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos ADD especial BIT NOT NULL CONSTRAINT DF_wfm_turnos_especial DEFAULT 0;
END;

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'max_escalas_operador') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config ADD max_escalas_operador INT NOT NULL CONSTRAINT DF_wfm_operacao_config_max_escalas DEFAULT 4;
END;

IF OBJECT_ID('dbo.wfm_calendario_especial', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_calendario_especial', 'gera_servico') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_calendario_especial ADD gera_servico BIT NOT NULL CONSTRAINT DF_wfm_calendario_especial_gera_servico DEFAULT 0;
END;

IF OBJECT_ID('dbo.wfm_calendario_especial', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_calendario_especial', 'servico_json') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_calendario_especial ADD servico_json NVARCHAR(MAX) NULL;
END;

-- Rollback da V066. Remove as colunas aditivas (turnos especiais, limite por escala e servico de feriado sao perdidos).
IF COL_LENGTH('dbo.wfm_turnos', 'especial') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos DROP CONSTRAINT DF_wfm_turnos_especial;
    ALTER TABLE dbo.wfm_turnos DROP COLUMN especial;
END;
IF COL_LENGTH('dbo.wfm_operacao_config', 'max_escalas_operador') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config DROP CONSTRAINT DF_wfm_operacao_config_max_escalas;
    ALTER TABLE dbo.wfm_operacao_config DROP COLUMN max_escalas_operador;
END;
IF COL_LENGTH('dbo.wfm_calendario_especial', 'gera_servico') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_calendario_especial DROP CONSTRAINT DF_wfm_calendario_especial_gera_servico;
    ALTER TABLE dbo.wfm_calendario_especial DROP COLUMN gera_servico;
END;
IF COL_LENGTH('dbo.wfm_calendario_especial', 'servico_json') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_calendario_especial DROP COLUMN servico_json;
END;

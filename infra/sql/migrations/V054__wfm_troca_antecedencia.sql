-- Conecta - WFM: antecedencia minima (dias) para pedir troca de plantao, configuravel por escala (padrao 3).
-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'troca_antecedencia_dias') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config ADD troca_antecedencia_dias INT NOT NULL CONSTRAINT DF_wfm_operacao_config_troca_ant DEFAULT 3;
END;

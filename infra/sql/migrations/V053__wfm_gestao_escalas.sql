-- Conecta - WFM: escala ativa/inativa, excluida (logica) e jornada padrao da escala; turno excluido (logico) e codigo reutilizavel.
-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'ativa') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config ADD ativa BIT NOT NULL CONSTRAINT DF_wfm_operacao_config_ativa DEFAULT 1;
END;

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'id_contrato') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config ADD id_contrato INT NULL;
END;

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'excluida') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config ADD excluida BIT NOT NULL CONSTRAINT DF_wfm_operacao_config_excluida DEFAULT 0;
END;

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'excluido') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos ADD excluido BIT NOT NULL CONSTRAINT DF_wfm_turnos_excluido DEFAULT 0;
END;

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_wfm_turnos')
BEGIN
    ALTER TABLE dbo.wfm_turnos DROP CONSTRAINT UQ_wfm_turnos;
END;

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_wfm_turnos_codigo' AND object_id = OBJECT_ID('dbo.wfm_turnos'))
BEGIN
    CREATE UNIQUE INDEX UX_wfm_turnos_codigo ON dbo.wfm_turnos (operacao, codigo) WHERE excluido = 0;
END;

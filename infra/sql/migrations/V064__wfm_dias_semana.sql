-- Conecta - WFM V064: escala por dia da semana (weekdays do turno, dia manual na escala, origem da pausa).
-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema_v064.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'weekdays') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos ADD weekdays NVARCHAR(7) NOT NULL CONSTRAINT DF_wfm_turnos_weekdays DEFAULT '1111111';
END;

IF OBJECT_ID('dbo.wfm_escala_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escala_itens', 'manual') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escala_itens ADD manual BIT NOT NULL CONSTRAINT DF_wfm_escala_itens_manual DEFAULT 0;
END;

IF OBJECT_ID('dbo.wfm_pausas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_pausas', 'origem') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_pausas ADD origem NVARCHAR(6) NOT NULL CONSTRAINT DF_wfm_pausas_origem DEFAULT 'AUTO';
END;

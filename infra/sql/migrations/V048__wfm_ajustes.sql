-- Conecta - WFM: ajustes de schema (alarga wfm_presencas.status para NVARCHAR(20)).
-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py (teste garante que coincide).

IF OBJECT_ID('dbo.wfm_presencas', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_presencas', 'status') < 40
BEGIN
    ALTER TABLE dbo.wfm_presencas ALTER COLUMN status NVARCHAR(20) NOT NULL;
END;

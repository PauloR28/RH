-- Rollback da V064. Remove as colunas aditivas (os dias do turno e as marcas manuais sao perdidos).
IF COL_LENGTH('dbo.wfm_turnos', 'weekdays') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos DROP CONSTRAINT DF_wfm_turnos_weekdays;
    ALTER TABLE dbo.wfm_turnos DROP COLUMN weekdays;
END;
IF COL_LENGTH('dbo.wfm_escala_itens', 'manual') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_escala_itens DROP CONSTRAINT DF_wfm_escala_itens_manual;
    ALTER TABLE dbo.wfm_escala_itens DROP COLUMN manual;
END;
IF COL_LENGTH('dbo.wfm_pausas', 'origem') IS NOT NULL
BEGIN
    ALTER TABLE dbo.wfm_pausas DROP CONSTRAINT DF_wfm_pausas_origem;
    ALTER TABLE dbo.wfm_pausas DROP COLUMN origem;
END;

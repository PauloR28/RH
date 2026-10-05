-- Rollback da V061. Recusa se existir personalizacao de turno (os horarios proprios seriam perdidos).
IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.wfm_turno_personalizacoes)
    THROW 50000, 'Existem turnos personalizados: exporte/remova-os antes do rollback.', 1;
IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NOT NULL DROP TABLE dbo.wfm_turno_personalizacoes;
IF COL_LENGTH('dbo.wfm_contratos', 'jornada_semanal_max_min') IS NOT NULL ALTER TABLE dbo.wfm_contratos DROP COLUMN jornada_semanal_max_min;

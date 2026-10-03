-- Rollback da V056: remove as colunas de dono do modulo. Nao toca em perfil_permissoes.
IF COL_LENGTH('dbo.permissoes', 'abre_modulo') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_permissoes_abre_modulo')
        ALTER TABLE dbo.permissoes DROP CONSTRAINT DF_permissoes_abre_modulo;
    ALTER TABLE dbo.permissoes DROP COLUMN abre_modulo;
END;
IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    ALTER TABLE dbo.permissoes DROP COLUMN modulo_dono;

-- QA T2-TRE-01: o treinamento só podia ser atribuído a candidatos
-- (candidatos_processos). Usuários do sistema (operador, funcionário,
-- supervisor...) e operações inteiras não apareciam como participantes.
-- Adiciona onboarding_candidatos.id_usuario e permite id_registro NULL
-- (atribuição por usuário). Nenhuma linha existente é alterada.
-- Espelha ensure_onboarding_tables (bootstrap.py).
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.onboarding_candidatos', 'id_usuario') IS NULL
        ALTER TABLE dbo.onboarding_candidatos ADD id_usuario INT NULL;

    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.onboarding_candidatos') AND name = 'id_registro' AND is_nullable = 0
    )
    BEGIN
        IF EXISTS (
            SELECT 1 FROM sys.indexes
            WHERE name = 'IX_onboarding_candidatos_id_registro' AND object_id = OBJECT_ID('dbo.onboarding_candidatos')
        )
            DROP INDEX IX_onboarding_candidatos_id_registro ON dbo.onboarding_candidatos;
        ALTER TABLE dbo.onboarding_candidatos ALTER COLUMN id_registro INT NULL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_onboarding_candidatos_id_registro' AND object_id = OBJECT_ID('dbo.onboarding_candidatos')
    )
        CREATE INDEX IX_onboarding_candidatos_id_registro ON dbo.onboarding_candidatos(id_registro);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_onboarding_candidatos_id_usuario' AND object_id = OBJECT_ID('dbo.onboarding_candidatos')
)
    EXEC(N'CREATE INDEX IX_onboarding_candidatos_id_usuario ON dbo.onboarding_candidatos(id_usuario)');

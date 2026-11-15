-- Rollback da V070: remove tipo e modulo das operacoes. Seguro: nenhuma rota antiga le essas colunas.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_operacoes_modulo' AND object_id = OBJECT_ID('dbo.operacoes'))
    DROP INDEX IX_operacoes_modulo ON dbo.operacoes;
IF OBJECT_ID('dbo.FK_operacoes_modulo', 'F') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP CONSTRAINT FK_operacoes_modulo;
IF OBJECT_ID('dbo.CK_operacoes_modulo', 'C') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP CONSTRAINT CK_operacoes_modulo;
IF OBJECT_ID('dbo.CK_operacoes_tipo', 'C') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP CONSTRAINT CK_operacoes_tipo;
IF OBJECT_ID('dbo.DF_operacoes_modulo', 'D') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP CONSTRAINT DF_operacoes_modulo;
IF OBJECT_ID('dbo.DF_operacoes_tipo', 'D') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP CONSTRAINT DF_operacoes_tipo;
IF COL_LENGTH('dbo.operacoes', 'modulo') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP COLUMN modulo;
IF COL_LENGTH('dbo.operacoes', 'tipo') IS NOT NULL
    ALTER TABLE dbo.operacoes DROP COLUMN tipo;

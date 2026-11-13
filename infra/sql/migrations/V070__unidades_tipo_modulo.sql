-- Conecta - Central de Acessos, Etapa 3 (V070): Unidade = Operacao ou Setor, com tipo e modulo obrigatorio.
-- Reaproveita dbo.operacoes; vinculos por operacoes.chave continuam iguais. Aditiva, idempotente e reversivel.
-- Gerada de rh_api/repositories/unidades_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.operacoes', 'tipo') IS NULL
BEGIN
    ALTER TABLE dbo.operacoes ADD tipo NVARCHAR(10) NOT NULL CONSTRAINT DF_operacoes_tipo DEFAULT 'operacao';
END;

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.operacoes', 'modulo') IS NULL
BEGIN
    ALTER TABLE dbo.operacoes ADD modulo NVARCHAR(30) NOT NULL CONSTRAINT DF_operacoes_modulo DEFAULT 'operacao';
END;

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.CK_operacoes_tipo', 'C') IS NULL
    EXEC sp_executesql N'ALTER TABLE dbo.operacoes ADD CONSTRAINT CK_operacoes_tipo CHECK (tipo IN (''operacao'', ''setor''));';

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.CK_operacoes_modulo', 'C') IS NULL
    EXEC sp_executesql N'ALTER TABLE dbo.operacoes ADD CONSTRAINT CK_operacoes_modulo CHECK (modulo <> ''core'');';

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL
    EXEC sp_executesql N'UPDATE dbo.operacoes SET tipo = ''setor'', modulo = ''tecnologia'' WHERE chave = ''TI'' AND tipo = ''operacao'' AND modulo = ''operacao'';';

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND OBJECT_ID('dbo.FK_operacoes_modulo', 'F') IS NULL
    EXEC sp_executesql N'ALTER TABLE dbo.operacoes ADD CONSTRAINT FK_operacoes_modulo FOREIGN KEY (modulo) REFERENCES dbo.modulos_sistema (chave);';

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_operacoes_modulo' AND object_id = OBJECT_ID('dbo.operacoes'))
    EXEC sp_executesql N'CREATE INDEX IX_operacoes_modulo ON dbo.operacoes (modulo, ativo) INCLUDE (chave, nome, tipo);';

-- Conecta - Modularizacao (V055): registro dos modulos (core, rh, operacao, tecnologia).
-- Aditiva e idempotente. Gerada de rh_api/repositories/modulos_schema.py.

IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.modulos_sistema (
        chave NVARCHAR(30) NOT NULL CONSTRAINT PK_modulos_sistema PRIMARY KEY,
        nome NVARCHAR(80) NOT NULL,
        ordem INT NOT NULL CONSTRAINT DF_modulos_sistema_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_modulos_sistema_ativo DEFAULT 1,
        protegido BIT NOT NULL CONSTRAINT DF_modulos_sistema_protegido DEFAULT 0,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_modulos_sistema_atualizado_em DEFAULT GETDATE(),
        atualizado_por NVARCHAR(180) NULL
    );
END;

IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_sistema WHERE chave = 'core')
    INSERT INTO dbo.modulos_sistema (chave, nome, ordem, ativo, protegido) VALUES ('core', N'Conecta', 0, 1, 1);

IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_sistema WHERE chave = 'rh')
    INSERT INTO dbo.modulos_sistema (chave, nome, ordem, ativo, protegido) VALUES ('rh', N'RH', 1, 1, 0);

IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_sistema WHERE chave = 'operacao')
    INSERT INTO dbo.modulos_sistema (chave, nome, ordem, ativo, protegido) VALUES ('operacao', N'Opera' + NCHAR(231) + NCHAR(227) + N'o', 2, 1, 0);

IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_sistema WHERE chave = 'tecnologia')
    INSERT INTO dbo.modulos_sistema (chave, nome, ordem, ativo, protegido) VALUES ('tecnologia', N'Tecnologia', 3, 1, 1);

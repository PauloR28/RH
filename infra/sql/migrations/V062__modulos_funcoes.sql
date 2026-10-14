-- Conecta - Modularizacao (V062): funcoes que cada modulo exibe no menu (modulos_funcoes).
-- Aditiva e idempotente; o seed nao sobrescreve escolhas ja feitas. Gerada de rh_api/repositories/modulos_funcoes_schema.py.

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.modulos_funcoes (
        modulo NVARCHAR(30) NOT NULL,
        funcao NVARCHAR(40) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_modulos_funcoes_ativo DEFAULT 0,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_modulos_funcoes_atualizado_em DEFAULT GETDATE(),
        atualizado_por NVARCHAR(180) NULL,
        CONSTRAINT PK_modulos_funcoes PRIMARY KEY (modulo, funcao)
    );
END;

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'cx-curriculos')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'cx-curriculos', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'processos')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'processos', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'provas')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'provas', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'gestao')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'gestao', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'drive')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'drive', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'monitoria')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'monitoria', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'rh' AND funcao = 'wfm')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('rh', 'wfm', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'cx-curriculos')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'cx-curriculos', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'processos')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'processos', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'provas')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'provas', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'gestao')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'gestao', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'drive')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'drive', 0);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'monitoria')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'monitoria', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'operacao' AND funcao = 'wfm')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('operacao', 'wfm', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'tecnologia' AND funcao = 'suporte')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('tecnologia', 'suporte', 1);

IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.modulos_funcoes WHERE modulo = 'tecnologia' AND funcao = 'wfm')
    INSERT INTO dbo.modulos_funcoes (modulo, funcao, ativo) VALUES ('tecnologia', 'wfm', 1);

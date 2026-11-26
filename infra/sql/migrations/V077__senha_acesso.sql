-- Conecta - V077: fluxo de senha do acesso por Login (esqueci a senha, senha temporaria, bloqueio, sessao unica).
-- Aditiva e idempotente. Gerada de rh_api/repositories/senha_acesso_schema.py (um teste garante que coincide).

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'sessao_web_id') IS NULL
    ALTER TABLE dbo.usuarios ADD sessao_web_id NVARCHAR(40) NULL;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'falhas_login') IS NULL
    ALTER TABLE dbo.usuarios ADD falhas_login INT NULL;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'bloqueado_ate') IS NULL
    ALTER TABLE dbo.usuarios ADD bloqueado_ate DATETIME NULL;

IF OBJECT_ID('dbo.usuarios', 'U') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'senha_temporaria_expira_em') IS NULL
    ALTER TABLE dbo.usuarios ADD senha_temporaria_expira_em DATETIME NULL;

IF OBJECT_ID('dbo.senha_recuperacoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.senha_recuperacoes (
        id_recuperacao INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_senha_recuperacoes PRIMARY KEY,
        id_usuario INT NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        segredo_hash NVARCHAR(255) NOT NULL,
        enviado_para NVARCHAR(255) NULL,
        id_destinatario INT NULL,
        expira_em DATETIME NOT NULL,
        tentativas INT NOT NULL CONSTRAINT DF_senha_recuperacoes_tentativas DEFAULT 0,
        usado_em DATETIME NULL,
        cancelado_em DATETIME NULL,
        origem NVARCHAR(64) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_senha_recuperacoes_criado_em DEFAULT GETDATE()
    );
END;

IF OBJECT_ID('dbo.senha_recuperacoes', 'U') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_senha_recuperacoes_usuario' AND object_id = OBJECT_ID('dbo.senha_recuperacoes'))
    CREATE INDEX IX_senha_recuperacoes_usuario ON dbo.senha_recuperacoes (id_usuario, criado_em DESC);

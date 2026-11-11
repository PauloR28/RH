-- Conecta - modulos por operacao (lista 10/11, item 16). Aditiva e idempotente.
-- Gerada a partir de rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.operacoes_modulos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.operacoes_modulos (
        operacao NVARCHAR(60) NOT NULL,
        funcao NVARCHAR(40) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_operacoes_modulos_ativo DEFAULT 1,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_operacoes_modulos_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT PK_operacoes_modulos PRIMARY KEY (operacao, funcao)

    );
END;

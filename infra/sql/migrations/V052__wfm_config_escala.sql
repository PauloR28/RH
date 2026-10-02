-- Conecta - WFM: nome da escala e aprovadores (perfis/usuarios) por escala. Aditiva e idempotente.
-- Gerada de rh_api/repositories/wfm_schema.py.

IF OBJECT_ID('dbo.wfm_operacao_config', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_operacao_config', 'nome_escala') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_operacao_config ADD nome_escala NVARCHAR(120) NULL;
END;

IF OBJECT_ID('dbo.wfm_aprovadores', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_aprovadores (
        id_aprovador INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        tipo NVARCHAR(10) NOT NULL,
        valor NVARCHAR(60) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_aprovadores_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_aprovadores UNIQUE (operacao, tipo, valor)

    );
END;

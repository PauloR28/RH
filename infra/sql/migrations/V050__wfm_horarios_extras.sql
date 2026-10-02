-- Conecta - WFM: horario ajustado por dia na escala (entrada_ajuste/saida_ajuste) e lancamento de
-- hora extra. Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema.py.

IF OBJECT_ID('dbo.wfm_escala_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escala_itens', 'entrada_ajuste') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escala_itens ADD entrada_ajuste NVARCHAR(5) NULL;
END;

IF OBJECT_ID('dbo.wfm_escala_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_escala_itens', 'saida_ajuste') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_escala_itens ADD saida_ajuste NVARCHAR(5) NULL;
END;

IF OBJECT_ID('dbo.wfm_turnos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_turnos', 'id_supervisor') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_turnos ADD id_supervisor INT NULL;
END;

IF OBJECT_ID('dbo.wfm_horas_extras', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_horas_extras (
        id_hora_extra INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_operador INT NOT NULL,
        data DATE NOT NULL,
        minutos INT NOT NULL,
        observacao NVARCHAR(200) NULL,
        lancado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_horas_extras_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_horas_extras UNIQUE (operacao, id_operador, data)

    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_horas_extras_data' AND object_id = OBJECT_ID('dbo.wfm_horas_extras'))
BEGIN
    CREATE INDEX IX_wfm_horas_extras_data ON dbo.wfm_horas_extras(operacao, data);
END;

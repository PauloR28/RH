-- Conecta - WFM V061: limite semanal da jornada e personalizacao de turno por colaborador.
-- Aditiva e idempotente. Gerada de rh_api/repositories/wfm_schema_v061.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.wfm_contratos', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_contratos', 'jornada_semanal_max_min') IS NULL
BEGIN
    ALTER TABLE dbo.wfm_contratos ADD jornada_semanal_max_min INT NULL;
END;

IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_turno_personalizacoes (
        id_personalizacao INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_wfm_turno_personalizacoes PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_turno INT NOT NULL,
        id_operador INT NOT NULL,
        entrada NVARCHAR(5) NOT NULL,
        saida NVARCHAR(5) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_turno_personalizacoes_atualizado_em DEFAULT GETDATE(),
        CONSTRAINT UQ_wfm_turno_personalizacoes UNIQUE (id_turno, id_operador)
    );
END;

IF OBJECT_ID('dbo.wfm_turno_personalizacoes', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_turno_personalizacoes_operador' AND object_id = OBJECT_ID('dbo.wfm_turno_personalizacoes'))
BEGIN
    CREATE INDEX IX_wfm_turno_personalizacoes_operador ON dbo.wfm_turno_personalizacoes(operacao, id_operador);
END;

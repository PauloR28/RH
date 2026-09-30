-- Conecta - WFM: solicitacao de troca de plantoes. Aditiva e idempotente. Gerada a partir de
-- rh_api/repositories/wfm_schema.py (um teste garante que coincide com o bootstrap).
-- wfm_trocas_eventos recebe trigger INSTEAD OF UPDATE/DELETE (historico imutavel).

IF OBJECT_ID('dbo.wfm_trocas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_trocas (
        id_troca INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_solicitante INT NOT NULL,
        id_alvo INT NOT NULL,
        data_a DATE NOT NULL,
        data_b DATE NOT NULL,
        estado NVARCHAR(24) NOT NULL,
        motivo NVARCHAR(300) NULL,
        prazo_resposta DATETIME NOT NULL,
        prazo_decisao DATETIME NULL,
        base_json NVARCHAR(MAX) NOT NULL,
        alertas_json NVARCHAR(MAX) NULL,
        bloqueios_json NVARCHAR(MAX) NULL,
        decidido_por NVARCHAR(180) NULL,
        decidido_em DATETIME NULL,
        justificativa NVARCHAR(400) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_trocas_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_wfm_trocas_atualizado_em DEFAULT GETDATE()

    );
END;

IF OBJECT_ID('dbo.wfm_trocas_eventos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.wfm_trocas_eventos (
        id_evento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        id_troca INT NOT NULL,
        evento NVARCHAR(40) NOT NULL,
        por_id INT NULL,
        por_nome NVARCHAR(180) NULL,
        detalhe NVARCHAR(600) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_wfm_trocas_eventos_criado_em DEFAULT GETDATE()

    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_trocas_estado' AND object_id = OBJECT_ID('dbo.wfm_trocas'))
BEGIN
    CREATE INDEX IX_wfm_trocas_estado ON dbo.wfm_trocas(operacao, estado);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_trocas_operadores' AND object_id = OBJECT_ID('dbo.wfm_trocas'))
BEGIN
    CREATE INDEX IX_wfm_trocas_operadores ON dbo.wfm_trocas(id_solicitante, id_alvo);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wfm_trocas_eventos' AND object_id = OBJECT_ID('dbo.wfm_trocas_eventos'))
BEGIN
    CREATE INDEX IX_wfm_trocas_eventos ON dbo.wfm_trocas_eventos(id_troca);
END;

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'TR_wfm_trocas_eventos_imutavel')
BEGIN
    EXEC(N'CREATE TRIGGER dbo.TR_wfm_trocas_eventos_imutavel ON dbo.wfm_trocas_eventos INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, ''Registro imutavel: wfm_trocas_eventos nao aceita UPDATE nem DELETE.'', 1; END');
END;

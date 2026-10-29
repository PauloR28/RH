-- Conecta - Monitoria: nome e CPF do cliente atendido. Aditiva e idempotente.
-- Gerada a partir de rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.monitorias', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitorias', 'nome_cliente') IS NULL
BEGIN
    ALTER TABLE dbo.monitorias ADD nome_cliente NVARCHAR(180) NULL;
END;

IF OBJECT_ID('dbo.monitorias', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitorias', 'cpf_cliente') IS NULL
BEGIN
    ALTER TABLE dbo.monitorias ADD cpf_cliente NVARCHAR(14) NULL;
END;

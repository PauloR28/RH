-- Conecta - Monitoria: contato do cliente (telefone com DDD ou e-mail). Aditiva e idempotente.
-- Gerada a partir de rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.monitorias', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitorias', 'contato_cliente') IS NULL
BEGIN
    ALTER TABLE dbo.monitorias ADD contato_cliente NVARCHAR(180) NULL;
END;

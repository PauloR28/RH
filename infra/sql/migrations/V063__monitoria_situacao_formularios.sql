-- Conecta - Monitoria: situacao do formulario (arquivado). Aditiva e idempotente.
-- Gerada a partir de rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.monitoria_matrizes', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitoria_matrizes', 'arquivado') IS NULL
BEGIN
    ALTER TABLE dbo.monitoria_matrizes ADD arquivado BIT NULL;
END;

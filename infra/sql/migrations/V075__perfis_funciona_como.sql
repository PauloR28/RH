-- Conecta - V075: perfis no banco. Perfil criado pela tela diz com que perfil do codigo ele funciona.
-- Aditiva e idempotente. Gerada de rh_api/repositories/perfis_schema.py (um teste garante que coincide).

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'funciona_como') IS NULL
    ALTER TABLE dbo.perfis ADD funciona_como NVARCHAR(40) NULL;

-- Conecta - Monitoria: tipo de atendimento vinculado a um canal de atendimento
-- (Correcoes.txt, 21/set/2026). Aditiva e idempotente. Gerada a partir de
-- rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.monitoria_catalogo', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitoria_catalogo', 'id_item_canal') IS NULL
BEGIN
    ALTER TABLE dbo.monitoria_catalogo ADD id_item_canal INT NULL;
END;

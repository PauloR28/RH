-- Rollback da V063: remove a coluna arquivado. Seguro: formularios arquivados voltam a aparecer como desativados.
IF COL_LENGTH('dbo.monitoria_matrizes', 'arquivado') IS NOT NULL
    ALTER TABLE dbo.monitoria_matrizes DROP COLUMN arquivado;

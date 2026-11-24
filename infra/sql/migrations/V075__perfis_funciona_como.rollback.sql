-- Rollback da V075. Apaga os perfis criados pela tela (e o que e deles) e tira a coluna funciona_como.
-- Antes, mude de perfil quem estiver num perfil criado: o rollback nao mexe em usuarios.
IF COL_LENGTH('dbo.perfis', 'funciona_como') IS NOT NULL
BEGIN
    EXEC('DELETE FROM dbo.perfil_permissoes WHERE id_perfil IN (SELECT id_perfil FROM dbo.perfis WHERE sistema = 0)');
    EXEC('DELETE FROM dbo.perfis WHERE sistema = 0 AND id_perfil NOT IN (SELECT perfil_id FROM dbo.usuarios)');
    ALTER TABLE dbo.perfis DROP COLUMN funciona_como;
END;

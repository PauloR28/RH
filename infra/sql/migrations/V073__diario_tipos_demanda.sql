-- Conecta - Diario de bordo: tipo de demanda "E-mail geral" e permissao diario.demandas.criar (V073).
-- Aditiva e idempotente. Gerada de rh_api/repositories/diario_schema.py (um teste garante que coincide).
-- O tipo entra em toda operacao que ja tem cadastros do Diario; a permissao e o valor inicial do Supervisor
-- so entram quando faltam (nunca sobrescreve Perfis e Permissoes).

IF OBJECT_ID('dbo.diario_cadastro', 'U') IS NOT NULL
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    SELECT o.operacao, 'demanda', N'E-mail geral', 'emailGeral',
           (SELECT ISNULL(MAX(x.ordem), 0) + 10 FROM dbo.diario_cadastro x WHERE x.operacao = o.operacao AND x.tipo = 'demanda'), 1, N'V073'
    FROM (SELECT DISTINCT operacao FROM dbo.diario_cadastro) o
    WHERE NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro c WHERE c.operacao = o.operacao AND c.tipo = 'demanda' AND c.nome = N'E-mail geral');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.demandas.criar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.demandas.criar', N'Di' + NCHAR(225) + N'rio de bordo', N'Criar e remover tipos de demanda direto no turno do Di' + NCHAR(225) + N'rio de bordo (sem acesso aos outros cadastros).', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.demandas.criar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.demandas.criar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.demandas.criar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.demandas.criar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.demandas.criar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'diario.demandas.criar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'diario.demandas.criar', 1, GETDATE(), GETDATE());
END;

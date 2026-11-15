-- Rollback da V072 (Painel). Remove tabelas painel_* e permissoes painel.* (a configuracao dos paineis se perde).
IF OBJECT_ID('dbo.painel_alteracao', 'U') IS NOT NULL DROP TABLE dbo.painel_alteracao;
IF OBJECT_ID('dbo.painel_perfil', 'U') IS NOT NULL DROP TABLE dbo.painel_perfil;
IF OBJECT_ID('dbo.painel_metrica', 'U') IS NOT NULL DROP TABLE dbo.painel_metrica;
IF OBJECT_ID('dbo.painel', 'U') IS NOT NULL DROP TABLE dbo.painel;
IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao LIKE 'painel.%' OR chave_permissao = 'sessao.painel.acessar';
IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave LIKE 'painel.%' OR chave = 'sessao.painel.acessar';

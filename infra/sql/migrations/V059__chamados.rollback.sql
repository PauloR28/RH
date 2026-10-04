-- Rollback da V059 (Chamados). Recusa se houver chamados; remove tabelas, sequence e permissoes chamados.*.
IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.chamados)
    THROW 50000, 'Existem chamados: exporte/remova os dados manualmente antes do rollback.', 1;
IF OBJECT_ID('dbo.chamado_observadores', 'U') IS NOT NULL DROP TABLE dbo.chamado_observadores;
IF OBJECT_ID('dbo.chamado_anexos', 'U') IS NOT NULL DROP TABLE dbo.chamado_anexos;
IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NOT NULL DROP TABLE dbo.chamado_eventos;
IF OBJECT_ID('dbo.chamado_agentes', 'U') IS NOT NULL DROP TABLE dbo.chamado_agentes;
IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL DROP TABLE dbo.chamados;
IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL DROP TABLE dbo.chamado_config;
IF OBJECT_ID('dbo.chamado_categorias', 'U') IS NOT NULL DROP TABLE dbo.chamado_categorias;
IF EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_chamado_numero') DROP SEQUENCE dbo.seq_chamado_numero;
IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao LIKE 'chamados.%';
IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave LIKE 'chamados.%';

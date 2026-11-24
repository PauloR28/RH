-- Rollback da V074. Remove a tabela de alcance: todos os perfis voltam ao alcance padrao do codigo.
IF OBJECT_ID('dbo.perfis_alcance', 'U') IS NOT NULL DROP TABLE dbo.perfis_alcance;

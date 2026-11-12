-- Rollback da V071: remove a tabela de excecoes. Os acessos extras a modulo continuam nas tabelas da V060.
IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NOT NULL
    DROP TABLE dbo.acesso_excecoes;

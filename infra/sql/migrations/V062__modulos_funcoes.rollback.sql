-- Rollback da V062: remove a tabela de funcoes por modulo. Seguro: o menu volta ao padrao do codigo.
IF OBJECT_ID('dbo.modulos_funcoes', 'U') IS NOT NULL
    DROP TABLE dbo.modulos_funcoes;

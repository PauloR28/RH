-- Rollback da V055: remove o registro de modulos. Seguro: nenhuma outra tabela depende dele.
IF OBJECT_ID('dbo.modulos_sistema', 'U') IS NOT NULL
    DROP TABLE dbo.modulos_sistema;

-- Rollback da V067: remove a coluna do contato do cliente. Os contatos ja gravados sao perdidos.
IF COL_LENGTH('dbo.monitorias', 'contato_cliente') IS NOT NULL
    ALTER TABLE dbo.monitorias DROP COLUMN contato_cliente;

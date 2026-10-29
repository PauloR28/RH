-- Rollback da V065: remove as colunas do cliente. Os nomes/CPFs ja gravados sao perdidos.
IF COL_LENGTH('dbo.monitorias', 'nome_cliente') IS NOT NULL
    ALTER TABLE dbo.monitorias DROP COLUMN nome_cliente;
IF COL_LENGTH('dbo.monitorias', 'cpf_cliente') IS NOT NULL
    ALTER TABLE dbo.monitorias DROP COLUMN cpf_cliente;

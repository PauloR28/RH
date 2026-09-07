/*
  Rollback de V028__parametros_sistema.sql.

  Remove a tabela apenas se existir.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID('dbo.parametros_sistema', 'U') IS NOT NULL
    DROP TABLE dbo.parametros_sistema;

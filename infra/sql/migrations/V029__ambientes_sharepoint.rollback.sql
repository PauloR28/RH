/*
  Rollback de V029__ambientes_sharepoint.sql.

  Remove a tabela apenas se existir.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID('dbo.ambientes_sharepoint', 'U') IS NOT NULL
    DROP TABLE dbo.ambientes_sharepoint;

-- Rollback da V069: remove os modulos por operacao. Todas as operacoes voltam a seguir a tela Modulos.
IF OBJECT_ID('dbo.operacoes_modulos', 'U') IS NOT NULL DROP TABLE dbo.operacoes_modulos;

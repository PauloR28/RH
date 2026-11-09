-- Rollback da V068 (Diario de bordo). Recusa se houver dias registrados; remove tabelas e permissoes diario.*.
IF OBJECT_ID('dbo.diario_dia', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.diario_dia)
    THROW 50000, 'Existem dias no Diario de bordo: exporte/remova os dados manualmente antes do rollback.', 1;
IF OBJECT_ID('dbo.diario_aceite', 'U') IS NOT NULL DROP TABLE dbo.diario_aceite;
IF OBJECT_ID('dbo.diario_alteracao', 'U') IS NOT NULL DROP TABLE dbo.diario_alteracao;
IF OBJECT_ID('dbo.diario_abs_correcao', 'U') IS NOT NULL DROP TABLE dbo.diario_abs_correcao;
IF OBJECT_ID('dbo.diario_parcial', 'U') IS NOT NULL DROP TABLE dbo.diario_parcial;
IF OBJECT_ID('dbo.diario_intercorrencia', 'U') IS NOT NULL DROP TABLE dbo.diario_intercorrencia;
IF OBJECT_ID('dbo.diario_nivel_servico', 'U') IS NOT NULL DROP TABLE dbo.diario_nivel_servico;
IF OBJECT_ID('dbo.diario_demanda', 'U') IS NOT NULL DROP TABLE dbo.diario_demanda;
IF OBJECT_ID('dbo.diario_turno', 'U') IS NOT NULL DROP TABLE dbo.diario_turno;
IF OBJECT_ID('dbo.diario_dia', 'U') IS NOT NULL DROP TABLE dbo.diario_dia;
IF OBJECT_ID('dbo.diario_cadastro', 'U') IS NOT NULL DROP TABLE dbo.diario_cadastro;
IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao LIKE 'diario.%';
IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave LIKE 'diario.%';

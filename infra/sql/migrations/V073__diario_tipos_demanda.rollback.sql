-- Rollback da V073. Remove a permissao diario.demandas.criar. O tipo "E-mail geral" so sai se nunca foi usado.
IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL DELETE FROM dbo.perfil_permissoes WHERE chave_permissao = 'diario.demandas.criar';
IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL DELETE FROM dbo.permissoes WHERE chave = 'diario.demandas.criar';
IF OBJECT_ID('dbo.diario_cadastro', 'U') IS NOT NULL
    DELETE c FROM dbo.diario_cadastro c WHERE c.tipo = 'demanda' AND c.criado_por = N'V073'
      AND NOT EXISTS (SELECT 1 FROM dbo.diario_demanda d WHERE d.id_item = c.id_item);

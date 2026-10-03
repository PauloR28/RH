-- Rollback da V057: restaura SOMENTE o que a V057 mexeu (registrado no log): linhas ligadas voltam a 0 e as
-- linhas inseridas sao removidas. O que ja existia antes (ou foi inserido por outro caminho) nao e tocado.
IF OBJECT_ID('dbo.modularizacao_grants_log', 'U') IS NOT NULL
BEGIN
    UPDATE pp SET permitido = 0, atualizado_em = GETDATE()
    FROM dbo.perfil_permissoes pp
    INNER JOIN dbo.modularizacao_grants_log l
        ON l.id_perfil = pp.id_perfil AND l.chave_permissao = pp.chave_permissao AND l.migration = 'V057'
    WHERE l.valor_anterior = 0;
    DELETE pp FROM dbo.perfil_permissoes pp
    INNER JOIN dbo.modularizacao_grants_log l
        ON l.id_perfil = pp.id_perfil AND l.chave_permissao = pp.chave_permissao AND l.migration = 'V057'
    WHERE l.valor_anterior IS NULL;
    DROP TABLE dbo.modularizacao_grants_log;
END;

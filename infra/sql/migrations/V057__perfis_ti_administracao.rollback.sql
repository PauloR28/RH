-- Rollback da V057: remove de perfil_permissoes SOMENTE as linhas que a V057 criou (registradas no log).
-- O que ja existia antes (ou foi inserido por outro caminho) nao e tocado.
IF OBJECT_ID('dbo.modularizacao_grants_log', 'U') IS NOT NULL
BEGIN
    DELETE pp FROM dbo.perfil_permissoes pp
    INNER JOIN dbo.modularizacao_grants_log l
        ON l.id_perfil = pp.id_perfil AND l.chave_permissao = pp.chave_permissao AND l.migration = 'V057';
    DROP TABLE dbo.modularizacao_grants_log;
END;

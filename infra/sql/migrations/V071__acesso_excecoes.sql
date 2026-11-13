-- Conecta - Central de Acessos, Etapa 5 (V071): excecoes de acesso num lugar so (perfil na unidade e pessoa).
-- Copia os acessos extras a modulo da V060 sem apagar as tabelas antigas. Aditiva, idempotente e reversivel.
-- Gerada de rh_api/repositories/acesso_excecoes_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.acesso_excecoes (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_acesso_excecoes PRIMARY KEY,
        alvo_tipo NVARCHAR(10) NOT NULL,
        id_perfil NVARCHAR(60) NULL,
        id_usuario INT NULL,
        unidade NVARCHAR(60) NULL,
        unidade_chave AS ISNULL(unidade, N'') PERSISTED,
        chave_permissao NVARCHAR(120) NOT NULL,
        efeito NVARCHAR(10) NOT NULL,
        motivo NVARCHAR(400) NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_acesso_excecoes_criado_em DEFAULT GETDATE(),
        CONSTRAINT CK_acesso_excecoes_efeito CHECK (efeito IN (N'conceder', N'retirar')),
        CONSTRAINT CK_acesso_excecoes_alvo CHECK (
            (alvo_tipo = N'perfil' AND id_perfil IS NOT NULL AND id_usuario IS NULL)
            OR (alvo_tipo = N'usuario' AND id_usuario IS NOT NULL AND id_perfil IS NULL))
    );
END;

IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_acesso_excecoes' AND object_id = OBJECT_ID('dbo.acesso_excecoes'))
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_acesso_excecoes ON dbo.acesso_excecoes (alvo_tipo, id_perfil, id_usuario, unidade_chave, chave_permissao);';

IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.modulos_acesso_perfil', 'U') IS NOT NULL
    EXEC sp_executesql N'INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_perfil, chave_permissao, efeito, motivo, criado_por) SELECT N''perfil'', a.id_perfil, N''modulo.'' + a.modulo + N''.abrir'', N''conceder'', N''Copiado de modulos_acesso_perfil (V060)'', N''V071'' FROM dbo.modulos_acesso_perfil a WHERE NOT EXISTS (SELECT 1 FROM dbo.acesso_excecoes e WHERE e.alvo_tipo = N''perfil'' AND e.id_perfil = a.id_perfil AND e.unidade IS NULL AND e.chave_permissao = N''modulo.'' + a.modulo + N''.abrir'');';

IF OBJECT_ID('dbo.acesso_excecoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.modulos_acesso_usuario', 'U') IS NOT NULL
    EXEC sp_executesql N'INSERT INTO dbo.acesso_excecoes (alvo_tipo, id_usuario, chave_permissao, efeito, motivo, criado_por) SELECT N''usuario'', a.id_usuario, N''modulo.'' + a.modulo + N''.abrir'', N''conceder'', N''Copiado de modulos_acesso_usuario (V060)'', N''V071'' FROM dbo.modulos_acesso_usuario a WHERE NOT EXISTS (SELECT 1 FROM dbo.acesso_excecoes e WHERE e.alvo_tipo = N''usuario'' AND e.id_usuario = a.id_usuario AND e.unidade IS NULL AND e.chave_permissao = N''modulo.'' + a.modulo + N''.abrir'');';

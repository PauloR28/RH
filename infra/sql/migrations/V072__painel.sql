-- Conecta - Painel (V072). Aditiva e idempotente: nao altera nem remove dados existentes.
-- Gerada de rh_api/repositories/painel_schema.py (um teste garante que coincide com o bootstrap runtime).
-- Tabelas painel_* (paineis por modulo e unidade, metricas, perfis que veem, alteracoes), permissoes painel.*
-- e o valor inicial dos perfis, inseridos apenas quando faltam (nunca sobrescreve Perfis e Permissoes).

IF OBJECT_ID('dbo.painel', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.painel (
        id_painel INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_painel PRIMARY KEY,
        modulo NVARCHAR(20) NOT NULL,
        operacao NVARCHAR(60) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_painel_ativo DEFAULT 1,
        intervalo_seg INT NOT NULL CONSTRAINT DF_painel_intervalo DEFAULT 60,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_painel_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL,
        CONSTRAINT UQ_painel UNIQUE (modulo, operacao)
    );
END;

IF OBJECT_ID('dbo.painel_metrica', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.painel_metrica (
        id_painel INT NOT NULL CONSTRAINT FK_painel_metrica_painel REFERENCES dbo.painel(id_painel),
        metrica NVARCHAR(40) NOT NULL,
        forma NVARCHAR(30) NOT NULL,
        ordem INT NOT NULL,
        CONSTRAINT PK_painel_metrica PRIMARY KEY (id_painel, metrica)
    );
END;

IF OBJECT_ID('dbo.painel_perfil', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.painel_perfil (
        id_painel INT NOT NULL CONSTRAINT FK_painel_perfil_painel REFERENCES dbo.painel(id_painel),
        id_perfil NVARCHAR(40) NOT NULL,
        CONSTRAINT PK_painel_perfil PRIMARY KEY (id_painel, id_perfil)
    );
END;

IF OBJECT_ID('dbo.painel_alteracao', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.painel_alteracao (
        id_alteracao BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_painel_alteracao PRIMARY KEY,
        id_painel INT NULL,
        acao NVARCHAR(20) NOT NULL,
        antes NVARCHAR(MAX) NULL,
        depois NVARCHAR(MAX) NULL,
        usuario_id INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_painel_alteracao_criado_em DEFAULT SYSDATETIME()
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_painel_alteracao_painel' AND object_id = OBJECT_ID('dbo.painel_alteracao'))
BEGIN
    CREATE INDEX IX_painel_alteracao_painel ON dbo.painel_alteracao(id_painel, criado_em);
END;

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.painel.acessar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('sessao.painel.acessar', N'Sess' + NCHAR(245) + N'es', N'Acessar a sess' + NCHAR(227) + N'o Painel.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''core'', abre_modulo = 0 WHERE chave = ''sessao.painel.acessar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.visualizar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('painel.visualizar', N'Painel', N'Ver os pain' + NCHAR(233) + N'is liberados para o seu perfil, nas opera' + NCHAR(231) + NCHAR(245) + N'es a que voc' + NCHAR(234) + N' tem acesso.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''core'', abre_modulo = 0 WHERE chave = ''painel.visualizar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.configurar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('painel.configurar', N'Painel', N'Criar e editar pain' + NCHAR(233) + N'is: m' + NCHAR(233) + N'tricas, forma de mostrar, ordem, atualiza' + NCHAR(231) + NCHAR(227) + N'o e quem pode ver.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 0 WHERE chave = ''painel.configurar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.configurar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'painel.configurar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'painel.configurar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'painel.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'painel.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.painel.acessar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'sessao.painel.acessar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'sessao.painel.acessar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'analista_ti')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.configurar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'analista_ti' AND chave_permissao = 'painel.configurar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('analista_ti', 'painel.configurar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'painel.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'painel.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.painel.acessar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'sessao.painel.acessar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'sessao.painel.acessar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_junior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.configurar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_junior' AND chave_permissao = 'painel.configurar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_junior', 'painel.configurar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_pleno')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.configurar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_pleno' AND chave_permissao = 'painel.configurar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_pleno', 'painel.configurar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_senior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'painel.configurar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_senior' AND chave_permissao = 'painel.configurar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_senior', 'painel.configurar', 1, GETDATE(), GETDATE());
END;

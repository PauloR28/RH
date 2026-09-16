-- Mural (Prompt.txt): feed de avisos/comunicados do RH com texto rico e
-- imagens, publicavel simultaneamente em uma ou mais intranets (SharePoint)
-- ja cadastradas em dbo.ambientes_sharepoint (V029). Aditiva, idempotente --
-- nao altera nenhuma tabela existente. Acesso via permissoes
-- mural.visualizar / mural.criar / mural.editar / mural.excluir (rbac.py).
--
-- Reflete o mesmo schema que o bootstrap runtime cria automaticamente
-- (rh_api/repositories/bootstrap.py, ensure_mural_publicacoes_table e
-- funcoes irmas) -- mantenha os dois em sincronia caso este arquivo seja
-- executado manualmente.

IF OBJECT_ID('dbo.mural_publicacoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.mural_publicacoes (
        id_publicacao INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        titulo NVARCHAR(255) NOT NULL,
        resumo NVARCHAR(500) NULL,
        conteudo_html NVARCHAR(MAX) NOT NULL,
        categoria NVARCHAR(80) NULL,
        status NVARCHAR(20) NOT NULL CONSTRAINT DF_mural_publicacoes_status DEFAULT 'rascunho',
        fixado BIT NOT NULL CONSTRAINT DF_mural_publicacoes_fixado DEFAULT 0,
        publicado_em DATETIME NULL,
        criado_por NVARCHAR(200) NULL,
        atualizado_por NVARCHAR(200) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_mural_publicacoes_criado_em DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_mural_publicacoes_atualizado_em DEFAULT GETDATE()
    );
END;

IF OBJECT_ID('dbo.mural_publicacao_imagens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.mural_publicacao_imagens (
        id_imagem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        id_publicacao INT NOT NULL,
        url NVARCHAR(500) NOT NULL,
        nome_arquivo_original NVARCHAR(255) NULL,
        ordem INT NOT NULL CONSTRAINT DF_mural_publicacao_imagens_ordem DEFAULT 0,
        criado_em DATETIME NOT NULL CONSTRAINT DF_mural_publicacao_imagens_criado_em DEFAULT GETDATE()
    );
END;

IF OBJECT_ID('dbo.mural_publicacao_ambientes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.mural_publicacao_ambientes (
        id_publicacao INT NOT NULL,
        id_ambiente INT NOT NULL,
        status_envio NVARCHAR(20) NOT NULL CONSTRAINT DF_mural_publicacao_ambientes_status DEFAULT 'pendente',
        enviado_em DATETIME NULL,
        mensagem_erro NVARCHAR(500) NULL,
        sharepoint_web_url NVARCHAR(1000) NULL,
        CONSTRAINT PK_mural_publicacao_ambientes PRIMARY KEY (id_publicacao, id_ambiente)
    );
END;

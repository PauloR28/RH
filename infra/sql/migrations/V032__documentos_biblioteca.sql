-- Central de Documentos (Correções.txt, rodada 10/set/2026): biblioteca de
-- arquivos de referência (links), organizada por tópico/área. Aditiva,
-- idempotente — não altera templates_documentos nem nenhuma tabela existente.
-- Acesso restrito ao perfil Administrador via permissões
-- documentos_biblioteca.visualizar / documentos_biblioteca.editar (rbac.py).

IF OBJECT_ID('dbo.documentos_biblioteca', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.documentos_biblioteca (
        id_documento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        titulo NVARCHAR(255) NOT NULL,
        topico NVARCHAR(120) NOT NULL,
        area NVARCHAR(120) NULL,
        descricao NVARCHAR(500) NULL,
        url_arquivo NVARCHAR(1000) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_documentos_biblioteca_ativo DEFAULT 1,
        criado_por NVARCHAR(200) NULL,
        criado_em DATETIME NOT NULL DEFAULT GETDATE(),
        atualizado_em DATETIME NOT NULL DEFAULT GETDATE()
    );
END

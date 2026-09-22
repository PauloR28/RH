/*
  Conecta RH - Prompt.txt (rodada de 06/set/2026): evolucao da Central de
  Treinamentos (auditoria em docs/central-treinamentos/00-auditoria-inicial.md,
  plano em docs/central-treinamentos/01-plano-tecnico.md).

  Decisao de arquitetura confirmada com o usuario: estende o dominio ja
  existente (trilhas_onboarding e tabelas relacionadas) em vez de criar um
  dominio "Treinamento" paralelo.

  - dbo.trilhas_onboarding ganha texto_encerramento (Etapa 5 do wizard),
    pptx_path/pptx_nome_original/pptx_pdf_path (slide real da Etapa 3,
    convertido para PDF via LibreOffice headless) e
    saiba_mais_treinamento_json (aba "Saiba +" nivel treinamento: texto
    breve + links). conteudo_json (slides JSON antigos) NAO e removido -
    trilhas ja cadastradas continuam funcionando no player antigo.
  - dbo.trilhas_onboarding_itens ganha os campos ricos do modulo: subtitulo,
    texto_principal, video_path/video_nome_original, tabela_json, dica_texto
    e saiba_mais_itens_json. conteudo_url (ja existente) passa a servir de
    embed de video quando nao ha video_path.
  - Nova tabela dbo.trilhas_onboarding_anexos: documentos da aba "Saiba +"
    (nivel treinamento ou modulo, via trilha_item_id opcional), com o toggle
    de download LGPD (permite_download, default 0) e o aceite do termo
    (termo_aceito_em/por/versao) persistido na propria linha - mesmo padrao
    coluna-a-coluna ja usado para o consentimento LGPD de candidatos
    (migration V019), sem tabela de auditoria dedicada nova (a acao de
    liberar o download tambem grava em dbo.audit_logs via audit_action()).
  - dbo.onboarding_candidatos ganha notificado_pendente_em: marca idempotente
    do job de escalonamento (3/5 dias sem chamada salva), para nao notificar
    o RH mais de uma vez pela mesma pendencia. Os novos estados
    ("pendente_chamada"/"encerrado_sem_chamada") sao validacao de aplicacao
    na coluna status (NVARCHAR(20)) ja existente - nao precisam de migration.
  - Nova tabela dbo.notificacoes: central de notificacoes in-app (nao existia
    nenhuma persistencia de notificacao ate aqui - o sino no header era
    100% client-side). Escopo inicial: eventos da Central de Treinamentos
    (aplicado/concluido/pendente de chamada/encerrado sem chamada), mas a
    tabela e generica o bastante para outros modulos usarem depois.

  Migracao estritamente aditiva e idempotente. Nenhuma tabela ou coluna
  existente e alterada/removida. Reflete o mesmo schema que o bootstrap
  runtime (rh_api/repositories/bootstrap.py, ensure_onboarding_tables e
  ensure_notifications_table) cria automaticamente; mantenha os dois em
  sincronia caso este arquivo seja executado manualmente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.trilhas_onboarding', 'texto_encerramento') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD texto_encerramento NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'pptx_path') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD pptx_path NVARCHAR(500) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'pptx_nome_original') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD pptx_nome_original NVARCHAR(255) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'pptx_pdf_path') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD pptx_pdf_path NVARCHAR(500) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'saiba_mais_treinamento_json') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD saiba_mais_treinamento_json NVARCHAR(MAX) NULL;
    -- prompt.txt §3.1: "Tipo: Obrigatório / Não obrigatório" é um campo do
    -- treinamento (Etapa 1 do wizard), distinto do "obrigatorio" que já existe
    -- por módulo em trilhas_onboarding_itens.
    IF COL_LENGTH('dbo.trilhas_onboarding', 'tipo_obrigatorio') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD tipo_obrigatorio BIT NULL;
    -- EXEC/dinamico: evita "Invalid column name" quando a coluna foi
    -- adicionada pelo ALTER acima no mesmo lote (sqlcmd).
    EXEC(N'UPDATE dbo.trilhas_onboarding SET tipo_obrigatorio = 0 WHERE tipo_obrigatorio IS NULL;');

    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'subtitulo') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD subtitulo NVARCHAR(255) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'texto_principal') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD texto_principal NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'video_path') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD video_path NVARCHAR(500) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'video_nome_original') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD video_nome_original NVARCHAR(255) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'tabela_json') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD tabela_json NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'dica_texto') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD dica_texto NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'saiba_mais_itens_json') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD saiba_mais_itens_json NVARCHAR(MAX) NULL;

    IF COL_LENGTH('dbo.onboarding_candidatos', 'notificado_pendente_em') IS NULL
        ALTER TABLE dbo.onboarding_candidatos ADD notificado_pendente_em DATETIME NULL;

    IF OBJECT_ID('dbo.trilhas_onboarding_anexos', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.trilhas_onboarding_anexos (
            id_anexo INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_trilhas_onboarding_anexos PRIMARY KEY,
            trilha_id INT NOT NULL,
            trilha_item_id INT NULL,
            nome_arquivo_original NVARCHAR(255) NOT NULL,
            nome_arquivo_armazenado NVARCHAR(255) NOT NULL,
            tipo_arquivo NVARCHAR(120) NULL,
            caminho_arquivo NVARCHAR(500) NOT NULL,
            tamanho_bytes INT NOT NULL CONSTRAINT DF_trilhas_onboarding_anexos_tamanho DEFAULT 0,
            permite_download BIT NOT NULL CONSTRAINT DF_trilhas_onboarding_anexos_permite_download DEFAULT 0,
            termo_aceito_em DATETIME NULL,
            termo_aceito_por NVARCHAR(180) NULL,
            termo_versao NVARCHAR(40) NULL,
            criado_por NVARCHAR(180) NULL,
            criado_em DATETIME NOT NULL CONSTRAINT DF_trilhas_onboarding_anexos_criado_em DEFAULT GETDATE()
        );
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_trilhas_onboarding_anexos_trilha_id'
          AND object_id = OBJECT_ID('dbo.trilhas_onboarding_anexos')
    )
        CREATE INDEX IX_trilhas_onboarding_anexos_trilha_id ON dbo.trilhas_onboarding_anexos(trilha_id);

    IF OBJECT_ID('dbo.notificacoes', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.notificacoes (
            id_notificacao INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_notificacoes PRIMARY KEY,
            destinatario_papel NVARCHAR(30) NULL,
            destinatario_usuario NVARCHAR(180) NULL,
            titulo NVARCHAR(255) NOT NULL,
            mensagem NVARCHAR(MAX) NULL,
            categoria NVARCHAR(60) NOT NULL,
            entidade NVARCHAR(60) NULL,
            entidade_id NVARCHAR(80) NULL,
            lida BIT NOT NULL CONSTRAINT DF_notificacoes_lida DEFAULT 0,
            lida_em DATETIME NULL,
            criado_em DATETIME NOT NULL CONSTRAINT DF_notificacoes_criado_em DEFAULT GETDATE()
        );
    END;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'IX_notificacoes_papel_lida'
          AND object_id = OBJECT_ID('dbo.notificacoes')
    )
        CREATE INDEX IX_notificacoes_papel_lida ON dbo.notificacoes(destinatario_papel, lida);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

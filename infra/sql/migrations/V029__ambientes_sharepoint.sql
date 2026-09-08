/*
  Conecta RH - Correcoes.txt (rodada de 08/set/2026): "Adicionar ambiente"
  em Administracao > Parametros > SharePoint. Liga a intranet (site
  SharePoint) de uma operacao ao Conecta, para uso restrito ao Mural
  (publicacoes simultaneas). Substitui o "Novo parametro" generico para
  SharePoint, que nao tinha campos suficientes para representar essa
  conexao (operacao vinculada, URL do site, biblioteca de destino).

  As credenciais do aplicativo Microsoft (tenant/client/secret) continuam
  unicas e compartilhadas, vindas do .env (Settings.sharepoint_*) - esta
  tabela guarda apenas os dados especificos de cada site/intranet.

  Estritamente aditiva: nenhuma tabela ou coluna existente e alterada/
  removida.

  Reflete o mesmo schema que o bootstrap runtime (rh_api/repositories/
  bootstrap.py, ensure_ambientes_sharepoint_table) cria automaticamente;
  mantenha os dois em sincronia caso este arquivo seja executado manualmente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.ambientes_sharepoint', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.ambientes_sharepoint (
            id_ambiente INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            nome NVARCHAR(180) NOT NULL,
            operacao_id INT NULL,
            site_url NVARCHAR(500) NOT NULL,
            hostname NVARCHAR(255) NULL,
            site_path NVARCHAR(255) NULL,
            site_id NVARCHAR(255) NULL,
            biblioteca_destino NVARCHAR(255) NULL,
            status NVARCHAR(30) NOT NULL CONSTRAINT DF_ambientes_sharepoint_status DEFAULT 'pendente',
            ultima_mensagem_teste NVARCHAR(500) NULL,
            testado_em DATETIME NULL,
            ativo BIT NOT NULL CONSTRAINT DF_ambientes_sharepoint_ativo DEFAULT 1,
            criado_por NVARCHAR(180) NULL,
            atualizado_por NVARCHAR(180) NULL,
            criado_em DATETIME NOT NULL CONSTRAINT DF_ambientes_sharepoint_criado_em DEFAULT GETDATE(),
            atualizado_em DATETIME NOT NULL CONSTRAINT DF_ambientes_sharepoint_atualizado_em DEFAULT GETDATE()
        );
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

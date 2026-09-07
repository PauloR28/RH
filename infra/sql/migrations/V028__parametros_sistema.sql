/*
  Conecta RH - Correcoes.txt (rodada de 06/set/2026): aba Configuracoes >
  "Parametros do Conecta" para configuracoes de negocio (ex.: integracao
  SharePoint/intranets) que hoje so podiam ser ajustadas direto no codigo.
  Segredos de infraestrutura (chaves/senhas do arquivo .env) continuam fora
  desta tabela e nunca transitam em texto plano por nenhuma tela.

  Tambem serve para guardar a flag interna (categoria 'sistema_interno') que
  a funcionalidade "Limpar o Conecta" grava apos zerar os dados operacionais,
  para impedir que os seeds padrao (operacoes, trilha de onboarding, blocos
  DISC, valores da empresa, banco de raciocinio logico) sejam recriados
  automaticamente no proximo restart do bootstrap.

  Estritamente aditiva: nenhuma tabela ou coluna existente e alterada/removida.

  Reflete o mesmo schema que o bootstrap runtime (rh_api/repositories/
  bootstrap.py, ensure_parametros_sistema_table) cria automaticamente;
  mantenha os dois em sincronia caso este arquivo seja executado manualmente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.parametros_sistema', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.parametros_sistema (
            id_parametro INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            chave NVARCHAR(120) NOT NULL,
            valor NVARCHAR(MAX) NULL,
            categoria NVARCHAR(60) NOT NULL CONSTRAINT DF_parametros_sistema_categoria DEFAULT 'geral',
            descricao NVARCHAR(400) NULL,
            mascarado BIT NOT NULL CONSTRAINT DF_parametros_sistema_mascarado DEFAULT 0,
            atualizado_por NVARCHAR(180) NULL,
            criado_em DATETIME NOT NULL CONSTRAINT DF_parametros_sistema_criado_em DEFAULT GETDATE(),
            atualizado_em DATETIME NOT NULL CONSTRAINT DF_parametros_sistema_atualizado_em DEFAULT GETDATE(),
            CONSTRAINT UQ_parametros_sistema_chave UNIQUE (chave)
        );
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

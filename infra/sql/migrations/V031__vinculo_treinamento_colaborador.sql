/*
  Conecta RH - Promt.txt (rodada do app mobile "Conecta App"): o colaborador
  loga no app com e-mail (dbo.usuarios.email), mas o registro de treinamento
  vive em candidatos_processos/candidatos_metadata (mundo do processo
  seletivo) - tabelas sem nenhum vinculo com dbo.usuarios hoje.

  O vinculo padrao entre "quem loga" e "quais treinamentos sao dele" e
  automatico, por e-mail identico (dbo.usuarios.email = candidatos_metadata.email,
  via candidatos_processos.id_teste). Esta coluna e so a excecao manual: o RH
  preenche quando o e-mail de login nao bate com o e-mail usado no processo
  seletivo (ex: e-mail pessoal na inscricao x e-mail corporativo no login).

  Estritamente aditiva e idempotente. Nenhuma coluna existente e alterada/
  removida.

  Reflete o mesmo schema que o bootstrap runtime (rh_api/repositories/
  bootstrap.py, ensure_candidate_training_link_column) cria automaticamente;
  mantenha os dois em sincronia caso este arquivo seja executado manualmente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.candidatos_processos', 'email_login_vinculado') IS NULL
        ALTER TABLE dbo.candidatos_processos ADD email_login_vinculado NVARCHAR(180) NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

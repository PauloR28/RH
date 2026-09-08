/*
  Conecta RH - Correcoes.txt (rodada de 08/set/2026): "Central de
  Treinamentos" - o modulo pode ter zero, uma ou varias imagens, distribuidas
  em varios subtitulos ao longo do conteudo (diferente do video, que e um
  unico arquivo por modulo). Estende dbo.trilhas_onboarding_itens (ja
  ampliada pela migration V027) com secoes_json: lista de blocos
  {subtitulo, texto, imagens[]} - cada imagem e uma URL (ja hospedada em
  SharePoint/OneDrive/intranet), no mesmo espirito de conteudo_url.

  Estritamente aditiva e idempotente. Nenhuma coluna existente e alterada/
  removida.

  Reflete o mesmo schema que o bootstrap runtime (rh_api/repositories/
  bootstrap.py, ensure_onboarding_tables) cria automaticamente; mantenha os
  dois em sincronia caso este arquivo seja executado manualmente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'secoes_json') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD secoes_json NVARCHAR(MAX) NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

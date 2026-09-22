/*
  Conecta RH - roadmap de expansao (respostas.txt, rodada de 25/ago/2026):
    Centro de Treinamentos.

  Estende as tabelas de onboarding (V009) em vez de criar um dominio
  paralelo, seguindo a decisao do proprio RH de reestruturar o antigo
  "Portal do novo colaborador" como parte da area de Treinamento:
    - trilha de onboarding passa a carregar categoria (LGPD, Seguranca da
      Informacao, Onboarding, Produto), a operacao a que se aplica (NULL =
      generica) e a modalidade/local padrao de aplicacao;
    - cada item de trilha pode carregar um conteudo (video/texto/slide/link),
      nao so um checklist;
    - a instancia por candidato (onboarding_candidatos) ganha agenda (data
      prevista, local, ministrante) e status geral, para a visao de gestao
      do RH ("ver horario, tempo, sala") e o check/OK do supervisor.

  Migracao estritamente aditiva e idempotente. Nenhuma tabela ou coluna
  existente e alterada/removida. Reflete o mesmo schema que o bootstrap
  runtime (rh_api/repositories/bootstrap.py, ensure_onboarding_tables) cria
  automaticamente; mantenha os dois em sincronia caso este arquivo seja
  executado manualmente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.trilhas_onboarding', 'categoria') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD categoria NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'id_operacao') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD id_operacao INT NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'modalidade') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD modalidade NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding', 'local_padrao') IS NULL
        ALTER TABLE dbo.trilhas_onboarding ADD local_padrao NVARCHAR(180) NULL;

    -- EXEC/dinamico: evita "Invalid column name" quando a coluna 'categoria'
    -- foi adicionada pelo ALTER acima no mesmo lote (sqlcmd valida nomes de
    -- coluna na compilacao do lote inteiro, antes de qualquer execucao).
    EXEC(N'UPDATE dbo.trilhas_onboarding SET categoria = ''Onboarding'' WHERE categoria IS NULL;');

    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'tipo_conteudo') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD tipo_conteudo NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.trilhas_onboarding_itens', 'conteudo_url') IS NULL
        ALTER TABLE dbo.trilhas_onboarding_itens ADD conteudo_url NVARCHAR(500) NULL;

    IF COL_LENGTH('dbo.onboarding_candidatos', 'data_prevista') IS NULL
        ALTER TABLE dbo.onboarding_candidatos ADD data_prevista DATETIME NULL;
    IF COL_LENGTH('dbo.onboarding_candidatos', 'local') IS NULL
        ALTER TABLE dbo.onboarding_candidatos ADD local NVARCHAR(180) NULL;
    IF COL_LENGTH('dbo.onboarding_candidatos', 'ministrante') IS NULL
        ALTER TABLE dbo.onboarding_candidatos ADD ministrante NVARCHAR(180) NULL;
    IF COL_LENGTH('dbo.onboarding_candidatos', 'status') IS NULL
        ALTER TABLE dbo.onboarding_candidatos ADD status NVARCHAR(20) NULL;

    EXEC(N'UPDATE dbo.onboarding_candidatos SET status = ''em_andamento'' WHERE status IS NULL;');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

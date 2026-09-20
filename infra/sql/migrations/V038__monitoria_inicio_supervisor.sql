/*
  Conecta - vertente Monitoria (promt.txt, 20/set/2026): o Supervisor passa a ter
  Inicio por sessoes (Central de Treinamento + Monitorias), substituindo a tela
  inicial antiga (V035 havia revogado "inicio.visualizar"). Tambem remove do
  Supervisor as chaves-mestras das sessoes de RH (Caixa de Curriculos e Processos)
  que o bootstrap nao concede mais por padrao. O Administrador continua livre para
  ligar/desligar qualquer sessao em Perfis e Permissoes.

  So altera linhas do perfil "supervisor" e nunca o que o Administrador ja
  customizou para outro valor; idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'inicio.visualizar')
        UPDATE dbo.perfil_permissoes
        SET permitido = 1, atualizado_em = GETDATE()
        WHERE id_perfil = 'supervisor' AND chave_permissao = 'inicio.visualizar' AND permitido = 0;
    ELSE
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'inicio.visualizar', 1, GETDATE(), GETDATE());

    UPDATE dbo.perfil_permissoes
    SET permitido = 0, atualizado_em = GETDATE()
    WHERE id_perfil = 'supervisor'
      AND chave_permissao IN ('sessao.curriculos.acessar', 'sessao.processos.acessar')
      AND permitido = 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

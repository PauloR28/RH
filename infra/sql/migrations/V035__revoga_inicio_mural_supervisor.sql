/*
  Conecta RH - Correções.txt (rodada 16/set/2026): a visão do Supervisor
  ainda mostrava no menu superior os links "Início" e "Mural" (dentro de
  Gestão), quando a tela inicial do Supervisor deve ser obrigatoriamente a
  Central de Treinamentos. O menu (apps/frontend/fonte/ui/components/layout.js)
  já respeitava permissão para esses dois itens; a causa raiz era o perfil
  "supervisor" ainda ter "inicio.visualizar" e "mural.visualizar" concedidos
  (ver rh_api/rbac.py, ROLE_SUPERVISOR). Revoga os dois para instalações
  existentes — o bootstrap runtime só insere permissões que faltam, nunca
  remove, então isso precisa de migração explícita.

  Não altera nada que o administrador já tenha customizado manualmente para
  outro valor (WHERE permitido = 1 apenas). Migração idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE dbo.perfil_permissoes
    SET permitido = 0, atualizado_em = GETDATE()
    WHERE id_perfil = 'supervisor'
      AND chave_permissao IN ('inicio.visualizar', 'mural.visualizar')
      AND permitido = 1;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

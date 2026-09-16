/*
  Conecta RH - Correções.txt (rodada 16/set/2026): a tela Configurações >
  Motivos de Eliminação mostrava "Cadastre o primeiro item" mesmo o RH
  achando que já existiam motivos cadastrados. Causa raiz: a tabela
  dbo.motivos_eliminacao (catálogo genérico, ver rh_api/rbac.py
  SETTINGS_CATALOGS) estava vazia — os motivos que o RH via no formulário
  de eliminação de candidato vinham de uma lista estática no frontend
  (MOTIVOS_ELIMINACAO, apps/frontend/fonte/features/processos/index.js),
  usada apenas como fallback quando o catálogo do banco está vazio. Essa
  lista nunca tinha sido gravada como dado real/editável.

  Semeia esses mesmos motivos como itens reais do catálogo, para que a tela
  de administração passe a listá-los (e o RH possa editar/desativar cada
  um). Idempotente: só insere motivos cujo nome ainda não existe na tabela.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Eliminado pela nota de corte')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'eliminado_nota_corte', N'Eliminado pela nota de corte', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Eliminado na entrevista')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'eliminado_entrevista', N'Eliminado na entrevista', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Candidato não compareceu')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'candidato_nao_compareceu', N'Candidato não compareceu', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Optou por não prosseguir')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'optou_nao_prosseguir', N'Optou por não prosseguir', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Baixa aderência a vaga')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'baixa_aderencia_vaga', N'Baixa aderência a vaga', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Não atendeu aos requisitos')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'nao_atendeu_requisitos', N'Não atendeu aos requisitos', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    IF NOT EXISTS (SELECT 1 FROM dbo.motivos_eliminacao WHERE nome = N'Eliminado pela baixa nota nas provas')
        INSERT INTO dbo.motivos_eliminacao (chave, nome, descricao, categoria, payload_json, ativo, usado, criado_em, atualizado_em)
        VALUES (N'eliminado_baixa_nota_provas', N'Eliminado pela baixa nota nas provas', N'', N'motivos_eliminacao', N'{}', 1, 0, GETDATE(), GETDATE());

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

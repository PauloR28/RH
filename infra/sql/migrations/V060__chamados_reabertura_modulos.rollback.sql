-- Rollback da V060. Recusa se algum chamado foi reaberto (o historico de reabertura seria perdido).
IF COL_LENGTH('dbo.chamados', 'reaberto_vezes') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.chamados WHERE reaberto_vezes > 0)
    THROW 50000, 'Existem chamados reabertos: exporte os dados antes do rollback.', 1;
IF OBJECT_ID('dbo.modulos_acesso_usuario', 'U') IS NOT NULL DROP TABLE dbo.modulos_acesso_usuario;
IF OBJECT_ID('dbo.modulos_acesso_perfil', 'U') IS NOT NULL DROP TABLE dbo.modulos_acesso_perfil;
IF OBJECT_ID('dbo.chamado_email_destinatarios', 'U') IS NOT NULL DROP TABLE dbo.chamado_email_destinatarios;
IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL
    DELETE FROM dbo.chamado_config WHERE chave IN ('reabertura_dias', 'lembrete_email_ativo', 'lembrete_sla_horas_antes', 'lembrete_parado_horas');
IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NOT NULL
BEGIN
    DELETE FROM dbo.chamado_eventos WHERE tipo = 'reabertura';
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_chamado_eventos_tipo' AND parent_object_id = OBJECT_ID('dbo.chamado_eventos'))
        ALTER TABLE dbo.chamado_eventos DROP CONSTRAINT CK_chamado_eventos_tipo;
    EXEC(N'ALTER TABLE dbo.chamado_eventos ADD CONSTRAINT CK_chamado_eventos_tipo CHECK (tipo IN (''mensagem'',''status'',''atribuicao'',''anexo'',''urgencia'',''sistema''))');
END;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_chamados_resolvido_remoto') ALTER TABLE dbo.chamados DROP CONSTRAINT DF_chamados_resolvido_remoto;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_chamados_reaberto_vezes') ALTER TABLE dbo.chamados DROP CONSTRAINT DF_chamados_reaberto_vezes;
IF COL_LENGTH('dbo.chamados', 'resolvido_remotamente') IS NOT NULL ALTER TABLE dbo.chamados DROP COLUMN resolvido_remotamente;
IF COL_LENGTH('dbo.chamados', 'reaberto_vezes') IS NOT NULL ALTER TABLE dbo.chamados DROP COLUMN reaberto_vezes;
IF COL_LENGTH('dbo.chamados', 'reaberto_ultimo_em') IS NOT NULL ALTER TABLE dbo.chamados DROP COLUMN reaberto_ultimo_em;
IF COL_LENGTH('dbo.chamados', 'parado_notificado_em') IS NOT NULL ALTER TABLE dbo.chamados DROP COLUMN parado_notificado_em;

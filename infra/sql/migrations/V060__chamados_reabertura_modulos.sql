-- Conecta - Chamados V060: reabertura, resolvido remotamente, lembretes por e-mail e acesso a modulos por perfil/usuario.
-- Aditiva e idempotente. Gerada de rh_api/repositories/chamados_schema_v060.py (um teste garante que coincide com o bootstrap).
-- A V059 permanece intocada; tudo que muda nela entra aqui.

IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND COL_LENGTH('dbo.chamados', 'resolvido_remotamente') IS NULL
BEGIN
    ALTER TABLE dbo.chamados ADD resolvido_remotamente BIT NOT NULL CONSTRAINT DF_chamados_resolvido_remoto DEFAULT 0;
END;

IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND COL_LENGTH('dbo.chamados', 'reaberto_vezes') IS NULL
BEGIN
    ALTER TABLE dbo.chamados ADD reaberto_vezes INT NOT NULL CONSTRAINT DF_chamados_reaberto_vezes DEFAULT 0;
END;

IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND COL_LENGTH('dbo.chamados', 'reaberto_ultimo_em') IS NULL
BEGIN
    ALTER TABLE dbo.chamados ADD reaberto_ultimo_em DATETIME2 NULL;
END;

IF OBJECT_ID('dbo.chamados', 'U') IS NOT NULL AND COL_LENGTH('dbo.chamados', 'parado_notificado_em') IS NULL
BEGIN
    ALTER TABLE dbo.chamados ADD parado_notificado_em DATETIME2 NULL;
END;

IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_chamado_eventos_tipo' AND parent_object_id = OBJECT_ID('dbo.chamado_eventos') AND definition LIKE '%reabertura%')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_chamado_eventos_tipo' AND parent_object_id = OBJECT_ID('dbo.chamado_eventos'))
        ALTER TABLE dbo.chamado_eventos DROP CONSTRAINT CK_chamado_eventos_tipo;
    EXEC(N'ALTER TABLE dbo.chamado_eventos ADD CONSTRAINT CK_chamado_eventos_tipo CHECK (tipo IN (''mensagem'',''status'',''atribuicao'',''anexo'',''urgencia'',''sistema'',''reabertura''))');
END;

IF OBJECT_ID('dbo.chamado_email_destinatarios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_email_destinatarios (
        id_destinatario INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_email_destinatarios PRIMARY KEY,
        email NVARCHAR(180) NOT NULL,
        nome NVARCHAR(120) NULL,
        ativo BIT NOT NULL CONSTRAINT DF_chamado_email_dest_ativo DEFAULT 1,
        notif_novo BIT NOT NULL CONSTRAINT DF_chamado_email_dest_novo DEFAULT 0,
        notif_sla_proximo BIT NOT NULL CONSTRAINT DF_chamado_email_dest_sla_prox DEFAULT 1,
        notif_sla_vencido BIT NOT NULL CONSTRAINT DF_chamado_email_dest_sla_venc DEFAULT 1,
        notif_parado BIT NOT NULL CONSTRAINT DF_chamado_email_dest_parado DEFAULT 1,
        notif_reaberto BIT NOT NULL CONSTRAINT DF_chamado_email_dest_reaberto DEFAULT 0,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_email_dest_criado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_chamado_email_destinatarios_email UNIQUE (email)
    );
END;

IF OBJECT_ID('dbo.modulos_acesso_perfil', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.modulos_acesso_perfil (
        id_perfil NVARCHAR(40) NOT NULL,
        modulo NVARCHAR(30) NOT NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_modulos_acesso_perfil_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_modulos_acesso_perfil PRIMARY KEY (id_perfil, modulo)
    );
END;

IF OBJECT_ID('dbo.modulos_acesso_usuario', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.modulos_acesso_usuario (
        id_usuario INT NOT NULL,
        modulo NVARCHAR(30) NOT NULL,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_modulos_acesso_usuario_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_modulos_acesso_usuario PRIMARY KEY (id_usuario, modulo)
    );
END;

IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'reabertura_dias')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('reabertura_dias', '7');

IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'lembrete_email_ativo')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('lembrete_email_ativo', '1');

IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'lembrete_sla_horas_antes')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('lembrete_sla_horas_antes', '1');

IF OBJECT_ID('dbo.chamado_config', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'lembrete_parado_horas')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('lembrete_parado_horas', '72');

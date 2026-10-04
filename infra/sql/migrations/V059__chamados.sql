-- Conecta - Chamados (Suporte TI), V059. Aditiva e idempotente: nao altera nem remove dados existentes.
-- Gerada de rh_api/repositories/chamados_schema.py (um teste garante que coincide com o bootstrap runtime).
-- Datas em UTC (DATETIME2/SYSUTCDATETIME). Insere as permissoes chamados.* e o seed inicial dos perfis
-- apenas quando faltam (nunca sobrescreve o que foi editado em Perfis e Permissoes).

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_chamado_numero' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE SEQUENCE dbo.seq_chamado_numero AS INT START WITH 1 INCREMENT BY 1;
END;

IF OBJECT_ID('dbo.chamado_categorias', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_categorias (
        id_categoria INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_categorias PRIMARY KEY,
        nome NVARCHAR(80) NOT NULL,
        ativo BIT NOT NULL CONSTRAINT DF_chamado_categorias_ativo DEFAULT 1,
        ordem INT NOT NULL CONSTRAINT DF_chamado_categorias_ordem DEFAULT 0,
        CONSTRAINT UQ_chamado_categorias_nome UNIQUE (nome)
    );
END;

IF OBJECT_ID('dbo.chamado_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_config (
        chave NVARCHAR(60) NOT NULL CONSTRAINT PK_chamado_config PRIMARY KEY,
        valor NVARCHAR(200) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_config_atualizado_em DEFAULT SYSUTCDATETIME()
    );
END;

IF OBJECT_ID('dbo.chamados', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamados (
        id_chamado BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamados PRIMARY KEY,
        numero INT NOT NULL CONSTRAINT DF_chamados_numero DEFAULT (NEXT VALUE FOR dbo.seq_chamado_numero),
        titulo NVARCHAR(160) NOT NULL,
        descricao NVARCHAR(MAX) NOT NULL,
        id_categoria INT NOT NULL CONSTRAINT FK_chamados_categoria REFERENCES dbo.chamado_categorias(id_categoria),
        operacao NVARCHAR(60) NOT NULL,
        id_solicitante INT NOT NULL,
        solicitante_nome NVARCHAR(180) NOT NULL,
        solicitante_email NVARCHAR(180) NULL,
        solicitante_cargo NVARCHAR(120) NULL,
        id_responsavel INT NULL,
        tipo_impacto NVARCHAR(10) NOT NULL,
        pa_posto NVARCHAR(40) NULL,
        pa_parada BIT NOT NULL CONSTRAINT DF_chamados_pa_parada DEFAULT 0,
        urgencia NVARCHAR(10) NOT NULL,
        urgencia_solicitada NVARCHAR(10) NOT NULL,
        status NVARCHAR(24) NOT NULL CONSTRAINT DF_chamados_status DEFAULT 'aberto',
        prazo_sla DATETIME2 NOT NULL,
        sla_pausado_seg INT NOT NULL CONSTRAINT DF_chamados_sla_pausado DEFAULT 0,
        sla_pausa_inicio DATETIME2 NULL,
        resolvido_em DATETIME2 NULL,
        encerrado_em DATETIME2 NULL,
        encerramento_automatico BIT NOT NULL CONSTRAINT DF_chamados_enc_auto DEFAULT 0,
        sla_aviso_notificado_em DATETIME2 NULL,
        sla_vencido_notificado_em DATETIME2 NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamados_criado_em DEFAULT SYSUTCDATETIME(),
        atualizado_em DATETIME2 NOT NULL CONSTRAINT DF_chamados_atualizado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_chamados_numero UNIQUE (numero),
        CONSTRAINT CK_chamados_status CHECK (status IN ('aberto','em_andamento','aguardando_solicitante','resolvido','encerrado','cancelado')),
        CONSTRAINT CK_chamados_urgencia CHECK (urgencia IN ('baixa','media','alta','critica')),
        CONSTRAINT CK_chamados_impacto CHECK (tipo_impacto IN ('agente','celula'))
    );
END;

IF OBJECT_ID('dbo.chamado_agentes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_agentes (
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_agentes_chamado REFERENCES dbo.chamados(id_chamado),
        id_usuario INT NOT NULL,
        CONSTRAINT PK_chamado_agentes PRIMARY KEY (id_chamado, id_usuario)
    );
END;

IF OBJECT_ID('dbo.chamado_eventos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_eventos (
        id_evento BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_eventos PRIMARY KEY,
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_eventos_chamado REFERENCES dbo.chamados(id_chamado),
        id_autor INT NULL,
        autor_nome NVARCHAR(180) NULL,
        tipo NVARCHAR(12) NOT NULL,
        conteudo NVARCHAR(MAX) NULL,
        dados_json NVARCHAR(MAX) NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_eventos_criado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_chamado_eventos_tipo CHECK (tipo IN ('mensagem','status','atribuicao','anexo','urgencia','sistema'))
    );
END;

IF OBJECT_ID('dbo.chamado_anexos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_anexos (
        id_anexo BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chamado_anexos PRIMARY KEY,
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_anexos_chamado REFERENCES dbo.chamados(id_chamado),
        id_evento BIGINT NULL,
        nome_original NVARCHAR(255) NOT NULL,
        mime NVARCHAR(120) NOT NULL,
        tamanho BIGINT NOT NULL,
        sha256 CHAR(64) NOT NULL,
        chave_storage NVARCHAR(260) NOT NULL,
        provider NVARCHAR(20) NOT NULL CONSTRAINT DF_chamado_anexos_provider DEFAULT 'local',
        enviado_por INT NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_anexos_criado_em DEFAULT SYSUTCDATETIME(),
        excluido_em DATETIME2 NULL,
        excluido_por INT NULL
    );
END;

IF OBJECT_ID('dbo.chamado_observadores', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.chamado_observadores (
        id_chamado BIGINT NOT NULL CONSTRAINT FK_chamado_observadores_chamado REFERENCES dbo.chamados(id_chamado),
        id_usuario INT NOT NULL,
        criado_em DATETIME2 NOT NULL CONSTRAINT DF_chamado_observadores_criado_em DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_chamado_observadores PRIMARY KEY (id_chamado, id_usuario)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamados_status' AND object_id = OBJECT_ID('dbo.chamados'))
BEGIN
    CREATE INDEX IX_chamados_status ON dbo.chamados(status, prazo_sla);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamados_responsavel' AND object_id = OBJECT_ID('dbo.chamados'))
BEGIN
    CREATE INDEX IX_chamados_responsavel ON dbo.chamados(id_responsavel, status);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamados_solicitante' AND object_id = OBJECT_ID('dbo.chamados'))
BEGIN
    CREATE INDEX IX_chamados_solicitante ON dbo.chamados(id_solicitante, status);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamados_operacao' AND object_id = OBJECT_ID('dbo.chamados'))
BEGIN
    CREATE INDEX IX_chamados_operacao ON dbo.chamados(operacao, status);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamados_prazo_aberto' AND object_id = OBJECT_ID('dbo.chamados'))
BEGIN
    CREATE INDEX IX_chamados_prazo_aberto ON dbo.chamados(prazo_sla) WHERE status IN ('aberto','em_andamento','aguardando_solicitante','resolvido');
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamado_eventos_chamado' AND object_id = OBJECT_ID('dbo.chamado_eventos'))
BEGIN
    CREATE INDEX IX_chamado_eventos_chamado ON dbo.chamado_eventos(id_chamado, criado_em);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chamado_anexos_chamado' AND object_id = OBJECT_ID('dbo.chamado_anexos'))
BEGIN
    CREATE INDEX IX_chamado_anexos_chamado ON dbo.chamado_anexos(id_chamado);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = N'Hardware')
    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES (N'Hardware', 1, 10);

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = N'Software/Sistemas')
    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES (N'Software/Sistemas', 1, 20);

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = N'Rede/Internet')
    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES (N'Rede/Internet', 1, 30);

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = N'Telefonia')
    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES (N'Telefonia', 1, 40);

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = N'Acessos/Login')
    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES (N'Acessos/Login', 1, 50);

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_categorias WHERE nome = N'Outros')
    INSERT INTO dbo.chamado_categorias (nome, ativo, ordem) VALUES (N'Outros', 1, 99);

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'sla_horas_critica')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('sla_horas_critica', '2');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'sla_horas_alta')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('sla_horas_alta', '4');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'sla_horas_media')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('sla_horas_media', '8');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'sla_horas_baixa')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('sla_horas_baixa', '24');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'encerramento_auto_horas')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('encerramento_auto_horas', '48');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'anexo_max_mb')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('anexo_max_mb', '25');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'anexo_max_mb_chamado')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('anexo_max_mb_chamado', '100');

IF NOT EXISTS (SELECT 1 FROM dbo.chamado_config WHERE chave = 'anexo_retencao_exclusao_dias')
    INSERT INTO dbo.chamado_config (chave, valor) VALUES ('anexo_retencao_exclusao_dias', '30');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.abrir')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('chamados.abrir', N'Chamados', N'Ver o menu Suporte TI, abrir chamados e acompanhar os pr' + NCHAR(243) + N'prios.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 1 WHERE chave = ''chamados.abrir'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.ver_operacao')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('chamados.ver_operacao', N'Chamados', N'Ver e comentar chamados de qualquer opera' + NCHAR(231) + NCHAR(227) + N'o ' + NCHAR(224) + N' qual o usu' + NCHAR(225) + N'rio pertence.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 0 WHERE chave = ''chamados.ver_operacao'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atender')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('chamados.atender', N'Chamados', N'Ver a fila do Suporte, assumir, responder, mudar status e alterar urg' + NCHAR(234) + N'ncia.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 1 WHERE chave = ''chamados.atender'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atribuir')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('chamados.atribuir', N'Chamados', N'Atribuir chamados a outros t' + NCHAR(233) + N'cnicos.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 0 WHERE chave = ''chamados.atribuir'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.dashboard')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('chamados.dashboard', N'Chamados', N'Ver o dashboard de chamados.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 0 WHERE chave = ''chamados.dashboard'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.configurar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('chamados.configurar', N'Chamados', N'Gerenciar categorias, prazos de SLA, encerramento autom' + NCHAR(225) + N'tico e limites de anexo.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''tecnologia'', abre_modulo = 0 WHERE chave = ''chamados.configurar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.abrir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'chamados.abrir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'chamados.abrir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atender')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'chamados.atender')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'chamados.atender', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atribuir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'chamados.atribuir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'chamados.atribuir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.configurar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'chamados.configurar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'chamados.configurar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.dashboard')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'chamados.dashboard')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'chamados.dashboard', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.ver_operacao')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'chamados.ver_operacao')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'chamados.ver_operacao', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'analista_ti')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atender')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'analista_ti' AND chave_permissao = 'chamados.atender')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('analista_ti', 'chamados.atender', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'analista_ti')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atribuir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'analista_ti' AND chave_permissao = 'chamados.atribuir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('analista_ti', 'chamados.atribuir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'analista_ti')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.dashboard')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'analista_ti' AND chave_permissao = 'chamados.dashboard')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('analista_ti', 'chamados.dashboard', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.abrir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'chamados.abrir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'chamados.abrir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.ver_operacao')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'chamados.ver_operacao')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'chamados.ver_operacao', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_junior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atender')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_junior' AND chave_permissao = 'chamados.atender')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_junior', 'chamados.atender', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_junior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atribuir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_junior' AND chave_permissao = 'chamados.atribuir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_junior', 'chamados.atribuir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_junior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.dashboard')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_junior' AND chave_permissao = 'chamados.dashboard')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_junior', 'chamados.dashboard', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_pleno')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atender')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_pleno' AND chave_permissao = 'chamados.atender')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_pleno', 'chamados.atender', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_pleno')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atribuir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_pleno' AND chave_permissao = 'chamados.atribuir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_pleno', 'chamados.atribuir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_pleno')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.dashboard')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_pleno' AND chave_permissao = 'chamados.dashboard')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_pleno', 'chamados.dashboard', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_senior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atender')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_senior' AND chave_permissao = 'chamados.atender')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_senior', 'chamados.atender', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_senior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.atribuir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_senior' AND chave_permissao = 'chamados.atribuir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_senior', 'chamados.atribuir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'tecnico_senior')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'chamados.dashboard')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'tecnico_senior' AND chave_permissao = 'chamados.dashboard')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('tecnico_senior', 'chamados.dashboard', 1, GETDATE(), GETDATE());
END;

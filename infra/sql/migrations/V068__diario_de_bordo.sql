-- Conecta - Diario de bordo (V068). Aditiva e idempotente: nao altera nem remove dados existentes.
-- Gerada de rh_api/repositories/diario_schema.py (um teste garante que coincide com o bootstrap runtime).
-- Tabelas diario_*, listas iniciais da operacao CRF (tipos de demanda, canais e ferramentas), permissoes diario.*
-- e o valor inicial dos perfis, inseridos apenas quando faltam (nunca sobrescreve Perfis e Permissoes).

IF OBJECT_ID('dbo.diario_cadastro', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_cadastro (
        id_item INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_cadastro PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        tipo NVARCHAR(20) NOT NULL,
        nome NVARCHAR(120) NOT NULL,
        chave_prototipo NVARCHAR(60) NULL,
        ordem INT NOT NULL CONSTRAINT DF_diario_cadastro_ordem DEFAULT 0,
        ativo BIT NOT NULL CONSTRAINT DF_diario_cadastro_ativo DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_cadastro_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL,
        CONSTRAINT UQ_diario_cadastro UNIQUE (operacao, tipo, nome)
    );
END;

IF OBJECT_ID('dbo.diario_dia', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_dia (
        id_dia BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_dia PRIMARY KEY,
        operacao NVARCHAR(60) NOT NULL,
        data DATE NOT NULL,
        status NVARCHAR(12) NOT NULL CONSTRAINT DF_diario_dia_status DEFAULT 'aberto',
        encerramento_tipo NVARCHAR(20) NULL,
        passagem NVARCHAR(2000) NULL,
        encerrado_por NVARCHAR(180) NULL,
        encerrado_em DATETIME2(0) NULL,
        envio_gerado_por NVARCHAR(180) NULL,
        envio_gerado_em DATETIME2(0) NULL,
        envio_copiado_em DATETIME2(0) NULL,
        envio_baixado_em DATETIME2(0) NULL,
        envio_enviado_por NVARCHAR(180) NULL,
        envio_enviado_em DATETIME2(0) NULL,
        importado BIT NOT NULL CONSTRAINT DF_diario_dia_importado DEFAULT 0,
        versao INT NOT NULL CONSTRAINT DF_diario_dia_versao DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_dia_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL,
        CONSTRAINT UQ_diario_dia UNIQUE (operacao, data)
    );
END;

IF OBJECT_ID('dbo.diario_turno', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_turno (
        id_turno BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_turno PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_turno_dia REFERENCES dbo.diario_dia(id_dia),
        turno NVARCHAR(16) NOT NULL,
        status NVARCHAR(12) NOT NULL CONSTRAINT DF_diario_turno_status DEFAULT 'rascunho',
        observacoes NVARCHAR(1000) NULL,
        versao INT NOT NULL CONSTRAINT DF_diario_turno_versao DEFAULT 1,
        salvo_por NVARCHAR(180) NULL,
        salvo_por_id INT NULL,
        salvo_em DATETIME2(0) NULL,
        concluido_por NVARCHAR(180) NULL,
        concluido_em DATETIME2(0) NULL,
        reaberto_vezes INT NOT NULL CONSTRAINT DF_diario_turno_reaberto DEFAULT 0,
        editando_por NVARCHAR(180) NULL,
        editando_id INT NULL,
        editando_em DATETIME2(0) NULL,
        CONSTRAINT UQ_diario_turno UNIQUE (id_dia, turno)
    );
END;

IF OBJECT_ID('dbo.diario_demanda', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_demanda (
        id_turno BIGINT NOT NULL CONSTRAINT FK_diario_demanda_turno REFERENCES dbo.diario_turno(id_turno),
        id_item INT NOT NULL CONSTRAINT FK_diario_demanda_item REFERENCES dbo.diario_cadastro(id_item),
        inicio INT NULL,
        fim INT NULL,
        CONSTRAINT PK_diario_demanda PRIMARY KEY (id_turno, id_item)
    );
END;

IF OBJECT_ID('dbo.diario_nivel_servico', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_nivel_servico (
        id_turno BIGINT NOT NULL CONSTRAINT FK_diario_ns_turno REFERENCES dbo.diario_turno(id_turno),
        id_item INT NOT NULL CONSTRAINT FK_diario_ns_item REFERENCES dbo.diario_cadastro(id_item),
        valor DECIMAL(5,2) NULL,
        CONSTRAINT PK_diario_nivel_servico PRIMARY KEY (id_turno, id_item)
    );
END;

IF OBJECT_ID('dbo.diario_intercorrencia', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_intercorrencia (
        id_intercorrencia BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_intercorrencia PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_interc_dia REFERENCES dbo.diario_dia(id_dia),
        operacao NVARCHAR(60) NOT NULL,
        turno NVARCHAR(16) NOT NULL,
        id_ferramenta INT NULL CONSTRAINT FK_diario_interc_ferramenta REFERENCES dbo.diario_cadastro(id_item),
        ferramenta NVARCHAR(120) NOT NULL,
        canal NVARCHAR(12) NOT NULL,
        inicio DATETIME2(0) NOT NULL,
        fim DATETIME2(0) NULL,
        descricao NVARCHAR(1000) NOT NULL,
        acao NVARCHAR(1000) NULL,
        chamado NVARCHAR(40) NULL,
        excluida BIT NOT NULL CONSTRAINT DF_diario_interc_excluida DEFAULT 0,
        excluida_por NVARCHAR(180) NULL,
        excluida_em DATETIME2(0) NULL,
        motivo_exclusao NVARCHAR(500) NULL,
        versao INT NOT NULL CONSTRAINT DF_diario_interc_versao DEFAULT 1,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_interc_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL
    );
END;

IF OBJECT_ID('dbo.diario_parcial', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_parcial (
        id_parcial BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_parcial PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_parcial_dia REFERENCES dbo.diario_dia(id_dia),
        hora TIME(0) NOT NULL,
        valores_json NVARCHAR(MAX) NOT NULL,
        excluida BIT NOT NULL CONSTRAINT DF_diario_parcial_excluida DEFAULT 0,
        criado_por NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_parcial_criado_em DEFAULT SYSDATETIME(),
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NULL
    );
END;

IF OBJECT_ID('dbo.diario_abs_correcao', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_abs_correcao (
        id_correcao BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_abs_correcao PRIMARY KEY,
        id_dia BIGINT NOT NULL CONSTRAINT FK_diario_abs_dia REFERENCES dbo.diario_dia(id_dia),
        origem NVARCHAR(12) NOT NULL CONSTRAINT DF_diario_abs_origem DEFAULT 'correcao',
        presenca_json NVARCHAR(MAX) NULL,
        corrigido_json NVARCHAR(MAX) NOT NULL,
        motivo NVARCHAR(500) NOT NULL,
        corrigido_por NVARCHAR(180) NULL,
        corrigido_por_id INT NULL,
        corrigido_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_abs_corrigido_em DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.diario_alteracao', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_alteracao (
        id_alteracao BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_alteracao PRIMARY KEY,
        id_dia BIGINT NULL,
        operacao NVARCHAR(60) NOT NULL,
        data DATE NULL,
        turno NVARCHAR(16) NULL,
        entidade NVARCHAR(30) NOT NULL,
        acao NVARCHAR(40) NOT NULL,
        campo NVARCHAR(160) NULL,
        antes NVARCHAR(MAX) NULL,
        depois NVARCHAR(MAX) NULL,
        motivo NVARCHAR(1000) NULL,
        usuario_id INT NULL,
        usuario_nome NVARCHAR(180) NULL,
        criado_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_alteracao_criado_em DEFAULT SYSDATETIME()
    );
END;

IF OBJECT_ID('dbo.diario_aceite', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.diario_aceite (
        id_aceite INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_diario_aceite PRIMARY KEY,
        username NVARCHAR(180) NOT NULL,
        id_usuario INT NULL,
        versao_termos NVARCHAR(20) NOT NULL,
        aceito_em DATETIME2(0) NOT NULL CONSTRAINT DF_diario_aceite_aceito_em DEFAULT SYSDATETIME(),
        ip NVARCHAR(64) NULL,
        CONSTRAINT UQ_diario_aceite UNIQUE (username, versao_termos)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_turno_dia' AND object_id = OBJECT_ID('dbo.diario_turno'))
BEGIN
    CREATE INDEX IX_diario_turno_dia ON dbo.diario_turno(id_dia);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_interc_operacao_inicio' AND object_id = OBJECT_ID('dbo.diario_intercorrencia'))
BEGIN
    CREATE INDEX IX_diario_interc_operacao_inicio ON dbo.diario_intercorrencia(operacao, inicio);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_interc_dia' AND object_id = OBJECT_ID('dbo.diario_intercorrencia'))
BEGIN
    CREATE INDEX IX_diario_interc_dia ON dbo.diario_intercorrencia(id_dia);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_parcial_dia' AND object_id = OBJECT_ID('dbo.diario_parcial'))
BEGIN
    CREATE INDEX IX_diario_parcial_dia ON dbo.diario_parcial(id_dia);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_abs_dia' AND object_id = OBJECT_ID('dbo.diario_abs_correcao'))
BEGIN
    CREATE INDEX IX_diario_abs_dia ON dbo.diario_abs_correcao(id_dia);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_alteracao_dia' AND object_id = OBJECT_ID('dbo.diario_alteracao'))
BEGIN
    CREATE INDEX IX_diario_alteracao_dia ON dbo.diario_alteracao(id_dia, criado_em);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_diario_alteracao_operacao_data' AND object_id = OBJECT_ID('dbo.diario_alteracao'))
BEGIN
    CREATE INDEX IX_diario_alteracao_operacao_data ON dbo.diario_alteracao(operacao, data);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Formul' + NCHAR(225) + N'rio')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Formul' + NCHAR(225) + N'rio', 'formulario', 10, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Fale Conosco')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Fale Conosco', 'faleConosco', 20, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Reclame Aqui (e-mails)')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Reclame Aqui (e-mails)', 'reclameAquiEmail', 30, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Reclame Aqui (portal)')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Reclame Aqui (portal)', 'reclameAquiPortal', 40, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Biometria')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Biometria', 'biometria', 50, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Chargeback (CBK)')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Chargeback (CBK)', 'chargeback', 60, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'demanda' AND nome = N'Call Back')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'demanda', N'Call Back', 'callBack', 70, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'canal_ns' AND nome = N'Digital')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'canal_ns', N'Digital', 'digital', 10, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'canal_ns' AND nome = N'Voz')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'canal_ns', N'Voz', 'voz', 20, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'canal_parcial' AND nome = N'Web Chat')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'canal_parcial', N'Web Chat', 'webChat', 10, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'canal_parcial' AND nome = N'WhatsApp')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'canal_parcial', N'WhatsApp', 'whatsapp', 20, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'canal_parcial' AND nome = N'Telefone')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'canal_parcial', N'Telefone', 'telefone', 30, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'ferramenta' AND nome = N'Telefonia (URA)')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'ferramenta', N'Telefonia (URA)', NULL, 10, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'ferramenta' AND nome = N'WhatsApp Business')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'ferramenta', N'WhatsApp Business', NULL, 20, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'ferramenta' AND nome = N'Chat do site')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'ferramenta', N'Chat do site', NULL, 30, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'ferramenta' AND nome = N'Sistema de atendimento')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'ferramenta', N'Sistema de atendimento', NULL, 40, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'ferramenta' AND nome = N'Rede / internet')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'ferramenta', N'Rede / internet', NULL, 50, 1, N'V068');

IF NOT EXISTS (SELECT 1 FROM dbo.diario_cadastro WHERE operacao = 'CRF' AND tipo = 'ferramenta' AND nome = N'Outra')
    INSERT INTO dbo.diario_cadastro (operacao, tipo, nome, chave_prototipo, ordem, ativo, criado_por)
    VALUES ('CRF', 'ferramenta', N'Outra', NULL, 99, 1, N'V068');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.diario.acessar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('sessao.diario.acessar', N'Sess' + NCHAR(245) + N'es', N'Acessar a sess' + NCHAR(227) + N'o Di' + NCHAR(225) + N'rio de bordo.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''sessao.diario.acessar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.visualizar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.visualizar', N'Di' + NCHAR(225) + N'rio de bordo', N'Abrir o Di' + NCHAR(225) + N'rio de bordo e consultar dias, turnos, intercorr' + NCHAR(234) + N'ncias e hist' + NCHAR(243) + N'rico das suas opera' + NCHAR(231) + NCHAR(245) + N'es.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.visualizar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.preencher')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.preencher', N'Di' + NCHAR(225) + N'rio de bordo', N'Preencher e concluir turnos, registrar intercorr' + NCHAR(234) + N'ncias e parciais, corrigir o ABS e encerrar o dia.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.preencher'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.reabrir')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.reabrir', N'Di' + NCHAR(225) + N'rio de bordo', N'Reabrir turno conclu' + NCHAR(237) + N'do ou dia encerrado do Di' + NCHAR(225) + N'rio de bordo, com motivo.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.reabrir'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.exportar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.exportar', N'Di' + NCHAR(225) + N'rio de bordo', N'Exportar o hist' + NCHAR(243) + N'rico do Di' + NCHAR(225) + N'rio de bordo e as altera' + NCHAR(231) + NCHAR(245) + N'es de um dia.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.exportar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.administrar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.administrar', N'Di' + NCHAR(225) + N'rio de bordo', N'Cadastros do Di' + NCHAR(225) + N'rio de bordo (tipos de demanda, canais, ferramentas) e importa' + NCHAR(231) + NCHAR(227) + N'o dos registros antigos.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.administrar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.intercorrencias')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('diario.intercorrencias', N'Di' + NCHAR(225) + N'rio de bordo', N'Consultar s' + NCHAR(243) + N' as intercorr' + NCHAR(234) + N'ncias do Di' + NCHAR(225) + N'rio de bordo (sem demandas, n' + NCHAR(237) + N'vel de servi' + NCHAR(231) + N'o nem ABS).', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''diario.intercorrencias'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.administrar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.administrar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.administrar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.exportar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.exportar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.exportar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.intercorrencias')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.intercorrencias')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.intercorrencias', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.preencher')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.preencher')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.preencher', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.reabrir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.reabrir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.reabrir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'diario.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'diario.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.diario.acessar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'sessao.diario.acessar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'sessao.diario.acessar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.exportar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'diario.exportar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'diario.exportar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.reabrir')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'diario.reabrir')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'diario.reabrir', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'diario.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'diario.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.diario.acessar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'sessao.diario.acessar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'sessao.diario.acessar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'qualidade')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.intercorrencias')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'qualidade' AND chave_permissao = 'diario.intercorrencias')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('qualidade', 'diario.intercorrencias', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'qualidade')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.diario.acessar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'qualidade' AND chave_permissao = 'sessao.diario.acessar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('qualidade', 'sessao.diario.acessar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.preencher')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'diario.preencher')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'diario.preencher', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'diario.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'diario.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'diario.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'sessao.diario.acessar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'sessao.diario.acessar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'sessao.diario.acessar', 1, GETDATE(), GETDATE());
END;

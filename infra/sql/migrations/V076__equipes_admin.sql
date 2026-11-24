-- Conecta - V076: Equipes na Tecnologia. Supervisor responsavel e apoio por equipe; permissoes da funcao Equipes.
-- Aditiva e idempotente. Gerada de rh_api/repositories/equipes_admin_schema.py (um teste garante que coincide).

IF OBJECT_ID('dbo.equipes_operacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NULL
    ALTER TABLE dbo.equipes_operacao ADD id_supervisor INT NULL;

IF OBJECT_ID('dbo.equipes_operacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.equipes_operacao', 'id_apoio') IS NULL
    ALTER TABLE dbo.equipes_operacao ADD id_apoio INT NULL;

IF COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NOT NULL AND COL_LENGTH('dbo.usuarios', 'id_equipe') IS NOT NULL
    EXEC(N'UPDATE e SET id_supervisor = x.id_usuario FROM dbo.equipes_operacao e
        JOIN (SELECT u.id_equipe, MIN(u.id_usuario) AS id_usuario FROM dbo.usuarios u
              WHERE u.perfil_id = ''supervisor'' AND u.id_equipe IS NOT NULL AND ISNULL(u.status, ''Ativo'') = ''Ativo''
              GROUP BY u.id_equipe HAVING COUNT(*) = 1) x ON x.id_equipe = e.id_equipe
        WHERE e.id_supervisor IS NULL');

IF COL_LENGTH('dbo.equipes_operacao', 'id_supervisor') IS NOT NULL AND OBJECT_ID('dbo.usuarios_supervisores', 'U') IS NOT NULL
    EXEC(N'UPDATE e SET id_supervisor = x.id_supervisor FROM dbo.equipes_operacao e
        JOIN (SELECT o.id_equipe, us.id_supervisor,
                     ROW_NUMBER() OVER (PARTITION BY o.id_equipe ORDER BY COUNT(*) DESC, us.id_supervisor) AS rn
              FROM dbo.usuarios_supervisores us JOIN dbo.usuarios o ON o.id_usuario = us.id_operador
              WHERE o.id_equipe IS NOT NULL AND ISNULL(o.status, ''Ativo'') = ''Ativo''
              GROUP BY o.id_equipe, us.id_supervisor) x ON x.id_equipe = e.id_equipe AND x.rn = 1
        WHERE e.id_supervisor IS NULL');

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.visualizar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('equipes.visualizar', N'Equipes', N'Ver as equipes das opera' + NCHAR(231) + NCHAR(245) + N'es (Tecnologia > Acessos > Equipes).', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''equipes.visualizar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'equipes.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'equipes.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'control_desk')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'control_desk' AND chave_permissao = 'equipes.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('control_desk', 'equipes.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'equipes.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'equipes.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'equipes.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'equipes.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'qualidade')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.visualizar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'qualidade' AND chave_permissao = 'equipes.visualizar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('qualidade', 'equipes.visualizar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.administrar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('equipes.administrar', N'Equipes', N'Criar, editar e desativar equipes (nome, supervisor respons' + NCHAR(225) + N'vel, apoio).', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''equipes.administrar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.administrar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'equipes.administrar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'equipes.administrar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'control_desk')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.administrar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'control_desk' AND chave_permissao = 'equipes.administrar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('control_desk', 'equipes.administrar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.mover')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('equipes.mover', N'Equipes', N'Mover operadores entre equipes. O que est' + NCHAR(225) + N' em aberto passa para o novo supervisor.', 1, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''equipes.mover'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.mover')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'equipes.mover')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'equipes.mover', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'control_desk')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.mover')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'control_desk' AND chave_permissao = 'equipes.mover')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('control_desk', 'equipes.mover', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.mover')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'equipes.mover')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'equipes.mover', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.exportar')
        INSERT INTO dbo.permissoes (chave, modulo, descricao, critica, criado_em)
        VALUES ('equipes.exportar', N'Equipes', N'Exportar a lista de equipes e operadores.', 0, GETDATE());
END;

IF COL_LENGTH('dbo.permissoes', 'modulo_dono') IS NOT NULL
    EXEC(N'UPDATE dbo.permissoes SET modulo_dono = ''operacao'', abre_modulo = 0 WHERE chave = ''equipes.exportar'' AND modulo_dono IS NULL;');

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'administrador')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.exportar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'administrador' AND chave_permissao = 'equipes.exportar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('administrador', 'equipes.exportar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'control_desk')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.exportar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'control_desk' AND chave_permissao = 'equipes.exportar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('control_desk', 'equipes.exportar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'supervisor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.exportar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'supervisor' AND chave_permissao = 'equipes.exportar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('supervisor', 'equipes.exportar', 1, GETDATE(), GETDATE());
END;

IF OBJECT_ID('dbo.perfil_permissoes', 'U') IS NOT NULL AND OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND OBJECT_ID('dbo.permissoes', 'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.perfis WHERE id_perfil = 'gestor')
       AND EXISTS (SELECT 1 FROM dbo.permissoes WHERE chave = 'equipes.exportar')
       AND NOT EXISTS (SELECT 1 FROM dbo.perfil_permissoes WHERE id_perfil = 'gestor' AND chave_permissao = 'equipes.exportar')
        INSERT INTO dbo.perfil_permissoes (id_perfil, chave_permissao, permitido, criado_em, atualizado_em)
        VALUES ('gestor', 'equipes.exportar', 1, GETDATE(), GETDATE());
END;

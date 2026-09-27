-- Tela inicial configurável por perfil (Perfis e Permissões > Tela inicial).
-- A configuração só esconde/reordena blocos; a permissão de cada área continua
-- valendo. Aditiva e idempotente; espelha ensure_home_screen_config_table.

IF OBJECT_ID('dbo.perfis_tela_inicial', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.perfis_tela_inicial (
        id_perfil NVARCHAR(40) NOT NULL CONSTRAINT PK_perfis_tela_inicial PRIMARY KEY,
        config_json NVARCHAR(MAX) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_perfis_tela_inicial_atualizado_em DEFAULT GETDATE()
    );
END;

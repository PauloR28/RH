-- Conecta - Monitoria: canais de atendimento por usuario e configuracao de ambiente
-- por operacao (Correcoes.txt, 21/set/2026). Aditiva e idempotente. Gerada a partir de
-- rh_api/repositories/monitoria_schema.py (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.usuarios_canais', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.usuarios_canais (
        id_usuario INT NOT NULL,
        id_item_canal INT NOT NULL,
        criado_em DATETIME NOT NULL CONSTRAINT DF_usuarios_canais_criado_em DEFAULT GETDATE(),
        CONSTRAINT PK_usuarios_canais PRIMARY KEY (id_usuario, id_item_canal)

    );
END;

IF OBJECT_ID('dbo.operacoes_ambiente', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.operacoes_ambiente (
        operacao NVARCHAR(60) NOT NULL PRIMARY KEY,
        possui_qualidade BIT NOT NULL CONSTRAINT DF_operacoes_ambiente_qualidade DEFAULT 0,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NOT NULL CONSTRAINT DF_operacoes_ambiente_atualizado_em DEFAULT GETDATE()

    );
END;

-- Conecta - Monitoria: formularios duplicaveis (varios por operacao, um ativo) e
-- exclusao logica de monitoria pelo Administrador (Correcoes, 27/set/2026).
-- Aditiva e idempotente. Gerada a partir de rh_api/repositories/monitoria_schema.py
-- (um teste garante que coincide com o bootstrap).

IF OBJECT_ID('dbo.monitoria_matrizes', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitoria_matrizes', 'origem_id_matriz') IS NULL
BEGIN
    ALTER TABLE dbo.monitoria_matrizes ADD origem_id_matriz INT NULL;
END;

IF OBJECT_ID('dbo.monitoria_matrizes', 'U') IS NOT NULL AND COL_LENGTH('dbo.monitoria_matrizes', 'origem_id_versao') IS NULL
BEGIN
    ALTER TABLE dbo.monitoria_matrizes ADD origem_id_versao INT NULL;
END;

IF OBJECT_ID('dbo.monitoria_exclusoes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.monitoria_exclusoes (
        id_monitoria INT NOT NULL PRIMARY KEY,
        excluida_por INT NULL,
        excluida_por_nome NVARCHAR(180) NULL,
        motivo NVARCHAR(400) NOT NULL,
        excluida_em DATETIME NOT NULL CONSTRAINT DF_monitoria_exclusoes_excluida_em DEFAULT GETDATE()

    );
END;

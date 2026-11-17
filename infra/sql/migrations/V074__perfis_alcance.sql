-- Conecta - V074: alcance de cada perfil (todos/unidade/equipe/proprio) por area, gravado pela tela Acessos.
-- Aditiva e idempotente. Gerada de rh_api/repositories/alcance_schema.py (um teste garante que coincide).

IF OBJECT_ID('dbo.perfis_alcance', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.perfis_alcance (
        id_perfil NVARCHAR(40) NOT NULL,
        area NVARCHAR(20) NOT NULL,
        nivel NVARCHAR(10) NOT NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME2(0) NOT NULL CONSTRAINT DF_perfis_alcance_em DEFAULT SYSDATETIME(),
        CONSTRAINT PK_perfis_alcance PRIMARY KEY (id_perfil, area),
        CONSTRAINT CK_perfis_alcance_area CHECK (area IN ('wfm', 'monitoria', 'chamados')),
        CONSTRAINT CK_perfis_alcance_nivel CHECK (nivel IN ('todos', 'unidade', 'equipe', 'proprio'))
    );
END;

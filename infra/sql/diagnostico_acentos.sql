-- Diagnostico de mojibake (SOMENTE LEITURA). Rode com: sqlcmd -S <srv> -d <banco> -E -I -f 65001 -i infra\sql\diagnostico_acentos.sql
-- Cada linha traz quantos registros da coluna tem caracteres tipicos de UTF-8 lido como ANSI (A-til, A-circunflexo) ou OEM (caixa de desenho).
-- Gerado de rh_api/repositories/acentos_migration.py.

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.motivos_eliminacao', 'descricao') IS NOT NULL
    SELECT 'motivos_eliminacao.descricao' AS onde, COUNT(*) AS suspeitos FROM dbo.motivos_eliminacao
    WHERE descricao COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.motivos_eliminacao', 'U') IS NOT NULL AND COL_LENGTH('dbo.motivos_eliminacao', 'nome') IS NOT NULL
    SELECT 'motivos_eliminacao.nome' AS onde, COUNT(*) AS suspeitos FROM dbo.motivos_eliminacao
    WHERE nome COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.operacoes', 'U') IS NOT NULL AND COL_LENGTH('dbo.operacoes', 'nome') IS NOT NULL
    SELECT 'operacoes.nome' AS onde, COUNT(*) AS suspeitos FROM dbo.operacoes
    WHERE nome COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'descricao') IS NOT NULL
    SELECT 'perfis.descricao' AS onde, COUNT(*) AS suspeitos FROM dbo.perfis
    WHERE descricao COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'nivel') IS NOT NULL
    SELECT 'perfis.nivel' AS onde, COUNT(*) AS suspeitos FROM dbo.perfis
    WHERE nivel COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.perfis', 'U') IS NOT NULL AND COL_LENGTH('dbo.perfis', 'nome') IS NOT NULL
    SELECT 'perfis.nome' AS onde, COUNT(*) AS suspeitos FROM dbo.perfis
    WHERE nome COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.trilhas_onboarding', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding', 'descricao') IS NOT NULL
    SELECT 'trilhas_onboarding.descricao' AS onde, COUNT(*) AS suspeitos FROM dbo.trilhas_onboarding
    WHERE descricao COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.trilhas_onboarding', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding', 'nome') IS NOT NULL
    SELECT 'trilhas_onboarding.nome' AS onde, COUNT(*) AS suspeitos FROM dbo.trilhas_onboarding
    WHERE nome COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'descricao') IS NOT NULL
    SELECT 'trilhas_onboarding_itens.descricao' AS onde, COUNT(*) AS suspeitos FROM dbo.trilhas_onboarding_itens
    WHERE descricao COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.trilhas_onboarding_itens', 'U') IS NOT NULL AND COL_LENGTH('dbo.trilhas_onboarding_itens', 'titulo') IS NOT NULL
    SELECT 'trilhas_onboarding_itens.titulo' AS onde, COUNT(*) AS suspeitos FROM dbo.trilhas_onboarding_itens
    WHERE titulo COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_tipos_escala', 'descricao') IS NOT NULL
    SELECT 'wfm_tipos_escala.descricao' AS onde, COUNT(*) AS suspeitos FROM dbo.wfm_tipos_escala
    WHERE descricao COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

IF OBJECT_ID('dbo.wfm_tipos_escala', 'U') IS NOT NULL AND COL_LENGTH('dbo.wfm_tipos_escala', 'nome') IS NOT NULL
    SELECT 'wfm_tipos_escala.nome' AS onde, COUNT(*) AS suspeitos FROM dbo.wfm_tipos_escala
    WHERE nome COLLATE Latin1_General_BIN2 LIKE N'%[' + NCHAR(195) + NCHAR(194) + NCHAR(9500) + N']%';

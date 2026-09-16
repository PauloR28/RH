-- Correções.txt item 10 (rodada 16/set/2026): a tela "Gestão > Calendário de
-- datas comemorativas" passa a criar um evento real (data/hora de início e
-- fim, local, link, categoria, imagem) e publicá-lo automaticamente no
-- calendário da Intranet (SharePoint), reaproveitando a mesma infraestrutura
-- de ambientes/credenciais já usada pelo Mural (dbo.ambientes_sharepoint,
-- V029/V033). Aditiva, idempotente -- não altera nenhuma coluna existente.
--
-- dia/mes continuam existindo (derivados de data_inicio na escrita) para não
-- quebrar o cálculo de "próxima ocorrência anual" já usado pelo widget de
-- calendário. Reflete o schema que o bootstrap runtime cria automaticamente
-- (rh_api/repositories/bootstrap.py, ensure_celebratory_dates_table) --
-- mantenha os dois em sincronia caso este arquivo seja executado manualmente.

IF COL_LENGTH('dbo.datas_comemorativas', 'data_inicio') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD data_inicio DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'data_fim') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD data_fim DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'dia_inteiro') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD dia_inteiro BIT NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'local') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD local NVARCHAR(300) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'link') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD link NVARCHAR(500) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'categoria') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD categoria NVARCHAR(60) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'imagem_url') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD imagem_url NVARCHAR(500) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'id_ambiente') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD id_ambiente INT NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'status_sincronizacao') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD status_sincronizacao NVARCHAR(20) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'mensagem_sincronizacao') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD mensagem_sincronizacao NVARCHAR(500) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'sharepoint_web_url') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD sharepoint_web_url NVARCHAR(1000) NULL;
END;

IF COL_LENGTH('dbo.datas_comemorativas', 'sharepoint_item_id') IS NULL
BEGIN
    ALTER TABLE dbo.datas_comemorativas ADD sharepoint_item_id NVARCHAR(80) NULL;
END;

UPDATE dbo.datas_comemorativas SET dia_inteiro = 1 WHERE dia_inteiro IS NULL;

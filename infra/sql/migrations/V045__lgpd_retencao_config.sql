-- Retenção LGPD automática de candidatos (regras aprovadas pelo RH em 27/set/2026):
-- prazo contado da candidatura (ou da entrada no banco de talentos), aviso prévio
-- ao Administrador e ao Gestor e exclusão dos dados ao vencer. Contratados e
-- candidatos em processo aberto nunca são excluídos. NASCE DESLIGADA (ativo = 0).
-- Aditiva e idempotente; espelha ensure_lgpd_retention_table (bootstrap.py).

IF OBJECT_ID('dbo.lgpd_retencao_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.lgpd_retencao_config (
        id INT NOT NULL CONSTRAINT PK_lgpd_retencao_config PRIMARY KEY,
        ativo BIT NOT NULL CONSTRAINT DF_lgpd_retencao_config_ativo DEFAULT 0,
        meses_candidatura INT NOT NULL CONSTRAINT DF_lgpd_retencao_config_meses_cand DEFAULT 6,
        meses_banco_talentos INT NOT NULL CONSTRAINT DF_lgpd_retencao_config_meses_banco DEFAULT 6,
        dias_aviso INT NOT NULL CONSTRAINT DF_lgpd_retencao_config_dias_aviso DEFAULT 7,
        excluir_cvs_nao_vinculados BIT NOT NULL CONSTRAINT DF_lgpd_retencao_config_cvs DEFAULT 1,
        ultima_execucao DATETIME NULL,
        ultimo_resultado_json NVARCHAR(MAX) NULL,
        atualizado_por NVARCHAR(180) NULL,
        atualizado_em DATETIME NULL
    );
END;

/*
  Zera os DADOS OPERACIONAIS de teste antes de a produção entrar em uso (pedido do RH em 23/out/2026):
    - Presenças (e atestados, horas extras e pausas programadas)
    - Monitorias (e tudo que depende delas: respostas, pilares, feedbacks, contestações, réplicas, reanálises, anexos,
      eventos, planos de ação, rascunhos, exclusões lógicas)
    - Escalas montadas (itens por dia, cabeçalho mensal, versões publicadas) e trocas de plantão
    - Auditoria do WFM (decisão do RH)

  NÃO MEXE em: usuários, perfis e permissões, operações, equipes, vínculos de supervisor/operador, turnos-modelo
  (wfm_turnos), tipos de escala, contratos, calendário especial, skills, aprovadores, configurações de qualquer módulo,
  formulários/matriz da Monitoria, logs gerais do sistema nem os logs da Monitoria.

  COMO USAR (no servidor de produção, SQL Server Management Studio, banco RH_Provas_C24H):
    1. Pare a aplicação:  Stop-ScheduledTask -TaskName "Conecta-RH"   (senão a presença automática do login recria linhas)
    2. Faça BACKUP:       BACKUP DATABASE RH_Provas_C24H TO DISK = N'C:\Backups\RH_Provas_C24H_antes_da_limpeza.bak' WITH INIT;
    3. Rode este script COMO ESTÁ (@CONFIRMAR = 0): ele apaga dentro de uma transação, mostra ANTES/DEPOIS e DESFAZ tudo.
    4. Conferiu os números? Troque @CONFIRMAR para 1 e rode de novo: agora a transação é confirmada (irreversível sem o backup).
    5. Suba a aplicação:  Start-ScheduledTask -TaskName "Conecta-RH"

  Os arquivos de evidência/anexos da Monitoria ficam no disco (data\private\...) e NÃO são apagados por este script.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @CONFIRMAR BIT = 0;   -- 0 = simulação (desfaz)   |   1 = apaga de verdade

IF DB_NAME() <> 'RH_Provas_C24H'
    PRINT 'ATENCAO: o banco atual e ' + DB_NAME() + ' (producao = RH_Provas_C24H). Confira antes de confirmar.';

-- Tabelas que serão esvaziadas, na ordem segura (filhas antes das mães).
DECLARE @alvos TABLE (ordem INT IDENTITY(1,1), tabela SYSNAME);
INSERT INTO @alvos (tabela) VALUES
    -- Monitoria
    ('monitoria_plano_historico'), ('monitoria_planos_acao'), ('monitoria_anexos'), ('monitoria_replicas'),
    ('monitoria_reanalises'), ('monitoria_contestacoes'), ('monitoria_feedbacks'), ('monitoria_eventos'),
    ('monitoria_respostas'), ('monitoria_pilares'), ('monitoria_estado'), ('monitoria_rascunhos'),
    ('monitoria_exclusoes'), ('monitorias'),
    -- Turnos e Plantões
    ('wfm_trocas_eventos'), ('wfm_trocas'), ('wfm_presencas'), ('wfm_atestados'), ('wfm_horas_extras'),
    ('wfm_pausas'), ('wfm_escala_itens'), ('wfm_escalas'), ('wfm_escala_versoes'), ('wfm_auditoria');

-- Só entram as tabelas que existem neste banco.
DELETE FROM @alvos WHERE OBJECT_ID('dbo.' + tabela, 'U') IS NULL;

DECLARE @antes TABLE (tabela SYSNAME, linhas BIGINT);
DECLARE @t SYSNAME, @sql NVARCHAR(MAX);

DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT tabela FROM @alvos ORDER BY ordem;
OPEN c; FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT N''' + @t + N''', COUNT_BIG(*) FROM dbo.' + QUOTENAME(@t);
    INSERT INTO @antes EXEC (@sql);
    FETCH NEXT FROM c INTO @t;
END
CLOSE c; DEALLOCATE c;

SELECT 'ANTES (linhas que serao apagadas)' AS etapa, tabela, linhas FROM @antes ORDER BY linhas DESC, tabela;

BEGIN TRAN;

-- Monitoria e partes do WFM (trocas, auditoria, versões) são imutáveis por gatilho: desativa só os gatilhos das tabelas-alvo,
-- guardando quais eram, e reativa exatamente os mesmos no fim (dentro da mesma transação).
DECLARE @gatilhos TABLE (tabela SYSNAME, gatilho SYSNAME);
INSERT INTO @gatilhos (tabela, gatilho)
SELECT OBJECT_NAME(t.parent_id), t.name
FROM sys.triggers t
WHERE t.parent_class = 1 AND t.is_disabled = 0
  AND OBJECT_NAME(t.parent_id) IN (SELECT tabela FROM @alvos);

DECLARE @g SYSNAME;
DECLARE cg CURSOR LOCAL FAST_FORWARD FOR SELECT tabela, gatilho FROM @gatilhos;
OPEN cg; FETCH NEXT FROM cg INTO @t, @g;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@t) + N' DISABLE TRIGGER ' + QUOTENAME(@g);
    EXEC (@sql);
    FETCH NEXT FROM cg INTO @t, @g;
END
CLOSE cg; DEALLOCATE cg;

-- Apaga na ordem (DELETE, não TRUNCATE: respeita chaves estrangeiras e roda dentro da transação).
DECLARE c2 CURSOR LOCAL FAST_FORWARD FOR SELECT tabela FROM @alvos ORDER BY ordem;
OPEN c2; FETCH NEXT FROM c2 INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@t);
    EXEC (@sql);
    FETCH NEXT FROM c2 INTO @t;
END
CLOSE c2; DEALLOCATE c2;

DECLARE cr CURSOR LOCAL FAST_FORWARD FOR SELECT tabela, gatilho FROM @gatilhos;
OPEN cr; FETCH NEXT FROM cr INTO @t, @g;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@t) + N' ENABLE TRIGGER ' + QUOTENAME(@g);
    EXEC (@sql);
    FETCH NEXT FROM cr INTO @t, @g;
END
CLOSE cr; DEALLOCATE cr;

DECLARE @depois TABLE (tabela SYSNAME, linhas BIGINT);
DECLARE c3 CURSOR LOCAL FAST_FORWARD FOR SELECT tabela FROM @alvos ORDER BY ordem;
OPEN c3; FETCH NEXT FROM c3 INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT N''' + @t + N''', COUNT_BIG(*) FROM dbo.' + QUOTENAME(@t);
    INSERT INTO @depois EXEC (@sql);
    FETCH NEXT FROM c3 INTO @t;
END
CLOSE c3; DEALLOCATE c3;

SELECT 'DEPOIS (deve ser tudo 0)' AS etapa, tabela, linhas FROM @depois ORDER BY linhas DESC, tabela;
SELECT 'GATILHOS AINDA DESATIVADOS (deve ser 0)' AS etapa, COUNT(*) AS gatilhos_desativados
FROM sys.triggers WHERE is_disabled = 1 AND OBJECT_NAME(parent_id) IN (SELECT tabela FROM @alvos);

-- Conferência de que nada de configuração foi tocado.
SELECT 'PRESERVADOS' AS etapa,
       (SELECT COUNT(*) FROM dbo.usuarios) AS usuarios,
       (SELECT COUNT(*) FROM dbo.wfm_turnos) AS turnos_modelo;

IF @CONFIRMAR = 1
BEGIN
    COMMIT;
    PRINT 'CONFIRMADO: dados operacionais apagados.';
END
ELSE
BEGIN
    ROLLBACK;
    PRINT 'SIMULACAO: nada foi apagado (tudo desfeito). Troque @CONFIRMAR para 1 para valer.';
END

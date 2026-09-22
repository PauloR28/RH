SET XACT_ABORT ON;
BEGIN TRAN;

ALTER TABLE dbo.monitoria_anexos DISABLE TRIGGER TR_monitoria_anexos_imutavel;
ALTER TABLE dbo.monitoria_replicas DISABLE TRIGGER TR_monitoria_replicas_imutavel;
ALTER TABLE dbo.monitoria_reanalises DISABLE TRIGGER TR_monitoria_reanalises_imutavel;
ALTER TABLE dbo.monitoria_contestacoes DISABLE TRIGGER TR_monitoria_contestacoes_imutavel;
ALTER TABLE dbo.monitoria_feedbacks DISABLE TRIGGER TR_monitoria_feedbacks_imutavel;
ALTER TABLE dbo.monitoria_eventos DISABLE TRIGGER TR_monitoria_eventos_imutavel;
ALTER TABLE dbo.monitoria_respostas DISABLE TRIGGER TR_monitoria_respostas_imutavel;
ALTER TABLE dbo.monitoria_pilares DISABLE TRIGGER TR_monitoria_pilares_imutavel;
ALTER TABLE dbo.monitoria_plano_historico DISABLE TRIGGER TR_monitoria_plano_historico_imutavel;
ALTER TABLE dbo.monitorias DISABLE TRIGGER TR_monitorias_imutavel;

DELETE FROM dbo.monitoria_plano_historico;
DELETE FROM dbo.monitoria_planos_acao;
DELETE FROM dbo.monitoria_anexos;
DELETE FROM dbo.monitoria_replicas;
DELETE FROM dbo.monitoria_reanalises;
DELETE FROM dbo.monitoria_contestacoes;
DELETE FROM dbo.monitoria_feedbacks;
DELETE FROM dbo.monitoria_eventos;
DELETE FROM dbo.monitoria_respostas;
DELETE FROM dbo.monitoria_pilares;
DELETE FROM dbo.monitoria_estado;
DELETE FROM dbo.monitoria_rascunhos;
DELETE FROM dbo.monitorias;

ALTER TABLE dbo.monitoria_anexos ENABLE TRIGGER TR_monitoria_anexos_imutavel;
ALTER TABLE dbo.monitoria_replicas ENABLE TRIGGER TR_monitoria_replicas_imutavel;
ALTER TABLE dbo.monitoria_reanalises ENABLE TRIGGER TR_monitoria_reanalises_imutavel;
ALTER TABLE dbo.monitoria_contestacoes ENABLE TRIGGER TR_monitoria_contestacoes_imutavel;
ALTER TABLE dbo.monitoria_feedbacks ENABLE TRIGGER TR_monitoria_feedbacks_imutavel;
ALTER TABLE dbo.monitoria_eventos ENABLE TRIGGER TR_monitoria_eventos_imutavel;
ALTER TABLE dbo.monitoria_respostas ENABLE TRIGGER TR_monitoria_respostas_imutavel;
ALTER TABLE dbo.monitoria_pilares ENABLE TRIGGER TR_monitoria_pilares_imutavel;
ALTER TABLE dbo.monitoria_plano_historico ENABLE TRIGGER TR_monitoria_plano_historico_imutavel;
ALTER TABLE dbo.monitorias ENABLE TRIGGER TR_monitorias_imutavel;

COMMIT;

SELECT 'monitorias' t, COUNT(*) n FROM dbo.monitorias
UNION ALL SELECT 'respostas', COUNT(*) FROM dbo.monitoria_respostas
UNION ALL SELECT 'eventos', COUNT(*) FROM dbo.monitoria_eventos
UNION ALL SELECT 'planos', COUNT(*) FROM dbo.monitoria_planos_acao
UNION ALL SELECT 'triggers desativados', COUNT(*) FROM sys.triggers WHERE is_disabled=1 AND OBJECT_NAME(parent_id) LIKE 'monitoria%';

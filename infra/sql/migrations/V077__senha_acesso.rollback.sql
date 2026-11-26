-- Rollback da V077. Tira a tabela de pedidos do Esqueci a senha e as colunas novas de usuarios.
-- As senhas ja trocadas continuam valendo.
IF OBJECT_ID('dbo.senha_recuperacoes', 'U') IS NOT NULL DROP TABLE dbo.senha_recuperacoes;
IF COL_LENGTH('dbo.usuarios', 'senha_temporaria_expira_em') IS NOT NULL ALTER TABLE dbo.usuarios DROP COLUMN senha_temporaria_expira_em;
IF COL_LENGTH('dbo.usuarios', 'bloqueado_ate') IS NOT NULL ALTER TABLE dbo.usuarios DROP COLUMN bloqueado_ate;
IF COL_LENGTH('dbo.usuarios', 'falhas_login') IS NOT NULL ALTER TABLE dbo.usuarios DROP COLUMN falhas_login;
IF COL_LENGTH('dbo.usuarios', 'sessao_web_id') IS NOT NULL ALTER TABLE dbo.usuarios DROP COLUMN sessao_web_id;

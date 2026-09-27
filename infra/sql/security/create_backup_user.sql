-- Conta dedicada ao backup e ao teste de restauração do Conecta.
-- Execute como DBA (sysadmin), via sqlcmd, substituindo as variáveis:
--
--   sqlcmd -S localhost\SQLEXPRESS -E -I -i create_backup_user.sql ^
--          -v DATABASE_NAME="RH_Provas_C24H" BACKUP_LOGIN="SERVIDOR\svc_conecta_backup"
--
-- BACKUP_LOGIN deve ser a conta Windows que roda as tarefas agendadas
-- (Conecta-Backup-Diario e Conecta-Backup-TesteRestauracao). Autenticação
-- Windows evita senha em arquivo ou na linha de comando.
--
-- O que a conta PODE: fazer backup do banco de produção, ler metadados de
-- contagem de linhas (sys.partitions, sem ler dados), criar/restaurar/apagar
-- o banco temporário do teste de restauração.
-- O que a conta NÃO PODE: ler ou alterar dados de produção, alterar schema,
-- restaurar por cima da produção (não é db_owner da produção).

USE [master];

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(BACKUP_LOGIN)')
    CREATE LOGIN [$(BACKUP_LOGIN)] FROM WINDOWS WITH DEFAULT_DATABASE = [master];

-- Teste de restauração: cria o banco temporário RH_Restore_Teste (o criador vira dono dele,
-- o que permite DBCC CHECKDB e DROP apenas nesse banco).
IF IS_SRVROLEMEMBER(N'dbcreator', N'$(BACKUP_LOGIN)') = 0
    ALTER SERVER ROLE [dbcreator] ADD MEMBER [$(BACKUP_LOGIN)];
GO

USE [$(DATABASE_NAME)];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(BACKUP_LOGIN)')
    CREATE USER [$(BACKUP_LOGIN)] FOR LOGIN [$(BACKUP_LOGIN)];

ALTER ROLE [db_backupoperator] ADD MEMBER [$(BACKUP_LOGIN)];

-- Contagem de linhas via sys.partitions (metadado; não concede SELECT nos dados).
GRANT VIEW DEFINITION TO [$(BACKUP_LOGIN)];
GO

-- Lembrete: o arquivo .bak é gravado pela conta de SERVIÇO do SQL Server
-- (ex.: NT Service\MSSQL$SQLEXPRESS), não por BACKUP_LOGIN. Dê a ela permissão de
-- escrita em C:\Backups; dê a BACKUP_LOGIN leitura/escrita em C:\Backups (hash,
-- zip, cópia externa) e escrita no destino externo. Ver infra\BACKUP.md.

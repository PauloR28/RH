# Backup, restauração e logs do Conecta

Este documento é o procedimento oficial (runbook) de backup do Conecta em produção. Ele cobre o que é copiado, quando, para onde, como saber se está funcionando e como restaurar.

## 1. O que existe e onde fica

| Dado | Onde fica | Entra no backup por |
|---|---|---|
| Banco `RH_Provas_C24H`: candidatos, processos, provas, usuários, monitorias, logs de auditoria etc. | SQL Server (`localhost\SQLEXPRESS`) | `.bak` diário |
| Arquivos enviados: CVs, anexos de e-mail, evidências de contestação e logos da Monitoria, imagens do Mural e do Calendário, materiais de treinamento | Pasta de dados (`D:\ConectaDados`) | `.zip` diário |
| Logs de auditoria com mais de 90 dias, arquivados em ZIP | `D:\ConectaDados\log-archive` | `.zip` diário |
| Log técnico e de acesso da aplicação | `D:\ConectaDados\logs` | Não entra no backup; retenção própria de 90 dias |

**Importante:** a pasta de dados precisa ficar fora de `C:\Conecta`. O deploy espelha o Git em `C:\Conecta`. Ele já protege `data\private` e `logs`, mas o lugar certo para esses arquivos é uma pasta própria. Configure no `.env`:

```
RH_PUBLIC_CV_UPLOAD_DIR=D:\ConectaDados\public-cvs
RH_TRAINING_UPLOAD_DIR=D:\ConectaDados\training-uploads
RH_EMAIL_INBOX_ATTACHMENTS_DIR=D:\ConectaDados\email_attachments
RH_LOG_ARCHIVE_DIR=D:\ConectaDados\log-archive
RH_LOG_DIR=D:\ConectaDados\logs
```

A cada deploy, o script `verificar-pastas-dados.ps1` avisa se alguma dessas variáveis ainda aponta para dentro de `C:\Conecta`.

## 2. Rotina automática

| Tarefa agendada | Quando | O que faz |
|---|---|---|
| `Conecta-Backup-Diario` | Todo dia, 02:00 | 1. `BACKUP DATABASE ... WITH CHECKSUM` (e `COMPRESSION`, exceto no Express). 2. `RESTORE VERIFYONLY WITH CHECKSUM`. 3. SHA-256 do `.bak`. 4. Zip da pasta de dados, com conferência do número de arquivos e SHA-256. 5. Cópia para o destino externo, com conferência do hash no destino. 6. Retenção. 7. Alerta em caso de falha. |
| `Conecta-Backup-TesteRestauracao` | Domingo, 04:00 | 1. Confere o SHA-256 do `.bak` mais recente, que deve ter no máximo 36 h. 2. Restaura como `RH_Restore_Teste`. 3. Roda `DBCC CHECKDB`. 4. Compara a contagem de tabelas-chave com a produção. 5. Confere se arquivos referenciados no banco (CVs e anexos da Monitoria) estão no zip. 6. Apaga o banco temporário. 7. Alerta em caso de falha. |

**Retenção:**
- **No servidor** (`C:\Backups`): 14 dias (`-RetentionDays`).
- **No destino externo** (`-OffsiteDir`): os últimos 14 dias, mais o backup mais recente de cada uma das últimas 8 semanas e de cada um dos últimos 12 meses.
- **Logs do backup** (`C:\Backups\logs`): 90 dias.

**Alertas:**
- Toda execução grava no Log de Eventos do Windows (Aplicativo, origem `Conecta-Backup`): evento 9000 para OK, 9001 para falha.
- Se `-AlertTo` e `-SmtpServer` estiverem configurados, as falhas também chegam por e-mail. Com `-NotifySuccess`, os sucessos também.

## 2.1 Servidor sem as tarefas do runbook (tarefa única `Conecta-Backup`)

Se o servidor roda só a tarefa `Conecta-Backup` (script `backup-producao.ps1` com `-SqlPassword`), valem estas regras:

- **Pasta de arquivos:** sem `-DataDir`, o script usa `data\private` junto da aplicação (ex.: `C:\Conecta\data\private`), onde ficam CVs, evidências, imagens e anexos dos Chamados. Para desligar o backup de arquivos, passe `-DataDir -`. Antes desta mudança a tarefa não passava `-DataDir` e os arquivos ficavam **fora** do backup.
- **Verificação do `.bak`:** `RESTORE VERIFYONLY` exige a permissão `CREATE DATABASE`. Se a conta não tiver, o script registra um **AVISO** ("não verificado"), segue com o zip dos arquivos e não marca falha; o `BACKUP ... WITH CHECKSUM` já valida as páginas ao gravar. Qualquer outro erro de verificação continua sendo falha. O ideal continua sendo dar a permissão (ver `infra/sql/security/create_backup_user.sql`) e rodar o teste de restauração semanal.
- **Senha:** evite `-SqlPassword` na tarefa (fica visível na linha de comando). Prefira a variável de ambiente `CONECTA_BACKUP_SQL_PASSWORD` ou autenticação Windows.

## 3. Instalação (uma vez, no servidor)

1. **Pasta de dados:**
   - Crie `D:\ConectaDados` com as subpastas `public-cvs`, `training-uploads`, `email_attachments`, `log-archive` e `logs`.
   - Pare a tarefa `Conecta-RH`.
   - Copie o conteúdo de `C:\Conecta\data\private\*` para as subpastas correspondentes.
   - Ajuste o `.env` conforme a seção 1 e inicie `Conecta-RH`.
   - Permissões da pasta: controle total apenas para a conta que roda o Conecta, a conta de backup e os Administradores.
2. **Conta de backup:**
   - Crie uma conta Windows, por exemplo `SERVIDOR\svc_conecta_backup`.
   - Rode:
     ```
     sqlcmd -S localhost\SQLEXPRESS -E -I -i C:\Conecta\infra\sql\security\create_backup_user.sql -v DATABASE_NAME="RH_Provas_C24H" BACKUP_LOGIN="SERVIDOR\svc_conecta_backup"
     ```
3. **Permissões de pasta:**
   - A conta de **serviço** do SQL Server (ex.: `NT Service\MSSQL$SQLEXPRESS`) precisa de escrita em `C:\Backups`, porque é ela que grava o `.bak`.
   - `svc_conecta_backup` precisa de:
     - leitura e escrita em `C:\Backups`;
     - leitura em `D:\ConectaDados`;
     - escrita no destino externo.
4. **Registrar as tarefas** (PowerShell como Administrador):
   ```
   C:\Conecta\infra\scripts\powershell\registrar-tarefas-backup.ps1 `
       -TaskUser "SERVIDOR\svc_conecta_backup" `
       -DataDir "D:\ConectaDados" `
       -OffsiteDir "\\servidor-backup\conecta" `
       -AlertTo "ti@empresa.com.br" -SmtpServer "smtp.office365.com" -SmtpFrom "alertas@empresa.com.br"
   ```
   - Para o e-mail: rode uma vez com `-ConfigurarSmtp`, logado como `svc_conecta_backup`. A credencial fica protegida por DPAPI e só essa conta consegue lê-la.
   - Os scripts são copiados para `C:\Backups\scripts`, para não dependerem de `C:\Conecta` durante um deploy. **Depois de atualizar os scripts no Git, rode o registro de novo.**
5. **Teste manual:**
   ```
   Start-ScheduledTask -TaskName Conecta-Backup-Diario
   Start-ScheduledTask -TaskName Conecta-Backup-TesteRestauracao
   ```
   Confira os logs mais recentes em `C:\Backups\logs`.

**Destino externo:** qualquer caminho que o Windows grave: pasta de rede (`\\servidor\pasta`), NAS, ou uma pasta sincronizada do OneDrive/SharePoint da empresa. Não use um disco do próprio servidor, porque aí não há proteção contra perda do servidor ou ransomware.

## 4. Como saber se está funcionando

- `Get-ScheduledTask Conecta-Backup* | Get-ScheduledTaskInfo` mostra a última execução e o resultado (`LastTaskResult = 0` é OK).
- Os logs ficam em `C:\Backups\logs\backup-AAAA-MM-DD.log` e `teste-restauracao-AAAA-MM-DD.log`.
- No Visualizador de Eventos, em Logs do Windows → Aplicativo, filtre pela origem `Conecta-Backup`.
- Os arquivos do dia estão em `C:\Backups` e no destino externo, cada um com o `.sha256` ao lado.

## 5. Quando chegar um alerta de falha

1. Abra o log citado no e-mail.
2. Identifique a etapa que falhou e aja:

| Mensagem | Causa provável | Ação |
|---|---|---|
| `sqlcmd falhou ... BACKUP` | Sem permissão, disco cheio ou serviço parado | Conferir o espaço em `C:\Backups`, o serviço SQL e a permissão da conta de serviço na pasta |
| `VERIFYONLY` ou `CHECKDB` com erro | Backup corrompido ou disco com problema | **Urgente:** rodar o backup manualmente e checar a saúde do disco |
| `Hash nao confere na copia externa` | Falha de rede ou destino cheio | Checar o destino e rodar a tarefa de novo |
| `backup mais recente tem mais de 36 h` | A tarefa diária não está rodando | Checar `Get-ScheduledTaskInfo` e a senha da conta da tarefa |
| `arquivo(s) referenciado(s) no banco nao encontrado(s)` | Arquivo perdido antes do backup, ou `-DataDir` errado | Conferir a pasta de dados e o `.env` |

3. Depois de corrigir, rode a tarefa manualmente e confirme que o log termina com `fim OK`.

## 6. Restauração

> Sempre restaure primeiro em um banco com **outro nome** e confira antes de mexer em produção.

**Antes de restaurar**, confira a integridade:
```
Get-FileHash C:\Backups\RH_Provas_C24H_AAAA-MM-DD_HHMM.bak -Algorithm SHA256
Get-Content  C:\Backups\RH_Provas_C24H_AAAA-MM-DD_HHMM.bak.sha256
```
Os dois hashes precisam ser iguais. Depois rode `infra\sql\backup\verify_backup.sql`.

### 6.1 Restauração completa (desastre)
1. Pare a aplicação: `Stop-ScheduledTask -TaskName Conecta-RH`.
2. Restaure o banco (`infra\sql\backup\restore_database.sql`, com a conta DBA):
   ```
   sqlcmd -S localhost\SQLEXPRESS -E -I -i C:\Conecta\infra\sql\backup\restore_database.sql -v DATABASE_NAME="RH_Provas_C24H" BACKUP_PATH="C:\Backups\RH_Provas_C24H_AAAA-MM-DD_HHMM.bak"
   ```
3. Restaure os arquivos: extraia o `ConectaArquivos_AAAA-MM-DD_HHMM.zip` **do mesmo horário** em `D:\ConectaDados`.
4. Inicie a aplicação e confira `http://localhost:8000/health`.

### 6.2 Recuperar uma monitoria, candidato ou registro específico
1. Restaure o `.bak` como um banco separado, sem tocar em produção:
   ```sql
   RESTORE FILELISTONLY FROM DISK = N'C:\Backups\RH_Provas_C24H_AAAA-MM-DD_HHMM.bak';
   RESTORE DATABASE [RH_Recuperacao] FROM DISK = N'C:\Backups\RH_Provas_C24H_AAAA-MM-DD_HHMM.bak'
     WITH MOVE N'<nome lógico dados>' TO N'C:\Backups\restore\RH_Recuperacao.mdf',
          MOVE N'<nome lógico log>'   TO N'C:\Backups\restore\RH_Recuperacao_log.ldf', RECOVERY;
   ```
2. Consulte o registro em `RH_Recuperacao` e compare com a produção.
3. A reinserção em produção é feita pelo DBA, com script revisado. As tabelas da Monitoria são imutáveis por trigger; a reinserção usa `INSERT` e não é bloqueada.
4. Ao terminar, apague o banco: `DROP DATABASE [RH_Recuperacao]`.

### 6.3 Recuperar um arquivo (CV, evidência, imagem)
1. Descubra o nome do arquivo no banco:
   - CV: `candidatos_anexos.nome_arquivo_armazenado`;
   - evidência da Monitoria: `monitoria_anexos.arquivo`.
2. Abra o `ConectaArquivos_*.zip` de uma data em que o arquivo existia e extraia só esse arquivo para a mesma subpasta em `D:\ConectaDados`.

## 7. Logs da aplicação

| Log | Onde | Retenção |
|---|---|---|
| Auditoria (quem fez o quê) | Tabela `logs_auditoria`, com tela de consulta em Configurações | 90 dias no banco (`RH_LOG_ARCHIVE_DAYS`); depois vira ZIP em `log-archive`, que entra no backup |
| Logs da Monitoria | Tabela `monitoria_logs`, imutável | Permanente |
| Log técnico (erros, exceções) e de acesso (cada requisição) | `RH_LOG_DIR\conecta.log` (dia atual) e `conecta.log.AAAA-MM-DD` (dias anteriores), JSON, uma linha por evento | `RH_LOG_RETENTION_DAYS` (padrão 90) |
| Backup e teste de restauração | `C:\Backups\logs` | 90 dias |

## 8. LGPD e backups

A retenção automática (Configurações → LGPD e Retenção, desligada por padrão) apaga do banco e do disco os dados de candidatos após o prazo configurado: 6 meses da candidatura, ou 6 meses da entrada no banco de talentos, com aviso prévio de 7 dias ao Administrador e ao Gestor. Contratados e candidatos em processo aberto nunca são excluídos; cada execução fica na auditoria (só com os IDs, sem dado pessoal). **Cópias antigas continuam nos backups até expirarem:** 14 dias no servidor e até 12 meses no destino externo (backup mensal). Isso deve constar na política de privacidade. Se um backup antigo for restaurado, o job de retenção da madrugada seguinte volta a apagar esses dados.

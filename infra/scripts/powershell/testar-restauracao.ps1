param(
    [string]$SqlServer = "localhost\SQLEXPRESS",
    # Banco de producao: usado so para achar o .bak e comparar contagens de linhas.
    [string]$SqlDatabase = "RH_Provas_C24H",
    [string]$SqlUsername = "",
    [string]$BackupDir = "C:\Backups",
    # Nome do banco temporario. NUNCA use o nome do banco de producao.
    [string]$RestoreDbName = "RH_Restore_Teste",
    # Onde o SQL Server grava os arquivos do banco temporario (vazio = pasta padrao da instancia).
    [string]$RestoreFilesDir = "",
    [string]$LogDir = "",
    [int]$LogRetentionDays = 90,
    [string]$AlertTo = "",
    [string]$SmtpServer = "",
    [int]$SmtpPort = 587,
    [string]$SmtpFrom = "",
    [string]$SmtpCredFile = "",
    [switch]$NotifySuccess
)

# Teste de restauracao: prova que o backup mais recente REALMENTE restaura.
# 1. confere o SHA-256 do .bak; 2. restaura como banco temporario; 3. DBCC CHECKDB;
# 4. compara contagens de tabelas-chave com producao; 5. confere o zip de arquivos;
# 6. apaga o banco temporario. Qualquer falha gera alerta.

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "backup-comum.ps1")

if (-not $LogDir) { $LogDir = Join-Path $BackupDir "logs" }
if ($RestoreDbName -ieq $SqlDatabase) { throw "RestoreDbName nao pode ser igual ao banco de producao." }

Iniciar-LogBackup -LogDir $LogDir -Prefixo "teste-restauracao"
$inicio = Get-Date
$resumo = New-Object System.Collections.Generic.List[string]
$restaurado = $false

# Tabelas-chave: nome -> se vazia no backup com producao preenchida, e erro.
$tabelasChave = @(
    "usuarios", "processos_seletivos", "candidatos_processos", "candidatos_anexos", "banco_talentos",
    "respostas_provas", "resultados_provas", "monitorias", "monitoria_respostas", "monitoria_matriz_versoes",
    "logs_auditoria", "monitoria_logs"
)

function Contar-Linhas {
    param([string]$Banco)
    $lista = ($tabelasChave | ForEach-Object { "N'$_'" }) -join ","
    # sys.partitions nao le dados pessoais; so metadados de contagem.
    $linhas = Invoke-SqlBackup -Server $SqlServer -Database $Banco -Username $SqlUsername -Query @"
SELECT t.name + '|' + CAST(SUM(p.rows) AS varchar(20))
FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.name IN ($lista) GROUP BY t.name
"@
    $mapa = @{}
    foreach ($l in $linhas) {
        $partes = $l -split "\|"
        if ($partes.Count -eq 2) { $mapa[$partes[0].Trim()] = [int64]$partes[1].Trim() }
    }
    return $mapa
}

try {
    # ------------------------------------------------ 1. backup mais recente
    $bak = Get-ChildItem -Path $BackupDir -Filter "$($SqlDatabase)_*.bak" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $bak) { throw "Nenhum backup '$($SqlDatabase)_*.bak' encontrado em $BackupDir." }
    $idadeHoras = [math]::Round(((Get-Date) - $bak.LastWriteTime).TotalHours, 1)
    Escrever-Log "Backup mais recente: $($bak.Name) ($idadeHoras h)"
    if ($idadeHoras -gt 36) { Escrever-Log "O backup mais recente tem mais de 36 h - o backup diario pode nao estar rodando." "ERRO" }
    if (-not (Conferir-Hash -Arquivo $bak.FullName)) { throw "SHA-256 do backup nao confere (ou .sha256 ausente): $($bak.Name)" }
    Escrever-Log "SHA-256 confere." "OK"

    # ------------------------------------------------------- 2. restauracao
    $bakSql = $bak.FullName.Replace("'", "''")
    # Saida separada por "|": LogicalName|PhysicalName|Type|... (as demais colunas variam por versao).
    $arquivos = Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -Query "RESTORE FILELISTONLY FROM DISK = N'$bakSql'"
    if (-not $RestoreFilesDir) {
        $RestoreFilesDir = (Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -Query "SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(260))" | Select-Object -First 1).Trim()
    }
    $moves = @()
    $i = 0
    foreach ($linha in $arquivos) {
        $partes = $linha -split "\|"
        if ($partes.Count -lt 3 -or $partes[2].Trim() -notin @("D", "L", "S", "F")) { continue }
        $extensao = if ($partes[2].Trim() -eq "L") { "ldf" } else { "mdf" }
        $destino = Join-Path $RestoreFilesDir ("{0}_{1}.{2}" -f $RestoreDbName, $i, $extensao)
        $moves += "MOVE N'$($partes[0].Trim().Replace("'", "''"))' TO N'$($destino.Replace("'", "''"))'"
        $i++
    }
    if (-not $moves) { throw "Nao foi possivel ler a lista de arquivos do backup (RESTORE FILELISTONLY)." }
    Escrever-Log "Restaurando como '$RestoreDbName' em '$RestoreFilesDir'..."
    Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -TimeoutSeconds 0 -Query "RESTORE DATABASE [$RestoreDbName] FROM DISK = N'$bakSql' WITH $($moves -join ', '), REPLACE, RECOVERY, CHECKSUM, STATS = 25" | Out-Null
    $restaurado = $true
    Escrever-Log "Restauracao concluida." "OK"

    # ----------------------------------------------------------- 3. CHECKDB
    Escrever-Log "Executando DBCC CHECKDB..."
    Invoke-SqlBackup -Server $SqlServer -Database $RestoreDbName -Username $SqlUsername -Query "DBCC CHECKDB ([$RestoreDbName]) WITH NO_INFOMSGS, ALL_ERRORMSGS" | Out-Null
    Escrever-Log "DBCC CHECKDB sem erros." "OK"
    $resumo.Add("Restauracao de $($bak.Name) + DBCC CHECKDB: OK")

    # ------------------------------------------------- 4. contagem de linhas
    $contagemBackup = Contar-Linhas -Banco $RestoreDbName
    $contagemProducao = Contar-Linhas -Banco $SqlDatabase
    foreach ($tabela in $tabelasChave) {
        if (-not $contagemProducao.ContainsKey($tabela)) { continue }
        $prod = $contagemProducao[$tabela]
        $back = if ($contagemBackup.ContainsKey($tabela)) { $contagemBackup[$tabela] } else { -1 }
        $texto = "{0}: backup {1} / producao {2}" -f $tabela, $back, $prod
        if ($back -lt 0) { Escrever-Log "$texto - tabela AUSENTE no backup." "ERRO" }
        elseif ($prod -gt 100 -and $back -lt ($prod * 0.5)) { Escrever-Log "$texto - backup com menos da metade das linhas." "ERRO" }
        elseif ($prod -gt 0 -and $back -eq 0) { Escrever-Log "$texto - tabela vazia no backup." "ERRO" }
        else { Escrever-Log $texto }
    }
    $resumo.Add("Contagem de tabelas-chave conferida ($($contagemProducao.Count) tabelas)")

    # ----------------------------------------------------- 5. zip de arquivos
    $zip = Get-ChildItem -Path $BackupDir -Filter "ConectaArquivos_*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($zip) {
        if (-not (Conferir-Hash -Arquivo $zip.FullName)) { throw "SHA-256 do zip de arquivos nao confere: $($zip.Name)" }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $leitor = [System.IO.Compression.ZipFile]::OpenRead($zip.FullName)
        try {
            $nomes = @{}
            foreach ($e in $leitor.Entries) { $nomes[$e.Name.ToLowerInvariant()] = $true }
            $total = $leitor.Entries.Count
        }
        finally { $leitor.Dispose() }
        # Amostra: arquivos que o banco restaurado referencia precisam estar no zip.
        $amostra = @()
        try {
            $amostra += Invoke-SqlBackup -Server $SqlServer -Database $RestoreDbName -Username $SqlUsername -Query "SELECT TOP 5 nome_arquivo_armazenado FROM dbo.candidatos_anexos WHERE nome_arquivo_armazenado IS NOT NULL ORDER BY NEWID()"
        } catch { }
        try {
            $amostra += Invoke-SqlBackup -Server $SqlServer -Database $RestoreDbName -Username $SqlUsername -Query "SELECT TOP 5 arquivo FROM dbo.monitoria_anexos ORDER BY NEWID()"
        } catch { }
        try {
            # Anexos dos Chamados (Suporte TI): so os ativos que ainda tem arquivo guardado.
            $amostra += Invoke-SqlBackup -Server $SqlServer -Database $RestoreDbName -Username $SqlUsername -Query "SELECT TOP 5 chave_storage FROM dbo.chamado_anexos WHERE excluido_em IS NULL AND chave_storage <>  ORDER BY NEWID()"
        } catch { }
        $faltando = @($amostra | ForEach-Object { (Split-Path $_.Trim() -Leaf).ToLowerInvariant() } | Where-Object { $_ -and -not $nomes.ContainsKey($_) })
        if ($faltando.Count -gt 0) {
            Escrever-Log ("Zip {0}: {1} arquivo(s) referenciado(s) no banco nao encontrado(s): {2}" -f $zip.Name, $faltando.Count, ($faltando -join ", ")) "ERRO"
        }
        else {
            Escrever-Log "Zip $($zip.Name): $total arquivo(s); amostra de $($amostra.Count) referencia(s) do banco encontrada." "OK"
        }
        $resumo.Add("Arquivos: $($zip.Name) ($total arquivos)")
    }
    else {
        Escrever-Log "Nenhum zip de arquivos (ConectaArquivos_*.zip) em $BackupDir - CVs e evidencias sem backup?" "ERRO"
    }
}
catch {
    Escrever-Log "FALHA: $($_.Exception.Message)" "ERRO"
}
finally {
    if ($restaurado) {
        try {
            Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -Query "ALTER DATABASE [$RestoreDbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$RestoreDbName];" | Out-Null
            Escrever-Log "Banco temporario '$RestoreDbName' removido."
        }
        catch {
            Escrever-Log "Nao foi possivel remover '$RestoreDbName': $($_.Exception.Message)" "ERRO"
        }
    }
    Remover-LogsAntigos -LogDir $LogDir -Dias $LogRetentionDays
}

$duracao = [math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)
$alerta = @{ AlertTo = $AlertTo; SmtpServer = $SmtpServer; SmtpPort = $SmtpPort; SmtpFrom = $SmtpFrom; SmtpCredFile = $SmtpCredFile }
if ($script:BackupFalhas.Count -gt 0) {
    $corpo = "O TESTE DE RESTAURACAO do Conecta FALHOU em $env:COMPUTERNAME ($duracao min).`n`nErros:`n- " + ($script:BackupFalhas -join "`n- ") + "`n`nLog: $script:BackupLogFile`nProcedimento: infra\BACKUP.md"
    Enviar-AlertaBackup -Erro -Assunto "[Conecta] FALHA no teste de restauracao - $(Get-Date -Format 'dd/MM/yyyy')" -Corpo $corpo @alerta
    Escrever-Log "===== fim com FALHA ($duracao min) =====" "ERRO"
    exit 1
}
$corpo = "Teste de restauracao do Conecta OK em $env:COMPUTERNAME ($duracao min).`n`n- " + ($resumo -join "`n- ") + "`n`nLog: $script:BackupLogFile"
if ($NotifySuccess) { Enviar-AlertaBackup -Assunto "[Conecta] Teste de restauracao OK - $(Get-Date -Format 'dd/MM/yyyy')" -Corpo $corpo @alerta }
else { Enviar-AlertaBackup -SomenteEventLog -Assunto "[Conecta] Teste de restauracao OK" -Corpo $corpo }
Escrever-Log "===== fim OK ($duracao min) =====" "OK"
exit 0

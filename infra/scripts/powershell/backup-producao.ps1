param(
    [string]$SqlServer = "localhost\SQLEXPRESS",
    [string]$SqlDatabase = "RH_Provas_C24H",
    # Vazio = autenticacao Windows (recomendado: a conta da tarefa agendada).
    # Com usuario SQL, a senha vem de CONECTA_BACKUP_SQL_PASSWORD ou de -SqlPassword (legado).
    [string]$SqlUsername = "",
    [string]$SqlPassword = "",
    [string]$BackupDir = "C:\Backups",
    [int]$RetentionDays = 14,
    # Pasta de dados do Conecta (CVs, evidencias da Monitoria, imagens, logs arquivados).
    # Vazio = nao faz backup de arquivos (so do banco).
    [string]$DataDir = "",
    # Copia externa (pasta de rede, NAS ou pasta sincronizada do OneDrive/SharePoint).
    # Vazio = sem copia externa (nao recomendado).
    [string]$OffsiteDir = "",
    [int]$OffsiteDaily = 14,
    [int]$OffsiteWeekly = 8,
    [int]$OffsiteMonthly = 12,
    [string]$LogDir = "",
    [int]$LogRetentionDays = 90,
    # Alertas
    [string]$AlertTo = "",
    [string]$SmtpServer = "",
    [int]$SmtpPort = 587,
    [string]$SmtpFrom = "",
    [string]$SmtpCredFile = "",
    # Envia e-mail tambem quando tudo der certo (padrao: so em falha).
    [switch]$NotifySuccess
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "backup-comum.ps1")

if (-not $LogDir) { $LogDir = Join-Path $BackupDir "logs" }
if ($SqlPassword -and -not $env:CONECTA_BACKUP_SQL_PASSWORD) { $env:CONECTA_BACKUP_SQL_PASSWORD = $SqlPassword }
if (-not $SqlUsername -and $SqlPassword) { $SqlUsername = "rh_app" }

Iniciar-LogBackup -LogDir $LogDir -Prefixo "backup"
$inicio = Get-Date
$dataHora = Get-Date -Format "yyyy-MM-dd_HHmm"
$resumo = New-Object System.Collections.Generic.List[string]
$gerados = New-Object System.Collections.Generic.List[string]

function Copiar-ComConferencia {
    param([string]$Origem, [string]$Destino)
    Copy-Item -Path $Origem -Destination $Destino -Force
    Copy-Item -Path "$Origem.sha256" -Destination $Destino -Force
    $copia = Join-Path $Destino (Split-Path $Origem -Leaf)
    if (-not (Conferir-Hash -Arquivo $copia)) { throw "Hash nao confere na copia externa: $copia" }
}

function Aplicar-RetencaoExterna {
    # Mantem: os ultimos N dias, o mais recente de cada uma das ultimas N semanas
    # e o mais recente de cada um dos ultimos N meses. Aplica por "familia" de arquivo.
    param([string]$Pasta, [string]$Filtro)
    $arquivos = Get-ChildItem -Path $Pasta -Filter $Filtro | Where-Object { $_.Name -match "_(\d{4}-\d{2}-\d{2})_\d{4}\.(bak|zip)$" }
    $itens = foreach ($a in $arquivos) {
        [pscustomobject]@{ Arquivo = $a; Data = [datetime]::ParseExact(($a.Name -replace "^.*_(\d{4}-\d{2}-\d{2})_\d{4}\..*$", '$1'), "yyyy-MM-dd", $null) }
    }
    $hoje = (Get-Date).Date
    $manter = @{}
    $itens | Where-Object { $_.Data -ge $hoje.AddDays(-$OffsiteDaily) } | ForEach-Object { $manter[$_.Arquivo.FullName] = $true }
    $cal = [System.Globalization.CultureInfo]::InvariantCulture.Calendar
    $itens | Where-Object { $_.Data -ge $hoje.AddDays(-7 * $OffsiteWeekly) } |
        Group-Object { "{0}-{1}" -f $_.Data.Year, $cal.GetWeekOfYear($_.Data, [System.Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday) } |
        ForEach-Object { $manter[($_.Group | Sort-Object Data -Descending | Select-Object -First 1).Arquivo.FullName] = $true }
    $itens | Where-Object { $_.Data -ge $hoje.AddMonths(-$OffsiteMonthly) } |
        Group-Object { $_.Data.ToString("yyyy-MM") } |
        ForEach-Object { $manter[($_.Group | Sort-Object Data -Descending | Select-Object -First 1).Arquivo.FullName] = $true }
    foreach ($item in $itens) {
        if (-not $manter.ContainsKey($item.Arquivo.FullName)) {
            Escrever-Log "Retencao externa: removendo $($item.Arquivo.Name)"
            Remove-Item $item.Arquivo.FullName -Force
            Remove-Item "$($item.Arquivo.FullName).sha256" -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

    # ---------------------------------------------------------------- 1. banco
    $arquivoBak = Join-Path $BackupDir "$($SqlDatabase)_$dataHora.bak"
    $edicao = (Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -Query "SELECT CAST(SERVERPROPERTY('EngineEdition') AS int)") | Select-Object -First 1
    # EngineEdition 4 = Express, que nao suporta COMPRESSION.
    $opcoes = "CHECKSUM, INIT, STATS = 10"
    if ("$edicao".Trim() -ne "4") { $opcoes = "COMPRESSION, $opcoes" }
    Escrever-Log "Backup do banco '$SqlDatabase' em '$arquivoBak' (WITH $opcoes)..."
    $bakSql = $arquivoBak.Replace("'", "''")
    Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -Query "BACKUP DATABASE [$SqlDatabase] TO DISK = N'$bakSql' WITH $opcoes" | Out-Null

    Escrever-Log "Verificando o backup (RESTORE VERIFYONLY WITH CHECKSUM)..."
    Invoke-SqlBackup -Server $SqlServer -Username $SqlUsername -Query "RESTORE VERIFYONLY FROM DISK = N'$bakSql' WITH CHECKSUM" | Out-Null
    $hashBak = Escrever-Hash -Arquivo $arquivoBak
    $tamanhoBak = [math]::Round((Get-Item $arquivoBak).Length / 1MB, 1)
    Escrever-Log "Banco OK: $tamanhoBak MB, SHA-256 $hashBak" "OK"
    $resumo.Add("Banco: $(Split-Path $arquivoBak -Leaf) ($tamanhoBak MB) - verificado")
    $gerados.Add($arquivoBak)

    # ------------------------------------------------------------- 2. arquivos
    if ($DataDir) {
        if (-not (Test-Path $DataDir)) {
            Escrever-Log "Pasta de dados '$DataDir' nao existe - backup de arquivos NAO realizado." "ERRO"
        }
        else {
            Add-Type -AssemblyName System.IO.Compression
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $arquivoZip = Join-Path $BackupDir "ConectaArquivos_$dataHora.zip"
            Escrever-Log "Compactando '$DataDir' em '$arquivoZip' (sem a subpasta logs)..."
            $raiz = (Resolve-Path $DataDir).Path.TrimEnd('\') + '\'
            $pastaLogs = $raiz + 'logs\'
            $total = 0; $pulados = 0
            $zip = [System.IO.Compression.ZipFile]::Open($arquivoZip, [System.IO.Compression.ZipArchiveMode]::Create)
            try {
                foreach ($f in Get-ChildItem -Path $raiz -Recurse -File) {
                    if ($f.FullName.StartsWith($pastaLogs, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                    $relativo = $f.FullName.Substring($raiz.Length).Replace('\', '/')
                    try {
                        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $relativo, [System.IO.Compression.CompressionLevel]::Optimal)
                        $total++
                    }
                    catch {
                        $pulados++
                        Escrever-Log "Arquivo em uso ou inacessivel, ignorado: $relativo ($($_.Exception.Message))" "AVISO"
                    }
                }
            }
            finally {
                $zip.Dispose()
            }
            # Confere se o zip abre e tem o numero de entradas esperado.
            $conferencia = [System.IO.Compression.ZipFile]::OpenRead($arquivoZip)
            try { $entradas = $conferencia.Entries.Count } finally { $conferencia.Dispose() }
            if ($entradas -ne $total) { throw "Zip de arquivos inconsistente: $entradas entradas, esperado $total." }
            $hashZip = Escrever-Hash -Arquivo $arquivoZip
            $tamanhoZip = [math]::Round((Get-Item $arquivoZip).Length / 1MB, 1)
            Escrever-Log "Arquivos OK: $total arquivo(s), $tamanhoZip MB, $pulados ignorado(s), SHA-256 $hashZip" "OK"
            $resumo.Add("Arquivos: $(Split-Path $arquivoZip -Leaf) ($total arquivos, $tamanhoZip MB, $pulados ignorados)")
            $gerados.Add($arquivoZip)
        }
    }
    else {
        Escrever-Log "-DataDir nao informado: CVs, evidencias e imagens NAO estao no backup." "AVISO"
    }

    # ------------------------------------------------------- 3. copia externa
    if ($OffsiteDir) {
        if (-not (Test-Path $OffsiteDir)) { New-Item -ItemType Directory -Path $OffsiteDir -Force | Out-Null }
        foreach ($arquivo in $gerados) {
            Escrever-Log "Copiando $(Split-Path $arquivo -Leaf) para '$OffsiteDir'..."
            Copiar-ComConferencia -Origem $arquivo -Destino $OffsiteDir
        }
        Escrever-Log "Copia externa OK (hash conferido no destino)." "OK"
        $resumo.Add("Copia externa: $OffsiteDir")
        Aplicar-RetencaoExterna -Pasta $OffsiteDir -Filtro "$($SqlDatabase)_*.bak"
        Aplicar-RetencaoExterna -Pasta $OffsiteDir -Filtro "ConectaArquivos_*.zip"
    }
    else {
        Escrever-Log "-OffsiteDir nao informado: o backup fica apenas neste servidor." "AVISO"
    }

    # ------------------------------------------------------ 4. retencao local
    $limite = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -Path $BackupDir -File |
        Where-Object { ($_.Name -like "$($SqlDatabase)_*" -or $_.Name -like "ConectaArquivos_*") -and $_.LastWriteTime -lt $limite } |
        ForEach-Object {
            Escrever-Log "Retencao local ($RetentionDays dias): removendo $($_.Name)"
            Remove-Item $_.FullName -Force
        }
}
catch {
    Escrever-Log "FALHA: $($_.Exception.Message)" "ERRO"
}
finally {
    Remover-LogsAntigos -LogDir $LogDir -Dias $LogRetentionDays
}

$duracao = [math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)
$alerta = @{ AlertTo = $AlertTo; SmtpServer = $SmtpServer; SmtpPort = $SmtpPort; SmtpFrom = $SmtpFrom; SmtpCredFile = $SmtpCredFile }
if ($script:BackupFalhas.Count -gt 0) {
    $corpo = "O backup do Conecta FALHOU em $env:COMPUTERNAME ($duracao min).`n`nErros:`n- " + ($script:BackupFalhas -join "`n- ") + "`n`nConcluido:`n- " + ($resumo -join "`n- ") + "`n`nLog: $script:BackupLogFile`nProcedimento: infra\BACKUP.md"
    Enviar-AlertaBackup -Erro -Assunto "[Conecta] FALHA no backup de $(Get-Date -Format 'dd/MM/yyyy')" -Corpo $corpo @alerta
    Escrever-Log "===== fim com FALHA ($duracao min) =====" "ERRO"
    exit 1
}

$corpo = "Backup do Conecta concluido em $env:COMPUTERNAME ($duracao min).`n`n- " + ($resumo -join "`n- ") + "`n`nLog: $script:BackupLogFile"
if ($NotifySuccess) {
    Enviar-AlertaBackup -Assunto "[Conecta] Backup OK - $(Get-Date -Format 'dd/MM/yyyy')" -Corpo $corpo @alerta
}
else {
    Enviar-AlertaBackup -SomenteEventLog -Assunto "[Conecta] Backup OK - $(Get-Date -Format 'dd/MM/yyyy')" -Corpo $corpo
}
Escrever-Log "===== fim OK ($duracao min) =====" "OK"
exit 0

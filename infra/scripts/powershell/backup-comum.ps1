# Funcoes compartilhadas pelos scripts de backup e teste de restauracao do Conecta.
# Uso: . (Join-Path $PSScriptRoot "backup-comum.ps1")   (dot-source)
#
# Nada aqui guarda segredo em texto plano:
# - SQL: autenticacao Windows (recomendado) ou senha via variavel de ambiente.
# - SMTP: credencial salva com Export-Clixml (DPAPI), legivel apenas pela mesma
#   conta Windows na mesma maquina (ver registrar-tarefas-backup.ps1 -ConfigurarSmtp).

$script:BackupLogFile = $null
$script:BackupFalhas = New-Object System.Collections.Generic.List[string]
$script:EventSource = "Conecta-Backup"

function Iniciar-LogBackup {
    param([Parameter(Mandatory = $true)][string]$LogDir, [Parameter(Mandatory = $true)][string]$Prefixo)
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $script:BackupLogFile = Join-Path $LogDir ("{0}-{1}.log" -f $Prefixo, (Get-Date -Format "yyyy-MM-dd"))
    Escrever-Log "===== inicio ($Prefixo) em $env:COMPUTERNAME por $env:USERDOMAIN\$env:USERNAME ====="
}

function Escrever-Log {
    param([string]$Mensagem, [ValidateSet("INFO", "OK", "AVISO", "ERRO")][string]$Nivel = "INFO")
    $linha = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Nivel, $Mensagem
    $cor = @{ INFO = "Gray"; OK = "Green"; AVISO = "Yellow"; ERRO = "Red" }[$Nivel]
    Write-Host $linha -ForegroundColor $cor
    if ($script:BackupLogFile) { Add-Content -Path $script:BackupLogFile -Value $linha -Encoding UTF8 }
    if ($Nivel -eq "ERRO") { $script:BackupFalhas.Add($Mensagem) }
}

function Remover-LogsAntigos {
    param([string]$LogDir, [int]$Dias = 90)
    if (-not (Test-Path $LogDir)) { return }
    $limite = (Get-Date).AddDays(-$Dias)
    Get-ChildItem -Path $LogDir -Filter "*.log" | Where-Object { $_.LastWriteTime -lt $limite } | Remove-Item -Force -ErrorAction SilentlyContinue
}

function Invoke-SqlBackup {
    # Executa T-SQL via sqlcmd. Retorna as linhas de saida; lanca excecao em erro.
    param(
        [Parameter(Mandatory = $true)][string]$Server,
        [string]$Database = "master",
        [Parameter(Mandatory = $true)][string]$Query,
        [string]$Username = "",
        [int]$TimeoutSeconds = 0
    )
    $argumentos = @("-S", $Server, "-d", $Database, "-I", "-b", "-h", "-1", "-W", "-s", "|", "-Q", "SET NOCOUNT ON; $Query")
    if ($TimeoutSeconds -gt 0) { $argumentos += @("-t", "$TimeoutSeconds") }
    if ($Username) {
        # Senha vem da variavel de ambiente CONECTA_BACKUP_SQL_PASSWORD (nunca na linha de comando da tarefa).
        if (-not $env:CONECTA_BACKUP_SQL_PASSWORD) { throw "Usuario SQL '$Username' informado, mas CONECTA_BACKUP_SQL_PASSWORD nao esta definida." }
        $env:SQLCMDPASSWORD = $env:CONECTA_BACKUP_SQL_PASSWORD
        $argumentos += @("-U", $Username)
    }
    else {
        $argumentos += "-E"
    }
    try {
        $saida = & sqlcmd @argumentos 2>&1
        $codigo = $LASTEXITCODE
    }
    finally {
        Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue
    }
    if ($codigo -ne 0) {
        throw ("sqlcmd falhou (codigo {0}): {1}" -f $codigo, (($saida | Out-String).Trim()))
    }
    return @($saida | ForEach-Object { "$_" } | Where-Object { $_ -ne "" })
}

function Escrever-Hash {
    param([Parameter(Mandatory = $true)][string]$Arquivo)
    $hash = (Get-FileHash -Path $Arquivo -Algorithm SHA256).Hash
    $nome = Split-Path $Arquivo -Leaf
    Set-Content -Path "$Arquivo.sha256" -Value "$hash  $nome" -Encoding ASCII
    return $hash
}

function Conferir-Hash {
    # Retorna $true se o arquivo bate com o .sha256 ao lado dele.
    param([Parameter(Mandatory = $true)][string]$Arquivo)
    $arquivoHash = "$Arquivo.sha256"
    if (-not (Test-Path $arquivoHash)) { return $false }
    $esperado = ((Get-Content $arquivoHash -TotalCount 1) -split "\s+")[0]
    $atual = (Get-FileHash -Path $Arquivo -Algorithm SHA256).Hash
    return ($esperado -and ($esperado -ieq $atual))
}

function Enviar-AlertaBackup {
    # Envia e-mail (se configurado) e grava no Log de Eventos do Windows.
    param(
        [Parameter(Mandatory = $true)][string]$Assunto,
        [Parameter(Mandatory = $true)][string]$Corpo,
        [switch]$Erro,
        [string]$AlertTo = "",
        [string]$SmtpServer = "",
        [int]$SmtpPort = 587,
        [string]$SmtpFrom = "",
        [string]$SmtpCredFile = "",
        # Grava apenas no Log de Eventos (sem e-mail), ex.: sucesso sem -NotifySuccess.
        [switch]$SomenteEventLog
    )
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists($script:EventSource)) {
            New-EventLog -LogName Application -Source $script:EventSource -ErrorAction Stop
        }
        $tipo = if ($Erro) { "Error" } else { "Information" }
        $idEvento = if ($Erro) { 9001 } else { 9000 }
        Write-EventLog -LogName Application -Source $script:EventSource -EventId $idEvento -EntryType $tipo -Message "$Assunto`n`n$Corpo"
    }
    catch {
        Escrever-Log "Nao foi possivel gravar no Log de Eventos do Windows: $($_.Exception.Message)" "AVISO"
    }

    if ($SomenteEventLog) { return }
    if (-not $AlertTo -or -not $SmtpServer) {
        Escrever-Log "Alerta por e-mail nao configurado (-AlertTo / -SmtpServer); registrado apenas no log e no Log de Eventos." "AVISO"
        return
    }
    try {
        $parametros = @{
            To         = ($AlertTo -split "[;,]" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            From       = $(if ($SmtpFrom) { $SmtpFrom } else { "conecta-backup@$env:COMPUTERNAME" })
            Subject    = $Assunto
            Body       = $Corpo
            SmtpServer = $SmtpServer
            Port       = $SmtpPort
            UseSsl     = $true
            Encoding   = [System.Text.Encoding]::UTF8
        }
        if ($SmtpCredFile -and (Test-Path $SmtpCredFile)) {
            $parametros.Credential = Import-Clixml -Path $SmtpCredFile
        }
        Send-MailMessage @parametros -ErrorAction Stop -WarningAction SilentlyContinue
        Escrever-Log "Alerta enviado por e-mail para $AlertTo." "OK"
    }
    catch {
        Escrever-Log "Falha ao enviar alerta por e-mail: $($_.Exception.Message)" "AVISO"
    }
}

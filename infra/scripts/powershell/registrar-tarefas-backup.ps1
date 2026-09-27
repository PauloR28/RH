param(
    [string]$AppDir = "C:\Conecta",
    [string]$SqlServer = "localhost\SQLEXPRESS",
    [string]$SqlDatabase = "RH_Provas_C24H",
    [string]$BackupDir = "C:\Backups",
    [string]$DataDir = "D:\ConectaDados",
    [string]$OffsiteDir = "",
    [string]$AlertTo = "",
    [string]$SmtpServer = "",
    [int]$SmtpPort = 587,
    [string]$SmtpFrom = "",
    # Conta Windows que executa as tarefas (a mesma de create_backup_user.sql).
    [Parameter(Mandatory = $true)][string]$TaskUser,
    [string]$HorarioBackup = "02:00",
    [string]$HorarioTeste = "04:00",
    [ValidateSet("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")]
    [string]$DiaTeste = "Sunday",
    # Salva a credencial SMTP (DPAPI) para a conta da tarefa. Rode este script
    # logado COMO $TaskUser quando usar esta opcao (DPAPI e por usuario).
    [switch]$ConfigurarSmtp
)

# Registra (ou atualiza) as tarefas agendadas de backup do Conecta. Rodar uma vez,
# como Administrador, no servidor de producao. Reexecutar atualiza as tarefas.
#   Conecta-Backup-Diario            todo dia, $HorarioBackup
#   Conecta-Backup-TesteRestauracao  semanal ($DiaTeste), $HorarioTeste

$ErrorActionPreference = "Stop"

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este script em um PowerShell aberto como Administrador."
}

$scripts = Join-Path $AppDir "infra\scripts\powershell"
foreach ($nome in @("backup-producao.ps1", "testar-restauracao.ps1", "backup-comum.ps1")) {
    if (-not (Test-Path (Join-Path $scripts $nome))) { throw "Script nao encontrado: $(Join-Path $scripts $nome)" }
}

# Scripts copiados para fora de C:\Conecta: o deploy (robocopy /MIR) atualiza C:\Conecta
# e a tarefa agendada nao pode depender de uma pasta que esta sendo reescrita.
$pastaScripts = Join-Path $BackupDir "scripts"
if (-not (Test-Path $pastaScripts)) { New-Item -ItemType Directory -Path $pastaScripts -Force | Out-Null }
Copy-Item (Join-Path $scripts "backup-producao.ps1"), (Join-Path $scripts "testar-restauracao.ps1"), (Join-Path $scripts "backup-comum.ps1") -Destination $pastaScripts -Force
Write-Host "Scripts copiados para $pastaScripts (rode este registro de novo apos atualizar os scripts)."

$credFile = ""
if ($SmtpServer) {
    $credFile = Join-Path $pastaScripts "smtp-cred.xml"
    if ($ConfigurarSmtp) {
        if ("$env:USERDOMAIN\$env:USERNAME" -ine $TaskUser -and "$env:COMPUTERNAME\$env:USERNAME" -ine $TaskUser) {
            Write-Host "ATENCAO: a credencial SMTP e protegida por DPAPI para o usuario atual ($env:USERDOMAIN\$env:USERNAME)." -ForegroundColor Yellow
            Write-Host "A tarefa roda como $TaskUser e so conseguira ler se voce estiver logado como essa conta." -ForegroundColor Yellow
        }
        Get-Credential -Message "Usuario e senha do SMTP para alertas de backup" | Export-Clixml -Path $credFile
        Write-Host "Credencial SMTP salva em $credFile (protegida por DPAPI)." -ForegroundColor Green
    }
}

function Montar-Argumentos {
    param([string]$Script, [hashtable]$Extras)
    $partes = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $pastaScripts $Script)`"")
    foreach ($chave in $Extras.Keys) {
        $valor = $Extras[$chave]
        if ($null -ne $valor -and "$valor" -ne "") { $partes += "-$chave"; $partes += "`"$valor`"" }
    }
    return ($partes -join " ")
}

$comuns = @{
    SqlServer    = $SqlServer
    SqlDatabase  = $SqlDatabase
    BackupDir    = $BackupDir
    AlertTo      = $AlertTo
    SmtpServer   = $SmtpServer
    SmtpPort     = $SmtpPort
    SmtpFrom     = $SmtpFrom
    SmtpCredFile = $credFile
}
$argsBackup = Montar-Argumentos -Script "backup-producao.ps1" -Extras ($comuns + @{ DataDir = $DataDir; OffsiteDir = $OffsiteDir })
$argsTeste = Montar-Argumentos -Script "testar-restauracao.ps1" -Extras $comuns

$senha = Read-Host -AsSecureString "Senha do Windows de $TaskUser (para a tarefa rodar sem usuario logado)"
$senhaTexto = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senha))

$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew

$tarefas = @(
    @{ Nome = "Conecta-Backup-Diario"; Args = $argsBackup; Gatilho = (New-ScheduledTaskTrigger -Daily -At $HorarioBackup); Descricao = "Backup diario do banco e dos arquivos do Conecta (ver infra\BACKUP.md)." },
    @{ Nome = "Conecta-Backup-TesteRestauracao"; Args = $argsTeste; Gatilho = (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DiaTeste -At $HorarioTeste); Descricao = "Teste semanal de restauracao do backup do Conecta (ver infra\BACKUP.md)." }
)

foreach ($t in $tarefas) {
    $acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $t.Args -WorkingDirectory $pastaScripts
    Register-ScheduledTask -TaskName $t.Nome -Description $t.Descricao -Action $acao -Trigger $t.Gatilho -Settings $config `
        -User $TaskUser -Password $senhaTexto -RunLevel Highest -Force | Out-Null
    Write-Host "Tarefa registrada: $($t.Nome)" -ForegroundColor Green
}
$senhaTexto = $null

Write-Host ""
Write-Host "Pronto. Para testar agora:"
Write-Host "  Start-ScheduledTask -TaskName Conecta-Backup-Diario"
Write-Host "  Get-Content (Get-ChildItem '$BackupDir\logs\backup-*.log' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName"

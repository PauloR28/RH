param(
    [string]$SqlServer = "localhost\SQLEXPRESS",
    [string]$SqlDatabase = "RH_Provas_C24H",
    [string]$SqlUsername = "rh_app",
    [Parameter(Mandatory = $true)][string]$SqlPassword,
    [string]$BackupDir = "C:\Backups",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$dataHora = Get-Date -Format "yyyy-MM-dd_HHmm"
$arquivo = Join-Path $BackupDir "$($SqlDatabase)_$dataHora.bak"

Write-Host "Iniciando backup de '$SqlDatabase' para '$arquivo'..."
sqlcmd -S $SqlServer -d $SqlDatabase -U $SqlUsername -P $SqlPassword -I -Q "BACKUP DATABASE [$SqlDatabase] TO DISK = N'$arquivo' WITH INIT, STATS = 10"

if ($LASTEXITCODE -ne 0) {
    Write-Host "FALHOU - veja a mensagem do sqlcmd acima." -ForegroundColor Red
    exit 1
}

$tamanho = (Get-Item $arquivo).Length / 1MB
Write-Host "OK - backup criado ($([math]::Round($tamanho, 1)) MB)" -ForegroundColor Green

Write-Host "Removendo backups com mais de $RetentionDays dias..."
$limite = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "$($SqlDatabase)_*.bak" |
    Where-Object { $_.LastWriteTime -lt $limite } |
    ForEach-Object {
        Write-Host "Removendo $($_.Name)"
        Remove-Item $_.FullName -Force
    }

Write-Host "Backup concluido."

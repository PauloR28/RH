param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Database,
    [switch]$TrustedConnection,
    [string]$Username,
    [string]$Password
)

$ErrorActionPreference = "Stop"

$MigrationsDir = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))) "sql\migrations"
$Files = Get-ChildItem -Path $MigrationsDir -Filter "V*.sql" | Where-Object { $_.Name -notmatch "\.rollback\.sql$" } | Sort-Object Name

if ($Files.Count -eq 0) {
    throw "Nenhum arquivo de migration encontrado em $MigrationsDir"
}

Write-Host ""
Write-Host "Aplicando $($Files.Count) migrations idempotentes em '$Database' @ '$Server'"
Write-Host "Todas usam IF NOT EXISTS / COL_LENGTH - reaplicar uma ja aplicada nao tem efeito."
Write-Host ""

foreach ($file in $Files) {
    Write-Host "-> $($file.Name)" -NoNewline

    if ($TrustedConnection) {
        $result = sqlcmd -S $Server -d $Database -E -i $file.FullName -b 2>&1
    }
    else {
        $result = sqlcmd -S $Server -d $Database -U $Username -P $Password -i $file.FullName -b 2>&1
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host " FALHOU" -ForegroundColor Red
        Write-Host $result
        throw "Migration $($file.Name) falhou. Pare, revise o erro acima antes de continuar (nao rode o restante)."
    }

    Write-Host " ok" -ForegroundColor Green
}

Write-Host ""
Write-Host "Todas as $($Files.Count) migrations aplicadas com sucesso."

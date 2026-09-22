param(
    [string]$RepoUrl = "https://github.com/PauloR28/RH.git",
    [string]$Branch = "main",
    [string]$AppDir = "C:\Conecta",
    [string]$TaskName = "Conecta-RH",
    [string]$SqlServer = "localhost\SQLEXPRESS",
    [string]$SqlDatabase = "RH_Provas_C24H",
    [string]$SqlUsername = "rh_app",
    [Parameter(Mandatory = $true)][string]$SqlPassword,
    [Parameter(Mandatory = $true)][string]$GitHubToken
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$owner_repo = ($RepoUrl -replace "https://github.com/", "" -replace "\.git$", "")
$tempZip = Join-Path $env:TEMP "conecta-deploy.zip"
$tempExtract = Join-Path $env:TEMP "conecta-deploy-extraido"

Write-Host ""
Write-Host "== 1/6: baixando codigo mais recente ($Branch) =="
if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
$headers = @{ Authorization = "token $GitHubToken" }
Invoke-WebRequest -Uri "https://api.github.com/repos/$owner_repo/zipball/$Branch" -Headers $headers -OutFile $tempZip
Expand-Archive -Path $tempZip -DestinationPath $tempExtract
$sourceDir = (Get-ChildItem $tempExtract | Select-Object -First 1).FullName
Write-Host "OK - baixado em $sourceDir"

Write-Host ""
Write-Host "== 2/6: parando a aplicacao =="
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "== 3/6: atualizando arquivos (preserva .env e .venv existentes) =="
if (-not (Test-Path $AppDir)) {
    New-Item -ItemType Directory -Path $AppDir | Out-Null
}
robocopy $sourceDir $AppDir /MIR /XD ".venv" ".git" /XF ".env" /NFL /NDL /NJH /NJS | Out-Null
Write-Host "OK - arquivos atualizados em $AppDir"

Write-Host ""
Write-Host "== 4/6: instalando dependencias Python =="
if (-not (Test-Path (Join-Path $AppDir ".venv"))) {
    Write-Host "Ambiente virtual nao existe, criando..."
    python -m venv (Join-Path $AppDir ".venv")
}
& (Join-Path $AppDir ".venv\Scripts\pip.exe") install --quiet --upgrade pip
& (Join-Path $AppDir ".venv\Scripts\pip.exe") install --quiet -r (Join-Path $AppDir "requirements.txt")
Write-Host "OK - dependencias instaladas"

Write-Host ""
Write-Host "== 5/6: aplicando migrations pendentes (idempotente, seguro reaplicar) =="
& powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "infra\scripts\powershell\aplicar-migrations.ps1") -Server $SqlServer -Database $SqlDatabase -Username $SqlUsername -Password $SqlPassword

Write-Host ""
Write-Host "== 6/6: reiniciando a aplicacao =="
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "OK - aplicacao respondendo: $($resp.Content)" -ForegroundColor Green
}
catch {
    Write-Host "ATENCAO - aplicacao nao respondeu em /health. Verifique manualmente." -ForegroundColor Red
    throw
}

Remove-Item $tempZip -ErrorAction SilentlyContinue
Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Deploy concluido com sucesso." -ForegroundColor Green

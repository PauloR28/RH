param(
    [string]$BindHost = "",
    [int]$Port = 0,
    [switch]$Reload
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $ProjectRoot ".\.venv\Scripts\python.exe"
$Python = if (Test-Path -LiteralPath $VenvPython) { $VenvPython } else { "python" }

$RunArgs = @((Join-Path $ProjectRoot "run.py"))

if ($BindHost) {
    $RunArgs += "--host"
    $RunArgs += $BindHost
}

if ($Port -gt 0) {
    $RunArgs += "--port"
    $RunArgs += [string]$Port
}

if ($Reload) {
    $RunArgs += "--reload"
}

# Frontend empacotado: o codigo-fonte sao ~190 modulos baixados e revalidados um a um (lento em rede/VPN);
# o bundle sao poucos arquivos com hash e cache longo. Gera a cada subida e so ativa se o build der certo.
$FrontendDir = Join-Path $ProjectRoot "apps\frontend"
$ViteCli = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $ViteCli)) {
    Push-Location $FrontendDir
    try {
        & node $ViteCli build --logLevel error
        if ($LASTEXITCODE -eq 0) { $env:RH_FRONTEND_BUNDLE = "1" }
        else { Write-Host "Build do frontend falhou; servindo o codigo-fonte (mais lento)." }
    } finally { Pop-Location }
} else {
    Write-Host "Node/Vite indisponivel; servindo o codigo-fonte (mais lento). Rode 'npm install' em apps\frontend."
}

Write-Host ""
Write-Host "Conecta/RH - API e Front unificados"
$DisplayHost = if ($BindHost -and $BindHost -ne "0.0.0.0") { $BindHost } else { "127.0.0.1" }
$DisplayPort = if ($Port -gt 0) { $Port } else { 8000 }
Write-Host ("Acesse: http://{0}:{1}" -f $DisplayHost, $DisplayPort)
Write-Host ""

& $Python @RunArgs
exit $LASTEXITCODE

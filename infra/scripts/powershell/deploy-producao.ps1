param(
    # Branch, tag ou SHA de commit a publicar. Ex.: -Ref main  |  -Ref 53cba38
    [string]$Ref = "main",
    [string]$Repo = "PauloR28/RH",
    [string]$AppDir = "C:\Conecta",
    [string]$TaskName = "Conecta-RH",
    [string]$SqlServer = "localhost\SQLEXPRESS",
    [string]$SqlDatabase = "RH_Provas_C24H",
    [string]$SqlUsername = "rh_app",
    [string]$BackupDir = "C:\Backups\pre-deploy",
    # Quantos backups pre-deploy manter (os mais antigos sao apagados).
    [int]$ManterBackups = 10,
    # Token do GitHub (so leitura). Necessario apenas se o repositorio for privado.
    [string]$GitHubToken = ""
)

# Deploy manual do Conecta na maquina de PRODUCAO. Rodar em PowerShell como
# Administrador:
#   powershell -ExecutionPolicy Bypass -File C:\Deploy\deploy-producao.ps1
#   powershell -ExecutionPolicy Bypass -File C:\Deploy\deploy-producao.ps1 -Ref 53cba38
#
# Guarde uma copia FORA de C:\Conecta (ex.: C:\Deploy). Para atualizar a copia,
# baixe a versao nova deste arquivo do GitHub.
#
# Ordem:
#   1. pede a senha do rh_app (antes de mexer em qualquer coisa)
#   2. backup do banco (CHECKSUM + VERIFYONLY). Se falhar, o deploy nao continua
#   3. baixa o codigo ($Ref) do GitHub como ZIP
#   4. para a aplicacao ANTES de copiar (arquivo em uso travava o robocopy)
#   5. copia com robocopy /MIR preservando .env, .venv, data\private e logs
#   6. recria o .venv e instala dependencias
#   7. aplica migrations pendentes
#   8. religa a aplicacao e confere /health (mesmo se algo acima falhar)
#
# Historico:
# - 24/set/2026: robocopy sem /R /W tentava 1 milhao de vezes (30 s cada) e
#   parecia travado; a aplicacao era parada so depois da copia.
# - 28/set/2026: /MIR apagava data\private (CVs, evidencias da Monitoria,
#   imagens) e logs, que nao estao no Git. Agora sao excluidos e contados antes
#   e depois. Backup do banco antes de tudo; senha nao fica gravada no arquivo.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este script em um PowerShell aberto como Administrador."
}

$Tmp = Join-Path $env:TEMP "conecta-deploy-$(Get-Date -Format yyyyMMddHHmmss)"
# Pastas com dados que NUNCA podem ser apagadas pelo /MIR.
$PastasProtegidas = @((Join-Path $AppDir "data\private"), (Join-Path $AppDir "logs"))

function Contar-ArquivosProtegidos {
    $total = 0
    foreach ($p in $PastasProtegidas) {
        if (Test-Path $p) { $total += @(Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue).Count }
    }
    return $total
}

Write-Host ""
Write-Host "== Deploy do Conecta: $Repo @ $Ref ==" -ForegroundColor Cyan

# ---------------------------------------------------------------- 1. senha
$senhaSegura = Read-Host -AsSecureString "Senha do usuario $SqlUsername no SQL de producao"
$SqlPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSegura))
if (-not $SqlPassword) { throw "Senha vazia. Deploy cancelado." }

# ---------------------------------------------------------------- 2. backup
Write-Host ""
Write-Host "1) Backup do banco $SqlDatabase..." -ForegroundColor Cyan
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
# Nome com data/hora: um deploy repetido nao sobrescreve o backup anterior.
$bak = Join-Path $BackupDir "$($SqlDatabase)_pre_deploy_$(Get-Date -Format yyyyMMdd_HHmmss).bak"
sqlcmd -S $SqlServer -E -b -Q "BACKUP DATABASE [$SqlDatabase] TO DISK = N'$bak' WITH CHECKSUM, INIT; RESTORE VERIFYONLY FROM DISK = N'$bak' WITH CHECKSUM;"
if ($LASTEXITCODE -ne 0) { throw "Backup do banco falhou (codigo $LASTEXITCODE). Deploy cancelado; nada foi alterado." }
Write-Host "   OK: $bak"
Get-ChildItem $BackupDir -Filter "$($SqlDatabase)_pre_deploy_*.bak" |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $ManterBackups |
    ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "   Backup antigo removido: $($_.Name)" }

# ---------------------------------------------------------------- 3. download
Write-Host ""
Write-Host "2) Baixando $Ref do GitHub (zip)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
$zipPath = Join-Path $Tmp "codigo.zip"
if ($GitHubToken) {
    Invoke-WebRequest -Uri "https://api.github.com/repos/$Repo/zipball/$Ref" -Headers @{ Authorization = "token $GitHubToken" } -OutFile $zipPath
} else {
    Invoke-WebRequest -Uri "https://github.com/$Repo/archive/$Ref.zip" -OutFile $zipPath
}
$extraido = Join-Path $Tmp "extraido"
Expand-Archive -Path $zipPath -DestinationPath $extraido -Force
$pastaExtraida = Get-ChildItem -Path $extraido -Directory | Select-Object -First 1
if (-not $pastaExtraida) { throw "Nao encontrei a pasta extraida do zip em $extraido" }
if (-not (Test-Path (Join-Path $pastaExtraida.FullName "requirements.txt"))) {
    throw "O zip baixado nao parece ser o Conecta (sem requirements.txt): $($pastaExtraida.FullName)"
}
Write-Host "   OK: $($pastaExtraida.FullName)"

$arquivosAntes = Contar-ArquivosProtegidos
Write-Host "   Arquivos em data\private + logs antes do deploy: $arquivosAntes"

# ---------------------------------------------------------------- 4. parar
Write-Host ""
Write-Host "3) Parando a aplicacao (ANTES de copiar, pra nao travar em arquivo em uso)..." -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$sucesso = $false
try {
    # ------------------------------------------------------------ 5. copiar
    Write-Host ""
    Write-Host "4) Copiando para $AppDir (preserva .env, .venv, data\private e logs)..." -ForegroundColor Cyan
    # /R:5 /W:5 = no maximo 5 tentativas de 5 s por arquivo travado, em vez do
    # padrao (1 milhao de tentativas de 30 s = trava "pra sempre").
    # /XD com caminho completo do destino impede o /MIR de apagar essas pastas.
    robocopy $pastaExtraida.FullName $AppDir /MIR /XD ".venv" ".git" $PastasProtegidas[0] $PastasProtegidas[1] /XF ".env" /R:5 /W:5 /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) { throw "robocopy falhou com codigo $LASTEXITCODE" }

    $arquivosDepois = Contar-ArquivosProtegidos
    if ($arquivosDepois -lt $arquivosAntes) {
        throw "data\private + logs tinham $arquivosAntes arquivos e agora tem $arquivosDepois. Recupere do backup antes de continuar."
    }
    Write-Host "   OK: data\private + logs preservados ($arquivosDepois arquivos)."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "infra\scripts\powershell\verificar-pastas-dados.ps1") -AppDir $AppDir

    # ------------------------------------------------------------ 6. dependencias
    Write-Host ""
    Write-Host "5) Recriando .venv e instalando dependencias..." -ForegroundColor Cyan
    $venvDir = Join-Path $AppDir ".venv"
    if (Test-Path $venvDir) { Remove-Item $venvDir -Recurse -Force }
    python -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o .venv (codigo $LASTEXITCODE)." }
    & (Join-Path $venvDir "Scripts\python.exe") -m pip install --quiet --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar o pip (codigo $LASTEXITCODE)." }
    & (Join-Path $venvDir "Scripts\pip.exe") install --quiet -r (Join-Path $AppDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar requirements.txt (codigo $LASTEXITCODE)." }
    Write-Host "   OK: dependencias instaladas"

    # ------------------------------------------------------------ 7. migrations
    Write-Host ""
    Write-Host "6) Aplicando migrations pendentes..." -ForegroundColor Cyan
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AppDir "infra\scripts\powershell\aplicar-migrations.ps1") -Server $SqlServer -Database $SqlDatabase -Username $SqlUsername -Password $SqlPassword
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar migrations (codigo $LASTEXITCODE). Backup do banco: $bak" }

    $sucesso = $true
}
finally {
    $SqlPassword = $null
    # ------------------------------------------------------------ 8. religar
    # Religa MESMO se algo acima falhar: melhor o site no ar com o que deu
    # certo do que caido enquanto se investiga o resto.
    Write-Host ""
    Write-Host "7) Religando a aplicacao..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 5
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 15
        Write-Host "   Aplicacao respondendo: $($resp.Content)" -ForegroundColor Green
    } catch {
        Write-Host "   ATENCAO: /health nao respondeu - confira manualmente." -ForegroundColor Red
    }
    Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if ($sucesso) {
    Write-Host ""
    Write-Host "Deploy de $Ref concluido. Backup pre-deploy: $bak" -ForegroundColor Green
}

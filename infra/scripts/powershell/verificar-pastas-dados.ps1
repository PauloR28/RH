param(
    [string]$AppDir = "C:\Conecta"
)

# Confere se as pastas de dados enviados por usuarios (CVs, evidencias da Monitoria,
# imagens, anexos de e-mail, logs arquivados) estao FORA da pasta da aplicacao.
# O deploy protege data\private e logs, mas o lugar certo desses arquivos e uma
# pasta propria (ex.: D:\ConectaDados), incluida no backup. Apenas avisa; nunca
# interrompe o deploy.

$ErrorActionPreference = "Continue"

$envFile = Join-Path $AppDir ".env"
$variaveis = @(
    @{ Nome = "RH_PUBLIC_CV_UPLOAD_DIR"; Padrao = "data\private\public-cvs" },
    @{ Nome = "RH_TRAINING_UPLOAD_DIR"; Padrao = "data\private\training-uploads" },
    @{ Nome = "RH_EMAIL_INBOX_ATTACHMENTS_DIR"; Padrao = "data\private\email_attachments" },
    @{ Nome = "RH_LOG_ARCHIVE_DIR"; Padrao = "data\private\log-archive" }
)

$valores = @{}
if (Test-Path $envFile) {
    foreach ($linha in Get-Content $envFile) {
        if ($linha -match "^\s*([A-Z0-9_]+)\s*=\s*(.*)$") {
            $valores[$matches[1]] = $matches[2].Trim().Trim('"')
        }
    }
}

$appDirCompleto = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\') + '\'
$avisos = 0
foreach ($v in $variaveis) {
    $valor = $valores[$v.Nome]
    if (-not $valor) { $valor = $v.Padrao }
    if (-not [System.IO.Path]::IsPathRooted($valor)) { $valor = Join-Path $AppDir $valor }
    $completo = [System.IO.Path]::GetFullPath($valor)
    if ($completo.StartsWith($appDirCompleto, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "ATENCAO - $($v.Nome) aponta para dentro da aplicacao ($completo). Mova para uma pasta de dados propria (ver infra\BACKUP.md)." -ForegroundColor Yellow
        $avisos++
    }
}

if ($avisos -eq 0) {
    Write-Host "OK - pastas de dados fora da pasta da aplicacao." -ForegroundColor Green
}
exit 0

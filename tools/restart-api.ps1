# Rebuilds the API, restarts it quietly and runs the smoke test.
#   powershell -ExecutionPolicy Bypass -File tools/restart-api.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root 'apps\api'

Push-Location $api
npx nest build
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location

Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$env:DB_POOL_MAX = '6'
Start-Process -FilePath 'node' -ArgumentList 'dist/main.js' `
  -RedirectStandardOutput "$env:TEMP\wasel-api.log" `
  -RedirectStandardError "$env:TEMP\wasel-api.err" `
  -WorkingDirectory $api
Start-Sleep -Seconds 6
Write-Output '[api] restarted on http://localhost:4000/api'

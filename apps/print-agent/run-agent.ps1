# WaselERP Print Agent - supervised launcher used by the scheduled task.
# Loads agent.env, then keeps node server.js alive (restarts after a crash).
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$envFile = Join-Path $PSScriptRoot 'agent.env'
if (Test-Path $envFile) {
  Get-Content $envFile -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"', "'"), 'Process')
    }
  }
}

$log = Join-Path $PSScriptRoot 'agent.log'
while ($true) {
  "[$(Get-Date -Format s)] starting print agent" | Out-File -FilePath $log -Append -Encoding UTF8
  & node server.js *>> $log
  "[$(Get-Date -Format s)] agent exited with code $LASTEXITCODE; restarting in 5s" | Out-File -FilePath $log -Append -Encoding UTF8
  Start-Sleep -Seconds 5
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $projectRoot 'server\.cache\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'Pulsebox is not running.'; exit 0 }
$serverPid = [int](Get-Content -LiteralPath $pidFile)
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) { Stop-Process -Id $serverPid; Write-Host 'Pulsebox stopped.' }
Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue


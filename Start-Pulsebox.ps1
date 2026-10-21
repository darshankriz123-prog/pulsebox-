param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
)
$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
if ($pythonCommand) { $pythonCandidates = @($pythonCommand.Source) + $pythonCandidates }
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) { $pythonCandidates = @($pythonCommand.Source) + $pythonCandidates }
$pythonExe = $null
foreach ($candidate in $pythonCandidates) {
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  try { & $candidate -c 'import sys; assert sys.version_info >= (3, 10)' 2>$null; if ($LASTEXITCODE -eq 0) { $pythonExe = $candidate; break } } catch {}
}
if (-not $pythonExe) { throw 'Python 3.10 or newer is required to run the local YouTube service.' }

$deps = Join-Path $projectRoot 'server\.deps'
$wheel = Join-Path $projectRoot 'server\yt_dlp-2026.8.19-py3-none-any.whl'
if (-not (Test-Path -LiteralPath (Join-Path $deps 'yt_dlp'))) {
  if (-not (Test-Path -LiteralPath $wheel)) {
    Invoke-WebRequest -Uri 'https://files.pythonhosted.org/packages/69/b2/8cd1613f56eed7ceb64fbd4df3f1c01246bfb098e6f398228bafda22b80b/yt_dlp-2026.8.19-py3-none-any.whl' -OutFile $wheel
  }
  New-Item -ItemType Directory -Force -Path $deps | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($wheel, $deps)
}
$env:PYTHONPATH = $deps
$url = 'http://127.0.0.1:4173/'
try { $existing = Invoke-WebRequest -Uri ($url + 'health') -UseBasicParsing -TimeoutSec 2; if ($existing.StatusCode -eq 200) { if (-not $NoBrowser) { Start-Process $url }; Write-Host "Pulsebox is already running at $url"; exit 0 } } catch {}
$serverScript = Join-Path $projectRoot 'server\convert.py'
$server = Start-Process -FilePath $pythonExe -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$cache = Join-Path $projectRoot 'server\.cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$pidFile = Join-Path $projectRoot 'server\.cache\server.pid'
Set-Content -LiteralPath $pidFile -Value $server.Id
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 200
  try { $health = Invoke-WebRequest -Uri ($url + 'health') -UseBasicParsing -TimeoutSec 1; if ($health.StatusCode -eq 200) { if (-not $NoBrowser) { Start-Process $url }; Write-Host "Pulsebox is running at $url"; exit 0 } } catch {}
}
throw 'Pulsebox did not start. Check that port 4173 is available.'


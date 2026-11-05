# One-click launcher for the staff computer. Does first-time setup, then runs the assistant for the whole
# airport network and restarts it automatically if it ever crashes. Does NOT download any AI model.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "`n  Node.js is not installed. Install the LTS version from https://nodejs.org, then double-click this again." -ForegroundColor Yellow
  exit 1
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Write-Host "`n  Node.js $(node -v) is too old. Install the current LTS from https://nodejs.org." -ForegroundColor Yellow; exit 1 }

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host "`n  First start: installing (needs internet, one time only)..." -ForegroundColor Cyan
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host '  Install failed. Check the internet connection and try again.' -ForegroundColor Red; exit 1 }
}

if (-not (Test-Path (Join-Path $root 'data\tls.pfx'))) {
  Write-Host "`n  First start: creating the secure (HTTPS) certificate so tablets can use the microphone..." -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'make-cert.ps1')
  Write-Host "`n  >> Install data\airport-assistant-ca.crt ONCE on each tablet/kiosk (see SETUP-FOR-STAFF.md)." -ForegroundColor Yellow
}

# Keep the PC awake while it runs (sleep would disconnect every tablet).
try { powercfg /change standby-timeout-ac 0 | Out-Null } catch {}

while ($true) {
  node --disable-warning=ExperimentalWarning server/index.js --lan
  Write-Host "`n  The assistant stopped (exit code $LASTEXITCODE). Restarting in 5 seconds - close this window to stop it." -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}

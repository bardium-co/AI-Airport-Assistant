# Copies the database (requests, accounts, settings) to a backup folder, e.g. a USB stick or shared drive.
#   Backup:   tools\backup.ps1 -To E:\assistant-backup
#   Restore:  tools\backup.ps1 -To E:\assistant-backup -Restore      (stop the assistant first)
# Use this to hand the system to another computer: back up, install the app there, restore.
param([Parameter(Mandatory)][string]$To, [switch]$Restore)
$ErrorActionPreference = 'Stop'
$data = Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
$files = 'airport-assistant.db', 'airport-assistant.db-wal', 'airport-assistant.db-shm', '.app-secret'
if ($Restore) {
  if (Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.CommandLine -like '*server/index.js*' }) { Write-Warning 'Stop the assistant before restoring.' }
  foreach ($f in $files) { $s = Join-Path $To $f; if (Test-Path $s) { Copy-Item $s $data -Force; "restored $f" } }
} else {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  foreach ($f in $files) { $s = Join-Path $data $f; if (Test-Path $s) { Copy-Item $s $To -Force; "saved $f" } }
  Copy-Item (Join-Path $data 'airport-assistant-ca.crt') $To -Force -ErrorAction SilentlyContinue
}

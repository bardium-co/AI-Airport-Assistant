# Makes the assistant start by itself whenever someone signs in to this Windows PC (so shift changes
# and reboots do not take it down).   Install:  tools\autostart.ps1      Remove:  tools\autostart.ps1 -Remove
param([switch]$Remove)
$name = 'AI Airport Assistant'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue; 'Removed.'; return }
$bat = Join-Path (Split-Path $PSScriptRoot -Parent) 'Start-Airport-Assistant.bat'
$action = New-ScheduledTaskAction -Execute $bat -WorkingDirectory (Split-Path $bat)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
'Installed: the assistant will start at every sign-in on this PC.'

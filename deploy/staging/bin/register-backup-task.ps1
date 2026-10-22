# Registers (or replaces) the per-user scheduled task "DS-Staging-Backup-Pull": at every logon and daily at 12:00 (runs late if the PC was off).
# No admin rights needed; runs only while you are logged in. Remove with: Unregister-ScheduledTask -TaskName DS-Staging-Backup-Pull -Confirm:$false
$script = Join-Path $PSScriptRoot 'pull-backups.ps1'
if (-not (Test-Path $script)) { throw "missing $script" }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME), (New-ScheduledTaskTrigger -Daily -At 12:00))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'DS-Staging-Backup-Pull' -Action $action -Trigger $triggers -Settings $settings -Description 'Copies DS staging DB dumps from the VPS to a private local folder' -Force | Out-Null
Get-ScheduledTask -TaskName 'DS-Staging-Backup-Pull' | Select-Object TaskName, State | Format-Table -AutoSize

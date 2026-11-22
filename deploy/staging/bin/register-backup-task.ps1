# Registers (or replaces) the per-user scheduled task "DS-<Environment>-Backup-Pull": at every logon and daily at 12:00 (runs late if the PC was off).
# No admin rights needed; runs only while you are logged in.
#   register-backup-task.ps1                          staging  (task DS-Staging-Backup-Pull, the existing one)
#   register-backup-task.ps1 -Environment production  production (task DS-Production-Backup-Pull): newest dump only, last 3 days kept
# Remove with: Unregister-ScheduledTask -TaskName DS-Production-Backup-Pull -Confirm:$false
param([ValidateSet('staging', 'production')][string]$Environment = 'staging')
$script = Join-Path $PSScriptRoot 'pull-backups.ps1'
if (-not (Test-Path $script)) { throw "missing $script" }
$title = (Get-Culture).TextInfo.ToTitleCase($Environment)
$name = "DS-$title-Backup-Pull"
$extra = if ($Environment -eq 'production') { ' -NewestOnly -KeepDays 3' } else { '' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Environment $Environment$extra"
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME), (New-ScheduledTaskTrigger -Daily -At 12:00))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 60)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Description "Copies DS $Environment DB dumps from the VPS to a private local folder" -Force | Out-Null
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State | Format-Table -AutoSize

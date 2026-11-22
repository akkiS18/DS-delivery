# Workstation (Windows) job: copies new database dumps (and receipt-photo archives) of ONE environment from the VPS into a private local folder, verifies each
# SHA-256, keeps the newest 30. Registered as a scheduled task by deploy/staging/bin/register-backup-task.ps1 (-Environment staging|production).
# Uses the dedicated deploy key through the `ds-staging` ssh alias (strict host key checking stays on). Dumps contain customer phone numbers/addresses:
# the target folder is private (ACL: current user only), outside Git and outside every source ZIP. Log: <target>\pull.log.
# The Gmail token archive is deliberately NOT pulled (it stays on the server and, encrypted, in the offsite copy).
param(
  [ValidateSet('staging', 'production')][string]$Environment = 'staging',
  [string]$Target = '',
  [string]$Remote = 'ds-staging',
  [int]$Keep = 30,
  # Owner 2026-11-22 (production): copy only the newest dump + receipt archive each run (the VPS makes one every hour; copying all of them
  # over the slow link takes hours) and keep only what is younger than KeepDays (the newest file is always kept).
  [switch]$NewestOnly,
  [int]$KeepDays = 0
)
$ErrorActionPreference = 'Stop'
$cfg = if ($Environment -eq 'production') { @{ Root = '/opt/ds-prod'; Prefix = 'ds_prod'; Folder = '_private-db-production' } } else { @{ Root = '/opt/ds-staging'; Prefix = 'ds_delivery_test'; Folder = '_private-db-staging' } }
if (-not $Target) { $Target = Join-Path $env:USERPROFILE ('Documents\DS-backups\' + $cfg.Folder) }
$dir = "$($cfg.Root)/backups/db"
$ssh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$scp = Join-Path $env:SystemRoot 'System32\OpenSSH\scp.exe'
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$log = Join-Path $Target 'pull.log'
function Log($m) { Add-Content -Path $log -Value ("{0:u} {1}" -f (Get-Date), $m) }
$okName = '^(' + $cfg.Prefix + '-[0-9TZ]+-[A-Za-z0-9._-]+[.]dump|receipts-[0-9TZ]+-[A-Za-z0-9._-]+[.]tar)$'
try {
  $names = & $ssh -o BatchMode=yes -o ConnectTimeout=20 $Remote "ls -1t $dir/*.dump $dir/receipts-*.tar 2>/dev/null | xargs -n1 basename" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ssh failed: $names" }
  $copied = 0
  $wanted = @($names | Where-Object { $_ -match $okName })
  if ($NewestOnly) { $wanted = @(($wanted | Where-Object { $_ -like '*.dump' } | Select-Object -First 1), ($wanted | Where-Object { $_ -like 'receipts-*' } | Select-Object -First 1)) | Where-Object { $_ } }
  foreach ($n in $wanted) {
    $local = Join-Path $Target $n
    # Complete only with its checksum file: a copy cut off half-way (PC asleep, task time limit) is fetched again.
    if ((Test-Path $local) -and (Test-Path "$local.sha256")) { continue }
    & $scp -q -o BatchMode=yes "${Remote}:$dir/$n" "${Remote}:$dir/$n.sha256" $Target 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "scp failed for $n" }
    $want = ((Get-Content "$local.sha256" -Raw).Trim() -split '\s+')[0].ToLower()
    $have = (Get-FileHash $local -Algorithm SHA256).Hash.ToLower()
    if ($want -ne $have) { Remove-Item $local, "$local.sha256" -Force; throw "checksum mismatch for $n (deleted)" }
    $copied++; Log "copied $n"
  }
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  foreach ($pattern in '*.dump', 'receipts-*.tar') { Get-ChildItem $Target -Filter $pattern | Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 | Where-Object { if ($KeepDays -gt 0) { $_.LastWriteTime -lt $cutoff } else { $true } } | Select-Object -Skip $(if ($KeepDays -gt 0) { 0 } else { $Keep - 1 }) | ForEach-Object { Remove-Item $_.FullName, "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue; Log "pruned $($_.Name)" } }
  Log "ok ($Environment): $copied new, $((Get-ChildItem $Target -Filter '*.dump').Count) dumps and $((Get-ChildItem $Target -Filter 'receipts-*.tar').Count) receipt archives kept"
} catch { Log "FAILED: $($_.Exception.Message)"; exit 1 }

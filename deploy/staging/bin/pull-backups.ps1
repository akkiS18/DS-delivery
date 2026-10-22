# Workstation (Windows) job: copies new staging database dumps from the VPS into a private local folder, verifies each SHA-256, keeps the newest 30.
# Registered as a scheduled task by deploy/staging/bin/register-backup-task.ps1. Uses the dedicated deploy key through the `ds-staging` ssh alias
# (strict host key checking stays on). Dumps contain customer phone numbers/addresses: the target folder is private (ACL: current user only),
# outside Git and outside every source ZIP. Log: <target>\pull.log.
param(
  [string]$Target = (Join-Path $env:USERPROFILE 'Documents\DS-backups\_private-db-staging'),
  [string]$Remote = 'ds-staging',
  [int]$Keep = 30
)
$ErrorActionPreference = 'Stop'
$ssh = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$scp = Join-Path $env:SystemRoot 'System32\OpenSSH\scp.exe'
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$log = Join-Path $Target 'pull.log'
function Log($m) { Add-Content -Path $log -Value ("{0:u} {1}" -f (Get-Date), $m) }
try {
  $names = & $ssh -o BatchMode=yes -o ConnectTimeout=20 $Remote 'ls -1t /opt/ds-staging/backups/db/*.dump /opt/ds-staging/backups/db/receipts-*.tar 2>/dev/null | xargs -n1 basename' 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ssh failed: $names" }
  $copied = 0
  foreach ($n in @($names | Where-Object { $_ -match '^(ds_delivery_test-[0-9TZ]+-[A-Za-z0-9._-]+\.dump|receipts-[0-9TZ]+-[A-Za-z0-9._-]+\.tar)$' })) {
    $local = Join-Path $Target $n
    if (Test-Path $local) { continue }
    & $scp -q -o BatchMode=yes "${Remote}:/opt/ds-staging/backups/db/$n" "${Remote}:/opt/ds-staging/backups/db/$n.sha256" $Target 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "scp failed for $n" }
    $want = ((Get-Content "$local.sha256" -Raw).Trim() -split '\s+')[0].ToLower()
    $have = (Get-FileHash $local -Algorithm SHA256).Hash.ToLower()
    if ($want -ne $have) { Remove-Item $local, "$local.sha256" -Force; throw "checksum mismatch for $n (deleted)" }
    $copied++; Log "copied $n"
  }
  foreach ($pattern in '*.dump', 'receipts-*.tar') { Get-ChildItem $Target -Filter $pattern | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | ForEach-Object { Remove-Item $_.FullName, "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue; Log "pruned $($_.Name)" } }
  Log "ok: $copied new, $((Get-ChildItem $Target -Filter '*.dump').Count) dumps and $((Get-ChildItem $Target -Filter 'receipts-*.tar').Count) receipt archives kept"
} catch { Log "FAILED: $($_.Exception.Message)"; exit 1 }

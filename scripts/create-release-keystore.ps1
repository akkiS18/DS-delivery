<#
Creates the Android release signing keystore ONCE (Stage 8C). Run it yourself in PowerShell; the password is typed at a hidden prompt, passed to keytool
through an environment variable (never on the command line) and never printed or written anywhere.

  powershell -ExecutionPolicy Bypass -File scripts\create-release-keystore.ps1

LOSING THIS FILE OR ITS PASSWORD MEANS NO MORE UPDATES FOR THE INSTALLED APPS (Android refuses an update signed with a different key).
Keep two copies in two safe places (for example an encrypted USB drive and a password manager attachment). Never put it in Git, a chat or a shared folder.
One keystore signs both apps.
#>
param(
  [string]$Out = (Join-Path $env:USERPROFILE 'DS-secrets\ds-release.jks'),
  [string]$Alias = 'ds-release',
  [string]$Owner = 'DS Delivery'
)
$ErrorActionPreference = 'Stop'
$keytool = Join-Path $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Android\Android Studio\jbr' }) 'bin\keytool.exe'
if (-not (Test-Path $keytool)) { throw "keytool not found at $keytool (set JAVA_HOME to a JDK)." }
if (Test-Path $Out) { throw "$Out already exists. Refusing to overwrite a signing key." }
if ($Owner -notmatch '^[A-Za-z0-9 .,_-]{2,60}$') { throw 'Owner name: letters, digits, space . , _ - only.' }

function Read-Secret([string]$label) {
  $s = Read-Host -AsSecureString $label
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
$p1 = Read-Secret 'New keystore password (at least 12 characters)'
if ($p1.Length -lt 12) { throw 'Password too short.' }
if ($p1 -ne (Read-Secret 'Repeat the password')) { throw 'Passwords differ.' }

$dir = Split-Path $Out
New-Item -ItemType Directory -Force $dir | Out-Null
# owner-only access to the folder
icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null

$env:DS_KS_PASS = $p1
try {
  & $keytool -genkeypair -keystore $Out -alias $Alias -keyalg RSA -keysize 4096 -validity 9125 `
    -dname "CN=$Owner, C=UZ" -storepass:env DS_KS_PASS -keypass:env DS_KS_PASS
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed.' }
} finally { Remove-Item Env:DS_KS_PASS -ErrorAction SilentlyContinue; $p1 = $null }

Write-Host "`nCreated $Out (alias: $Alias)."
Write-Host 'NOW: copy it to a second safe place and store the password separately. Tell nobody the password, including the assistant.'

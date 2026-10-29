<#
Builds the signed RELEASE APKs of both apps for a production HTTPS API (Stage 8C). Run it yourself; the keystore password is typed at a hidden
prompt and lives only in this process's environment while Gradle runs.

  powershell -ExecutionPolicy Bypass -File scripts\build-release-apks.ps1 -ApiUrl https://api.example.uz -VersionCode 1 -VersionName 1.0.0

Output: <OutDir>\ds-customer-release-<versionName>.apk, ds-restaurant-release-<versionName>.apk, ds-taxi-release-<versionName>.apk and
ds-admin-release-<versionName>.apk with SHA-256 files. Add -OnlyAdmin to build just the DS Admin app (no Node / customer web build needed).
Needs Node (customer web build), the Android SDK and a JDK (Android Studio's is found automatically). The keystore comes from
scripts\create-release-keystore.ps1. It does not install anything on a phone and never uses the debug key.
#>
param(
  [Parameter(Mandatory)][string]$ApiUrl,
  [Parameter(Mandatory)][int]$VersionCode,
  [Parameter(Mandatory)][string]$VersionName,
  [string]$Keystore = (Join-Path $env:USERPROFILE 'DS-secrets\ds-release.jks'),
  [string]$Alias = 'ds-release',
  [string]$OutDir = (Join-Path $env:USERPROFILE 'Documents\DS-backups\apk'),
  [switch]$OnlyAdmin
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$ApiUrl = $ApiUrl.TrimEnd('/')
if ($ApiUrl -notmatch '^https://[a-z0-9.-]+(:\d+)?$') { throw 'ApiUrl must be https://host (no path, no trailing slash).' }
if ($VersionName -notmatch '^[0-9A-Za-z.+-]{1,30}$') { throw 'Bad VersionName.' }
if (-not (Test-Path $Keystore)) { throw "Keystore not found: $Keystore (run scripts\create-release-keystore.ps1)." }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'No JDK found (set JAVA_HOME).' }

$s = Read-Host -AsSecureString "Keystore password for $Alias"
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$env:DS_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
$env:DS_KEYSTORE_FILE = (Resolve-Path $Keystore).Path
$env:DS_KEY_ALIAS = $Alias
$env:DS_KEY_PASSWORD = $env:DS_KEYSTORE_PASSWORD
$env:DS_API_BASE_URL = $ApiUrl
$gradle = Join-Path $root 'apps\customer-miniapp\android\gradlew.bat'
try {
  New-Item -ItemType Directory -Force $OutDir | Out-Null

  if (-not $OnlyAdmin) {
    Write-Host '== customer: web build (release mode) + Capacitor sync'
    Push-Location (Join-Path $root 'apps\customer-miniapp')
    try { npm run android:sync:release; if ($LASTEXITCODE -ne 0) { throw 'customer web build failed' } } finally { Pop-Location }
    Write-Host '== customer: signed release APK'
    & $gradle -p (Join-Path $root 'apps\customer-miniapp\android') :app:assembleRelease "-PdsVersionCode=$VersionCode" "-PdsVersionName=$VersionName" --console=plain -q
    if ($LASTEXITCODE -ne 0) { throw 'customer APK build failed' }

    Write-Host '== restaurant: signed release APK'
    & $gradle -p (Join-Path $root 'apps\restaurant-android') :app:assembleRelease "-PdsApiBaseUrl=$ApiUrl/" "-PdsVersionCode=$VersionCode" "-PdsVersionName=$VersionName" --console=plain -q
    if ($LASTEXITCODE -ne 0) { throw 'restaurant APK build failed' }

    Write-Host '== taxi operator: signed release APK'
    & $gradle -p (Join-Path $root 'apps\taxi-android') :app:assembleRelease "-PdsApiBaseUrl=$ApiUrl/" "-PdsVersionCode=$VersionCode" "-PdsVersionName=$VersionName" --console=plain -q
    if ($LASTEXITCODE -ne 0) { throw 'taxi APK build failed' }
  }

  Write-Host '== admin: signed release APK'
  & $gradle -p (Join-Path $root 'apps\admin-android') :app:assembleRelease "-PdsApiBaseUrl=$ApiUrl/" "-PdsVersionCode=$VersionCode" "-PdsVersionName=$VersionName" --console=plain -q
  if ($LASTEXITCODE -ne 0) { throw 'admin APK build failed' }

  $pairs = @(
    @{ From = Join-Path $root 'apps\customer-miniapp\android\app\build\outputs\apk\release\app-release.apk'; To = "ds-customer-release-$VersionName.apk" },
    @{ From = Join-Path $root 'apps\restaurant-android\app\build\outputs\apk\release\app-release.apk'; To = "ds-restaurant-release-$VersionName.apk" },
    @{ From = Join-Path $root 'apps\taxi-android\app\build\outputs\apk\release\app-release.apk'; To = "ds-taxi-release-$VersionName.apk" },
    @{ From = Join-Path $root 'apps\admin-android\app\build\outputs\apk\release\app-release.apk'; To = "ds-admin-release-$VersionName.apk" }
  )
  if ($OnlyAdmin) { $pairs = @($pairs | Where-Object { $_.To -like 'ds-admin-*' }) }
  foreach ($p in $pairs) {
    if (-not (Test-Path $p.From)) { throw "Expected output missing (unsigned build?): $($p.From)" }
    $dest = Join-Path $OutDir $p.To
    Copy-Item $p.From $dest -Force
    $h = (Get-FileHash $dest -Algorithm SHA256).Hash
    "$h  $($p.To)" | Set-Content -Encoding ascii "$dest.sha256"
    Write-Host "OK  $dest`n    SHA-256 $h"
  }
  Write-Host "`nVerify the signature with:  `"$env:ANDROID_HOME\build-tools\<version>\apksigner.bat`" verify --print-certs <apk>"
} finally {
  Remove-Item Env:DS_KEYSTORE_PASSWORD, Env:DS_KEY_PASSWORD, Env:DS_KEYSTORE_FILE, Env:DS_KEY_ALIAS, Env:DS_API_BASE_URL -ErrorAction SilentlyContinue
}

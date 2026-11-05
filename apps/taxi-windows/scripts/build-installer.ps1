<#
.SYNOPSIS
  Builds the DS Taxi installer: dotnet publish (self-contained, win-x64) -> Inno Setup -> dist\DsTaxi-Setup-<version>.exe

.DESCRIPTION
  The installer carries .NET and WPF inside it, so the operator's PC needs no internet and no .NET runtime.
  This PC (the one that BUILDS) needs: .NET 8 SDK, Inno Setup 6.3 or newer, and internet for the first publish
  (NuGet downloads the .NET runtime pack once).

  powershell -ExecutionPolicy Bypass -File apps\taxi-windows\scripts\build-installer.ps1
  powershell -ExecutionPolicy Bypass -File apps\taxi-windows\scripts\build-installer.ps1 -Version 1.0.1
#>
param(
    [string]$Version = "1.0.0",
    [string]$Iscc = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot          # apps\taxi-windows
$project = Join-Path $root "src\DsTaxi.App\DsTaxi.App.csproj"
$publish = Join-Path $root "publish"
$script = Join-Path $root "installer\DsTaxi.iss"
$dist = Join-Path $root "dist"

function Fail($text) { Write-Host "XATO: $text" -ForegroundColor Red; exit 1 }

# ---- tools
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Fail "dotnet topilmadi. O'rnating: winget install Microsoft.DotNet.SDK.8" }
$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match '^8\.' })) { Fail ".NET 8 SDK kerak (hozir: $($sdks -join ', ')). O'rnating: winget install Microsoft.DotNet.SDK.8" }

if (-not $Iscc) {
    $candidates = @(
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    $Iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $Iscc) {
        $cmd = Get-Command iscc -ErrorAction SilentlyContinue
        if ($cmd) { $Iscc = $cmd.Source }
    }
}
if (-not $Iscc -or -not (Test-Path $Iscc)) { Fail "Inno Setup 6 topilmadi. O'rnating: winget install JRSoftware.InnoSetup (yoki -Iscc yo'lini bering)." }

# ---- publish: self-contained, so nothing is downloaded on the operator's PC
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
Write-Host "1/3 dotnet publish (self-contained, win-x64)..." -ForegroundColor Cyan
& dotnet publish $project -c Release -r win-x64 --self-contained true -p:DebugType=none -p:DebugSymbols=false -p:Version=$Version -o $publish
if ($LASTEXITCODE -ne 0) { Fail "dotnet publish xato bilan tugadi (yuqoridagi xabarlarni o'qing)." }

# ---- check that the folder really carries everything
Write-Host "2/3 publish papkasini tekshirish..." -ForegroundColor Cyan
foreach ($f in @("DsTaxi.exe", "DsTaxi.dll", "DsTaxi.runtimeconfig.json", "coreclr.dll", "hostfxr.dll", "PresentationFramework.dll", "Resources\new_order.mp3")) {
    if (-not (Test-Path (Join-Path $publish $f))) { Fail "publish papkasida '$f' yo'q; o'rnatuvchi to'liq bo'lmaydi." }
}
$runtimeConfig = Get-Content (Join-Path $publish "DsTaxi.runtimeconfig.json") -Raw
if ($runtimeConfig -notmatch "includedFrameworks") { Fail "dastur 'self-contained' emas (runtimeconfig.json ichida includedFrameworks yo'q)." }
$sizeMb = [math]::Round(((Get-ChildItem $publish -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "   papka hajmi: $sizeMb MB"

# ---- installer
Write-Host "3/3 Inno Setup..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force $dist | Out-Null
& $Iscc "/DAppVersion=$Version" $script
if ($LASTEXITCODE -ne 0) { Fail "ISCC xato bilan tugadi." }

$setup = Join-Path $dist "DsTaxi-Setup-$Version.exe"
if (-not (Test-Path $setup)) { Fail "o'rnatuvchi fayl hosil bo'lmadi: $setup" }
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
Write-Host ""
Write-Host "TAYYOR: $setup" -ForegroundColor Green
Write-Host ("Hajmi: {0} MB   SHA256: {1}" -f ([math]::Round((Get-Item $setup).Length / 1MB, 1)), $hash)
Write-Host "Eslatma: kod imzolanmagan bo'lsa Windows SmartScreen birinchi ochilishda ogohlantirish chiqarishi mumkin."

# Compiles the pure-Kotlin time and bell code (Order.kt + OrderTime.kt + NewOrderAttention.kt) together with TimeChecks.kt using the Kotlin compiler that Gradle already
# cached, and runs it. No JUnit / no downloads. Usage: powershell -File unit-checks\run.ps1
$ErrorActionPreference = 'Continue'  # compiler warnings go to stderr; failures are detected by exit code
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $here '..\app\src\main\java\com\dsdelivery\restaurant'
$cache = Join-Path $env:USERPROFILE '.gradle\caches'
# Prefer the pristine artifacts in modules-2 (the copies under jars-9 are Gradle-instrumented and do not run outside Gradle).
function Jar($name) { $f = (Get-ChildItem (Join-Path $cache 'modules-2') -Recurse -Filter "$name.jar" -ErrorAction SilentlyContinue | Select-Object -First 1); if (-not $f) { $f = Get-ChildItem $cache -Recurse -Filter "$name.jar" -ErrorAction SilentlyContinue | Select-Object -First 1 }; if (-not $f) { throw "missing $name.jar in the Gradle cache (run an Android build once)" }; $f.FullName }
$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { '' }
if (-not $java -or -not (Test-Path $java)) { $java = 'C:\Program Files\Android\Android Studio\jbr\bin\java.exe' }
$libs = 'kotlin-compiler-embeddable-1.9.23','kotlin-stdlib-1.9.23','kotlin-script-runtime-1.9.23','kotlin-reflect-1.6.10','kotlin-daemon-embeddable-1.9.23','trove4j-1.0.20200330','annotations-13.0','kotlinx-coroutines-core-jvm-1.5.0' | ForEach-Object { Jar $_ }
$out = Join-Path $env:TEMP 'ds-time-checks'
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
& $java -cp ($libs -join ';') org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -cp (Jar 'kotlin-stdlib-1.9.23') -d $out `
  (Join-Path $app 'data\model\Order.kt') (Join-Path $app 'data\model\OrderTime.kt') (Join-Path $app 'data\alarm\NewOrderAttention.kt') (Join-Path $here 'TimeChecks.kt') 2>&1 | Where-Object { $_ -notmatch "warning:" }
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
& $java -cp "$out;$(Jar 'kotlin-stdlib-1.9.23')" com.dsdelivery.restaurant.unitchecks.TimeChecksKt
exit $LASTEXITCODE

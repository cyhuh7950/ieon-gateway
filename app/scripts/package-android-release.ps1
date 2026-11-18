# 이어온 안드로이드 정식 APK 만들기(정식 서명 키 — .local/app-signing). 결과: app/dist/release/ieon-android-<버전>.apk
# 서명 키가 없으면 먼저: node scripts/make-signing-key.mjs (한 번만, 키를 잃으면 같은 앱으로 업데이트 못 함)
$ErrorActionPreference = "Stop"
if (-not (Test-Path (Join-Path $PSScriptRoot "..\..\.local\app-signing\keystore.properties"))) { throw "정식 서명 키가 없습니다. 먼저 node scripts/make-signing-key.mjs 를 실행하세요." }
[array]$java = @($env:JAVA_HOME, "C:\Program Files\Android\Android Studio\jbr") | Where-Object { $_ -and (Test-Path $_) }
[array]$sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk")) | Where-Object { $_ -and (Test-Path $_) }
if (-not $java) { throw "자바(JDK 또는 Android Studio JBR)를 찾을 수 없습니다." }
if (-not $sdk) { throw "Android SDK를 찾을 수 없습니다." }
$env:JAVA_HOME = $java[0]; $env:ANDROID_HOME = $sdk[0]; $env:ANDROID_SDK_ROOT = $sdk[0]
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

Push-Location (Join-Path $PSScriptRoot "..\android")
try { .\gradlew.bat assembleRelease; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }

$ver = (Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json).version
$out = Join-Path $PSScriptRoot "..\dist\release"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$apk = Join-Path $out "ieon-android-$ver.apk"
Copy-Item -Force (Join-Path $PSScriptRoot "..\android\app\build\outputs\apk\release\app-release.apk") $apk
Write-Host "APK: $apk"

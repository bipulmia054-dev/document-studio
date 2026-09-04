$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $workspace 'work/android-tools'
$env:JAVA_HOME = (Get-ChildItem (Join-Path $toolRoot 'msjdk') -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = Join-Path $toolRoot 'sdk'
$env:ANDROID_USER_HOME = Join-Path $workspace 'work/android-user'
$env:GRADLE_USER_HOME = Join-Path $workspace 'work/gradle-user'
$debugKey = Join-Path $workspace 'work/android-debug.keystore'
if (!(Test-Path -LiteralPath $debugKey)) {
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $debugKey -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Document Studio Debug,O=Document Studio,C=BD'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create debug signing key' }
}
& (Join-Path $toolRoot 'gradle/gradle-8.11.1/bin/gradle.bat') -p $PSScriptRoot --no-daemon :app:assembleDebug :app:lintDebug
if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
$output = Join-Path $workspace 'outputs/Document-Studio.apk'
New-Item -ItemType Directory -Force (Split-Path $output -Parent) | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'app/build/outputs/apk/debug/app-debug.apk') -Destination $output
Get-Item -LiteralPath $output

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$sdk = Join-Path $root '.sdk'
$buildTools = Join-Path $sdk 'build-tools\35.0.0'
$platform = Join-Path $sdk 'platforms\android-35\android.jar'
$build = Join-Path $android 'build'
$dist = Join-Path $root 'dist'
$jdk = 'D:\bin'
if (-not (Test-Path (Join-Path $jdk 'jar.exe'))) {
  if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\jar.exe'))) {
    $jdk = Join-Path $env:JAVA_HOME 'bin'
  } else {
    $javac = (Get-Command javac.exe -ErrorAction SilentlyContinue).Source
    if ($javac) { $jdk = Split-Path -Parent $javac }
  }
}

if (-not (Test-Path $platform)) { throw "Android platform not found: $platform" }
if (-not (Test-Path (Join-Path $jdk 'jar.exe'))) { throw "JDK tools not found: $jdk" }

New-Item -ItemType Directory -Force -Path $build, (Join-Path $build 'gen'), (Join-Path $build 'classes'), (Join-Path $build 'dex'), $dist | Out-Null
Get-ChildItem $build -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $build 'gen'), (Join-Path $build 'classes'), (Join-Path $build 'dex') | Out-Null

Write-Host '== integrity =='
node (Join-Path $root 'scripts\make-android-integrity.js')

Write-Host '== aapt2 compile =='
& (Join-Path $buildTools 'aapt2.exe') compile --dir (Join-Path $android 'res') -o (Join-Path $build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '== aapt2 link =='
& (Join-Path $buildTools 'aapt2.exe') link -o (Join-Path $build 'app-unsigned.apk') -I $platform --manifest (Join-Path $android 'AndroidManifest.xml') -R (Join-Path $build 'res.zip') -A (Join-Path $android 'assets') --java (Join-Path $build 'gen') --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '== javac =='
$sources = @()
$sources += Get-ChildItem (Join-Path $android 'java') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
$sources += Get-ChildItem (Join-Path $build 'gen') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
& (Join-Path $jdk 'javac.exe') -encoding UTF-8 -source 11 -target 11 -classpath $platform -d (Join-Path $build 'classes') $sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '== d8 =='
$classes = Get-ChildItem (Join-Path $build 'classes') -Recurse -Filter '*.class' | Select-Object -ExpandProperty FullName
& (Join-Path $buildTools 'd8.bat') --lib $platform --min-api 26 --output (Join-Path $build 'dex') $classes
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '== package dex (7z, forward-slash assets) =='
$seven = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\7zip@1.0.0" -Recurse -Filter '7za.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $seven) { $seven = 'C:\Program Files\7-Zip\7z.exe' }
if (-not (Test-Path $seven)) { throw '7za.exe not found' }
$stage = Join-Path $build 'apk-stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
& $seven x (Join-Path $build 'app-unsigned.apk') "-o$stage" -y | Out-Null
Copy-Item (Join-Path $build 'dex\classes.dex') (Join-Path $stage 'classes.dex') -Force
Push-Location $stage
& $seven a -tzip -mx=0 (Join-Path $build 'app-fixed.apk') '.' | Out-Null
Pop-Location
if ($LASTEXITCODE -ne 0) { throw '7z repack failed' }

Write-Host '== zipalign =='
& (Join-Path $buildTools 'zipalign.exe') -f 4 (Join-Path $build 'app-fixed.apk') (Join-Path $build 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

Write-Host '== keystore =='
$ks = Join-Path $build 'debug.keystore'
if (-not (Test-Path $ks)) {
  & (Join-Path $jdk 'keytool.exe') -genkeypair -keystore $ks -storepass android -alias androiddebugkey -keypass android -dname 'CN=MolvOS Debug,O=MolvOS,C=CN' -keyalg RSA -keysize 2048 -validity 10000
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

Write-Host '== sign =='
$apk = Join-Path $dist 'MolvOS-0.1.0-android.apk'
& (Join-Path $buildTools 'apksigner.bat') sign --ks $ks --ks-pass pass:android --key-pass pass:android --out $apk (Join-Path $build 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Host '== verify =='
& (Join-Path $buildTools 'apksigner.bat') verify --verbose $apk | Select-Object -Last 5
& (Join-Path $buildTools 'aapt2.exe') dump badging $apk | Select-Object -First 4
Write-Host "APK: $apk"

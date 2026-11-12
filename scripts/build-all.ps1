# 构建全部产物（Windows 本机）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/build-all.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Host '== integrity =='
node scripts/make-integrity.js

Write-Host '== Windows portable =='
npx electron-builder --config electron-builder-win.yml --win portable --x64 --publish never

Write-Host '== Linux tar.gz =='
npx electron-builder --linux dir tar.gz --x64 --publish never
node scripts/build-deb.js

Write-Host '== Android APK =='
powershell -NoProfile -ExecutionPolicy Bypass -File android/build-apk.ps1

Write-Host '== checksums =='
$files = Get-ChildItem dist -File | Where-Object { $_.Name -match '^MolvOS-|^molv-os_' }
$lines = foreach ($f in $files) {
  $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
  "$hash  $($f.Name)"
}
$lines | Set-Content dist/SHA256SUMS.txt -Encoding ascii
Write-Host "done: $($files.Count) artifacts"

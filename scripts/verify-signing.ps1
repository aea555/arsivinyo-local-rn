<#
.SYNOPSIS
  Verify a release APK's signing and print the fingerprints you publish.

.DESCRIPTION
  After a release build, this prints:
    - the APK file's SHA-256 (publish next to the download for integrity)
    - the signing certificate's SHA-256 (publish as your app's identity fingerprint)
  and, if it can read your keystore from ~/.gradle/gradle.properties, confirms the
  APK was actually signed with YOUR release key (not the debug key).

  Prefers `apksigner` (handles APK Signature Scheme v2/v3, which keytool -printcert
  can miss); falls back to `keytool -printcert -jarfile`.

  Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts/verify-signing.ps1
  or via npm:              npm run verify:signing

.PARAMETER ApkPath
  Path to the APK. Defaults to the standard release output.
#>
param(
  [string]$ApkPath = "android/app/build/outputs/apk/release/app-release.apk"
)

$ErrorActionPreference = "Stop"

function Normalize-Fingerprint([string]$fp) {
  if (-not $fp) { return $null }
  return ($fp -replace '[:\s]', '').ToLower()
}

function Find-Keytool {
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if ($env:JAVA_HOME) {
    $p = Join-Path $env:JAVA_HOME "bin\keytool.exe"
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Find-Apksigner {
  $roots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk")) |
    Where-Object { $_ -and (Test-Path $_) }
  foreach ($r in $roots) {
    $bt = Join-Path $r "build-tools"
    if (Test-Path $bt) {
      $dirs = Get-ChildItem $bt -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
      foreach ($d in $dirs) {
        $candidate = Join-Path $d.FullName "apksigner.bat"
        if (Test-Path $candidate) { return $candidate }
      }
    }
  }
  return $null
}

function Get-ApkCertFingerprint([string]$apk, [string]$apksigner, [string]$keytool) {
  if ($apksigner) {
    $out = & $apksigner verify --print-certs $apk | Out-String
    if ($LASTEXITCODE -eq 0) {
      $m = [regex]::Match($out, 'SHA-256 digest:\s*([0-9a-fA-F]+)')
      if ($m.Success) { return $m.Groups[1].Value }
    }
  }
  if ($keytool) {
    $out = & $keytool -printcert -jarfile $apk | Out-String
    $m = [regex]::Match($out, 'SHA-?256:\s*([0-9A-Fa-f:]+)')
    if ($m.Success) { return $m.Groups[1].Value }
  }
  return $null
}

# ---- Resolve tools ----
$keytool = Find-Keytool
$apksigner = Find-Apksigner
if (-not $keytool -and -not $apksigner) {
  Write-Error "Neither apksigner nor keytool found. Install a JDK (PATH/JAVA_HOME) and/or set ANDROID_HOME."
}

if (-not (Test-Path $ApkPath)) {
  Write-Error "APK not found at '$ApkPath'. Build first (npx expo run:android --variant release) or pass -ApkPath."
}

Write-Host "=== APK ===" -ForegroundColor Cyan
Write-Host "Path: $ApkPath"

$apkHash = (Get-FileHash -Algorithm SHA256 -Path $ApkPath).Hash.ToLower()
Write-Host "APK file SHA-256 (publish next to the download):"
Write-Host "  $apkHash" -ForegroundColor Green

$apkCert = Get-ApkCertFingerprint $ApkPath $apksigner $keytool
$apkCertNorm = Normalize-Fingerprint $apkCert
if (-not $apkCertNorm) {
  Write-Error "Could not read the APK's signing certificate. Is the APK actually signed?"
}
Write-Host "APK signing cert SHA-256 (publish as your app's fingerprint):"
Write-Host "  $apkCertNorm" -ForegroundColor Green

# ---- Optional keystore comparison ----
$gradleProps = Join-Path $env:USERPROFILE ".gradle\gradle.properties"
$storeFile = $null; $alias = $null
if (Test-Path $gradleProps) {
  foreach ($line in Get-Content $gradleProps) {
    if ($line -match '^\s*AV_UPLOAD_STORE_FILE\s*=\s*(.+?)\s*$') { $storeFile = $Matches[1] }
    if ($line -match '^\s*AV_UPLOAD_KEY_ALIAS\s*=\s*(.+?)\s*$')   { $alias = $Matches[1] }
  }
}

if ($keytool -and $storeFile -and (Test-Path $storeFile) -and $alias) {
  Write-Host ""
  Write-Host "=== Keystore comparison ===" -ForegroundColor Cyan
  Write-Host "Keystore: $storeFile (alias: $alias)"
  $sec = Read-Host "Keystore password (blank to skip)" -AsSecureString
  $plain = (New-Object System.Net.NetworkCredential('', $sec)).Password
  if ($plain) {
    $ksText = & $keytool -list -v -keystore $storeFile -alias $alias -storepass $plain | Out-String
    $exit = $LASTEXITCODE
    $plain = $null
    if ($exit -ne 0) {
      Write-Host "Could not open keystore (wrong password or bad alias)." -ForegroundColor Yellow
      exit 1
    }
    $m = [regex]::Match($ksText, 'SHA-?256:\s*([0-9A-Fa-f:]+)')
    $ksNorm = $null
    if ($m.Success) { $ksNorm = Normalize-Fingerprint $m.Groups[1].Value }
    if ($ksNorm) {
      Write-Host "Keystore cert SHA-256:"
      Write-Host "  $ksNorm"
      if ($ksNorm -eq $apkCertNorm) {
        Write-Host "MATCH - the APK is signed with your release key." -ForegroundColor Green
      } else {
        Write-Host "MISMATCH - the APK was NOT signed with this keystore!" -ForegroundColor Red
        exit 1
      }
    } else {
      Write-Host "Could not parse keystore fingerprint." -ForegroundColor Yellow
    }
  } else {
    Write-Host "Skipped keystore comparison." -ForegroundColor Yellow
  }
} else {
  Write-Host ""
  Write-Host "Keystore not configured in $gradleProps (AV_UPLOAD_STORE_FILE / AV_UPLOAD_KEY_ALIAS) - skipping comparison." -ForegroundColor Yellow
}

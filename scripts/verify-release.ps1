param([Parameter(Mandatory=$true)][string]$Apk)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$contract = Get-Content (Join-Path $projectRoot 'release-contract.json') -Raw | ConvertFrom-Json
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$tools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (!$env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr' }
$certificate = & (Join-Path $tools.FullName 'apksigner.bat') verify --print-certs $Apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature is invalid.' }
$fingerprint = [regex]::Match(($certificate -join "`n"), 'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)').Groups[1].Value
if ($fingerprint.ToLowerInvariant() -ne $contract.releaseCertificateSHA256.ToLowerInvariant()) { throw 'APK release signing identity changed. Do not publish this APK as an update.' }
$badging = & (Join-Path $tools.FullName 'aapt.exe') dump badging $Apk
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect APK identity.' }
if (!(($badging -join "`n").Contains("name='$($contract.applicationId)'"))) { throw 'APK application id changed; existing private databases would not be reused.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk))
try {
  $entry = $archive.GetEntry('assets/capacitor.config.json')
  if (!$entry) { throw 'APK Capacitor config is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $config = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  $scheme = if ($config.server.androidScheme) { $config.server.androidScheme } else { 'https' }
  $hostname = if ($config.server.hostname) { $config.server.hostname } else { 'localhost' }
  if ("${scheme}://${hostname}" -ne $contract.androidOrigin -or $config.server.url) { throw 'APK WebView storage origin changed; existing IndexedDB would not be accessible.' }
} finally { $archive.Dispose() }
Write-Output 'PASS release identity: signature, application id, and IndexedDB origin match published contract.'

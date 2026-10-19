param([string]$Apk, [string]$LegacyKeystore = (Join-Path $env:USERPROFILE '.android/debug.keystore'))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (!$Apk) { $Apk = Join-Path $projectRoot "dist/FieldMapper-$version-Android.apk" }
& (Join-Path $PSScriptRoot 'verify-release.ps1') -Apk $Apk
$contract = Get-Content (Join-Path $projectRoot 'release-contract.json') -Raw | ConvertFrom-Json
$signingHome = Join-Path $env:LOCALAPPDATA 'FieldMapperBuild/signing'
$signing = Get-Content (Join-Path $signingHome 'release.json') -Raw | ConvertFrom-Json
if (!$env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr' }
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$tools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$apksigner = Join-Path $tools.FullName 'apksigner.bat'
$oldReleasePassword = $env:FIELDMAPPER_MIGRATION_RELEASE_PASSWORD
$oldDebugPassword = $env:FIELDMAPPER_MIGRATION_DEBUG_PASSWORD
try {
  $env:FIELDMAPPER_MIGRATION_RELEASE_PASSWORD = $signing.password
  $env:FIELDMAPPER_MIGRATION_DEBUG_PASSWORD = 'android'
  $legacyInfo = & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') '-J-Duser.language=en' -list -v -keystore $LegacyKeystore -alias androiddebugkey -storepass:env FIELDMAPPER_MIGRATION_DEBUG_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the legacy key. Do not generate a replacement.' }
  $fingerprint = [regex]::Match(($legacyInfo -join "`n"), 'SHA256:\s*([A-Fa-f0-9:]+)').Groups[1].Value.Replace(':','').ToLowerInvariant()
  if ($fingerprint -ne $contract.legacyDebugCertificateSHA256) { throw 'Legacy signing key does not match the early PC-built app. Migration would fail.' }
  $lineage = Join-Path $signingHome 'legacy-debug-to-release-permissions.lineage'
  # Installed-data and signature-permission continuity are both required by AndroidX.
  # Do not allow the old debug key to take back ownership of the released app.
  & $apksigner rotate --out $lineage --old-signer --ks $LegacyKeystore --ks-key-alias androiddebugkey --ks-pass env:FIELDMAPPER_MIGRATION_DEBUG_PASSWORD --set-installed-data true --set-shared-uid false --set-permission true --set-rollback false --set-auth false --new-signer --ks $signing.storeFile --ks-key-alias $signing.alias --ks-pass env:FIELDMAPPER_MIGRATION_RELEASE_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Signing transition proof creation failed.' }
  $output = Join-Path $projectRoot "dist/FieldMapper-$version-Android-Migration.apk"
  # A separate V3-only bridge: leave the normal V2 release APK unchanged for existing users.
  # V3 requires Android 9+; this recovery procedure is supported/tested on Android 13+.
  & $apksigner sign --ks $signing.storeFile --ks-key-alias $signing.alias --ks-pass env:FIELDMAPPER_MIGRATION_RELEASE_PASSWORD --lineage $lineage --min-sdk-version 28 --rotation-min-sdk-version 28 --v1-signing-enabled false --v2-signing-enabled false --v3-signing-enabled true --v4-signing-enabled false --out $output $Apk
  if ($LASTEXITCODE -ne 0) { throw 'Migration APK signing failed.' }
  $verified = & $apksigner verify --min-sdk-version 28 --verbose --print-certs $output
  if ($LASTEXITCODE -ne 0) { throw 'Migration APK verification failed.' }
  $newFingerprint = [regex]::Match(($verified -join "`n"), 'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)').Groups[1].Value.ToLowerInvariant()
  if ($newFingerprint -ne $contract.releaseCertificateSHA256) { throw 'Migration APK does not use the established release certificate.' }
  $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $([IO.Path]::GetFileName($output))" | Set-Content -LiteralPath (Join-Path $projectRoot "dist/FieldMapper-$version-Android-Migration-SHA256.txt")
  Write-Output "Verified one-time migration APK (Android 13+ recovery): $output"
  Write-Output 'No private keys are included. Never use this bridge for apps signed by an unrelated debug key.'
} finally {
  $env:FIELDMAPPER_MIGRATION_RELEASE_PASSWORD = $oldReleasePassword
  $env:FIELDMAPPER_MIGRATION_DEBUG_PASSWORD = $oldDebugPassword
}

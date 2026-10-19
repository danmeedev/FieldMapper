$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (!$env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr' }
$keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
if (!(Test-Path -LiteralPath $keytool)) { throw 'Set JAVA_HOME to a Java 21 JDK before building.' }
$signingHome = Join-Path $env:LOCALAPPDATA 'FieldMapperBuild/signing'
New-Item -ItemType Directory -Path $signingHome -Force | Out-Null
$signingFile = Join-Path $signingHome 'release.json'
$newSigningIdentity = !(Test-Path -LiteralPath $signingFile)
$releaseContract = Get-Content (Join-Path $projectRoot 'release-contract.json') -Raw | ConvertFrom-Json
if ($newSigningIdentity -and $releaseContract.releaseCertificateSHA256) { throw 'This project already has a release identity. Restore the existing signing directory on this machine or CI runner; generating a new key would break Android updates.' }
if (Test-Path -LiteralPath $signingFile) {
  $signing = Get-Content -LiteralPath $signingFile -Raw | ConvertFrom-Json
} else {
  $randomBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
  $signing = @{ storeFile = (Join-Path $signingHome 'field-mapper-release.p12'); password = [Convert]::ToBase64String($randomBytes); alias = 'fieldmapper' }
  $signing | ConvertTo-Json | Set-Content -LiteralPath $signingFile
}
$names = @('FIELDMAPPER_KEYSTORE','FIELDMAPPER_STORE_PASSWORD','FIELDMAPPER_KEY_ALIAS','FIELDMAPPER_KEY_PASSWORD')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $env:FIELDMAPPER_KEYSTORE = $signing.storeFile
  $env:FIELDMAPPER_STORE_PASSWORD = $signing.password
  $env:FIELDMAPPER_KEY_ALIAS = $signing.alias
  $env:FIELDMAPPER_KEY_PASSWORD = $signing.password
  if (!(Test-Path -LiteralPath $signing.storeFile) -and !$newSigningIdentity) { throw 'Existing release signing key is missing. Restore the private signing backup; do not silently replace its identity.' }
  if (!(Test-Path -LiteralPath $signing.storeFile)) {
    & $keytool -genkeypair -keystore $signing.storeFile -storetype PKCS12 -alias $signing.alias -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Field Mapper, OU=Local Distribution, O=Field Mapper, C=US' -storepass:env FIELDMAPPER_STORE_PASSWORD -keypass:env FIELDMAPPER_KEY_PASSWORD -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'Release signing key creation failed.' }
  }
  Push-Location (Join-Path $projectRoot 'mobile-app')
  try { & npm.cmd run sync -- android; if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' } } finally { Pop-Location }
  Push-Location (Join-Path $projectRoot 'mobile-app/android')
  try { & .\gradlew.bat assembleRelease --console=plain; if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' } } finally { Pop-Location }
  $apk = Join-Path $projectRoot 'mobile-app/android/app/build/outputs/apk/release/app-release.apk'
  if (!(Test-Path -LiteralPath $apk)) { throw 'Signed release APK was not produced.' }
  $sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
  $apksigner = Get-ChildItem (Join-Path $sdkRoot 'build-tools') -Filter apksigner.bat -Recurse | Sort-Object FullName -Descending | Select-Object -First 1
  if (!$apksigner) { throw 'Android SDK apksigner was not found.' }
  & $apksigner.FullName verify --verbose --print-certs $apk
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  & (Join-Path $PSScriptRoot 'verify-release.ps1') -Apk $apk
  Write-Output "Signed APK ready: $apk"
  Write-Output "Back up release signing files privately: $signingHome"
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}

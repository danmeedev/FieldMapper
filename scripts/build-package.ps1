param([switch]$SkipAndroidBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  & npm.cmd run check:distribution
  if ($LASTEXITCODE -ne 0) { throw 'Distribution document check failed.' }
  & npm.cmd run check:privacy
  if ($LASTEXITCODE -ne 0) { throw 'Repository privacy check failed. Do not publish this build.' }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Persistence/regression checks failed. Do not distribute this build.' }
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  foreach ($configPath in @('public/update-config.json','mobile-app/src/update-config.json')) {
    $updateConfig = Get-Content -LiteralPath (Join-Path $projectRoot $configPath) -Raw | ConvertFrom-Json
    if ($updateConfig.currentVersion -ne $version) { throw "Update checker version mismatch in $configPath" }
  }
  $cache = Join-Path $projectRoot '.build-cache'
  $output = Join-Path $projectRoot 'dist'
  New-Item -ItemType Directory -Path $cache,$output -Force | Out-Null
  if (!$SkipAndroidBuild) { & (Join-Path $PSScriptRoot 'build-android-release.ps1') }
  $apk = Join-Path $projectRoot 'mobile-app/android/app/build/outputs/apk/release/app-release.apk'
  if (!(Test-Path -LiteralPath $apk)) { throw 'Build the signed APK first.' }
  & (Join-Path $PSScriptRoot 'verify-release.ps1') -Apk $apk
  $downloadBase = 'https://nodejs.org/dist/latest-v22.x'
  $sums = (Invoke-WebRequest "$downloadBase/SHASUMS256.txt").Content
  $runtimeMatch = [regex]::Match($sums, '(?m)^([a-f0-9]{64})\s+(node-v22\.[0-9]+\.[0-9]+-win-x64\.zip)\s*$')
  if (!$runtimeMatch.Success) { throw 'Official Node runtime checksum was not found.' }
  $runtimeName = $runtimeMatch.Groups[2].Value
  $archive = Join-Path $cache $runtimeName
  if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest "$downloadBase/$runtimeName" -OutFile $archive }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeMatch.Groups[1].Value) { throw 'Runtime checksum mismatch; remove the cached archive and retry.' }
  $runtimeSource = Join-Path $cache ($runtimeName -replace '\.zip$','')
  if (!(Test-Path -LiteralPath (Join-Path $runtimeSource 'node.exe'))) { Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force }
  $name = "FieldMapper-$version-Windows-Android"
  $stage = Join-Path $output ($name + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $bundle = Join-Path $stage $name
  $pc = Join-Path $bundle 'PC'
  $app = Join-Path $pc 'app'
  $android = Join-Path $bundle 'Android'
  New-Item -ItemType Directory -Path $app,$android,(Join-Path $pc 'runtime') -Force | Out-Null
  foreach ($item in @('server.js','server','public','package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination $app -Recurse }
  foreach ($item in @('node.exe','LICENSE')) { Copy-Item -LiteralPath (Join-Path $runtimeSource $item) -Destination (Join-Path $pc 'runtime') }
  foreach ($item in @('launcher.cjs','Start Field Mapper.cmd','Open My Field Mapper Data.cmd')) { Copy-Item -LiteralPath (Join-Path $projectRoot "packaging/$item") -Destination $pc }
  Push-Location $app
  try { & npm.cmd ci --omit=dev --ignore-scripts; if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' } } finally { Pop-Location }
  Copy-Item -LiteralPath $apk -Destination (Join-Path $android "FieldMapper-$version.apk")
  foreach ($doc in @('README.md','QUICK-SETUP.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot $doc) -Destination $bundle }
  & node (Join-Path $PSScriptRoot 'render-docs.cjs') $bundle
  if ($LASTEXITCODE -ne 0) { throw 'Guide rendering failed.' }
  $runtimeVersion = & (Join-Path $pc 'runtime/node.exe') --version
  @{ appVersion=$version; runtime=$runtimeVersion; runtimeArchive=$runtimeName; runtimeSHA256=$runtimeMatch.Groups[1].Value; architecture='Windows x64'; builtAt=(Get-Date).ToUniversalTime().ToString('o'); privateDataIncluded=$false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bundle 'BUILD-INFO.json')
  $notice = '# Third-party software' + "`n`n" + 'Node.js and its bundled components are covered by PC/runtime/LICENSE. Production dependencies retain their package.json, LICENSE and NOTICE files under PC/app/node_modules. Vendored Leaflet includes PC/app/public/lib/Leaflet-LICENSE.txt. Android assets include THIRD-PARTY-NOTICES.txt and the Leaflet license. Application licensing is unchanged. No user data, provider keys, private certificates, or Android signing keys are included.'
  Set-Content -LiteralPath (Join-Path $bundle 'THIRD-PARTY-NOTICES.md') -Value $notice
  $zip = Join-Path $output "$name.zip"
  Compress-Archive -LiteralPath $bundle -DestinationPath $zip -Force
  $standaloneApk = Join-Path $output "FieldMapper-$version-Android.apk"
  Copy-Item -LiteralPath $apk -Destination $standaloneApk -Force
  @($zip,$standaloneApk) | ForEach-Object { $hash=Get-FileHash -LiteralPath $_ -Algorithm SHA256; "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_))" } | Set-Content -LiteralPath (Join-Path $output "FieldMapper-$version-SHA256SUMS.txt")
  @{ bundle=$bundle; zip=$zip; apk=$standaloneApk; runtime=$runtimeVersion } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'latest-build.json')
  & npm.cmd run test:package
  if ($LASTEXITCODE -ne 0) { throw 'Extracted-package upgrade persistence test failed. Do not distribute this build.' }
  Write-Output "Package ready: $zip"
  Write-Output "Android APK: $standaloneApk"
} finally { Pop-Location }

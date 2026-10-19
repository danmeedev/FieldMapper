param([string]$Device = 'emulator-5554')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDirectory = Join-Path $projectRoot ('.review-logs/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 3000 is already in use. Reuse the current review session or stop its server before starting another.'
}
$node = (Get-Command node.exe).Source
$server = Start-Process -FilePath $node -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'review-server.cjs') + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'pc-server.log') -RedirectStandardError (Join-Path $runDirectory 'pc-server.error.log')
$serverReady = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  try { $status = Invoke-RestMethod 'http://localhost:3000/api/status'; if ($status.ok) { $serverReady = $true; break } } catch {}
  Start-Sleep -Milliseconds 250
}
if (!$serverReady) { throw "Server startup failed. See $runDirectory" }
$browser = Start-Process -FilePath $node -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'review-browser.cjs') + '"'), ('"' + $runDirectory + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'pc-browser-launch.log') -RedirectStandardError (Join-Path $runDirectory 'pc-browser-launch.error.log')
$adb = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
$logcat = Start-Process -FilePath $adb -ArgumentList @('-s',$Device,'logcat','-v','threadtime','GpsTrackingPlugin:V','GpsTrackingService:V','Capacitor:V','Capacitor/Console:V','AndroidRuntime:E','chromium:E','*:S') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'android-logcat.log') -RedirectStandardError (Join-Path $runDirectory 'android-logcat.error.log')
$studio = 'C:/Program Files/Android/Android Studio/bin/studio64.exe'
Start-Process -FilePath $studio -ArgumentList @(('"' + (Join-Path $projectRoot 'mobile-app/android') + '"'))
@{ directory=$runDirectory; serverPid=$server.Id; browserPid=$browser.Id; logcatPid=$logcat.Id; device=$Device; url='http://localhost:3000'; emulatorServerUrl='http://10.0.2.2:3000' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.review-logs/latest-session.json')
Write-Output "PC server and browser running at http://localhost:3000"
Write-Output "Android Studio opened. Emulator laptop URL: http://10.0.2.2:3000"
Write-Output "Review logs: $runDirectory"

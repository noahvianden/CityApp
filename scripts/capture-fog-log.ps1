param(
  [string]$Serial,
  [int]$Seconds = 45
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$fogLogPath = Join-Path $repoRoot.Path 'cityapp-fog-log.txt'
$fullLogPath = Join-Path $repoRoot.Path 'cityapp-full-log.txt'
$packageName = 'com.cityprint.app'
$activityName = 'com.cityprint.app/.MainActivity'
$logPattern = 'atlas-fog|Capacitor/Console|CapacitorHttp|nominatim|maplibre|TypeError|ReferenceError|Error|Exception'

$sdkRoot = $env:ANDROID_SDK_ROOT

if (-not $sdkRoot) {
  $localAppData = $env:LOCALAPPDATA
  if ($localAppData) {
    $candidate = Join-Path $localAppData 'Android\Sdk'
    if (Test-Path $candidate) {
      $sdkRoot = $candidate
    }
  }
}

if (-not $sdkRoot) {
  throw 'Android SDK not found. Set ANDROID_SDK_ROOT or install the Android SDK in the default location.'
}

$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  throw "adb not found at $adb"
}

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & $adb @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-AdbOutput {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $output = & $adb @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }

  return $output
}

Write-Host 'Removing old log files...'
Remove-Item -Path $fogLogPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $fullLogPath -Force -ErrorAction SilentlyContinue

Write-Host 'Checking connected Android devices...'
$deviceList = Get-AdbOutput -Arguments @('devices')
$devices = $deviceList | Select-String '^\S+\s+device$' | ForEach-Object {
  ($_ -split '\s+')[0]
}

if (-not $devices) {
  throw 'No authorized Android device found. Enable USB debugging and reconnect the phone.'
}

$targetSerial = $Serial
if (-not $targetSerial) {
  $targetSerial = $devices | Select-Object -First 1
}

if ($devices -notcontains $targetSerial) {
  throw "Device '$targetSerial' is not connected or not authorized. Connected devices: $($devices -join ', ')"
}

Write-Host "Clearing logcat on $targetSerial..."
Invoke-Adb -Arguments @('-s', $targetSerial, 'logcat', '-c')

Write-Host "Starting $packageName on $targetSerial..."
Invoke-Adb -Arguments @('-s', $targetSerial, 'shell', 'am', 'force-stop', $packageName)
Invoke-Adb -Arguments @('-s', $targetSerial, 'shell', 'am', 'start', '-n', $activityName)

Write-Host "Capturing logs for $Seconds seconds. Use the phone now: wait for the map, move a few times, then wait for this script to finish."
Start-Sleep -Seconds $Seconds

Write-Host "Writing fresh fog log to $fogLogPath..."
$filteredLines = Get-AdbOutput -Arguments @('-s', $targetSerial, 'logcat', '-d', '-v', 'time') |
  Select-String -Pattern $logPattern |
  ForEach-Object { $_.Line }

if ($filteredLines) {
  $filteredLines | Set-Content -Path $fogLogPath -Encoding utf8
} else {
  '' | Set-Content -Path $fogLogPath -Encoding utf8
}

Write-Host "Done. Fog log written: $fogLogPath"

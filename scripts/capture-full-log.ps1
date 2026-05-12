param(
  [string]$Serial,
  [int]$Seconds = 45,
  [switch]$IncludeSystem
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$fullLogPath = Join-Path $repoRoot.Path 'cityapp-full-log.txt'
$packageName = 'com.cityprint.app'
$activityName = 'com.cityprint.app/.MainActivity'

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

$relevantPatterns = @(
  'Capacitor/Console',
  'CapacitorHttp',
  'AndroidRuntime',
  'FATAL EXCEPTION',
  'ANR',
  'atlas-',
  'atlas-ui',
  'atlas-fog',
  'MapLibre',
  'Nominatim',
  'city selection',
  'Unhandled',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'Error:'
)
$relevantRegex = ($relevantPatterns -join '|')

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

function Get-AdbOutputAllowFailure {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $output = & $adb @Arguments
  return $output
}

function Select-RelevantLogLines {
  param([string[]]$Lines)

  if (-not $Lines) {
    return @()
  }

  return $Lines | Where-Object { $_ -match $relevantRegex }
}

Write-Host 'Removing old CityApp log file...'
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

Start-Sleep -Milliseconds 750
$pidOutput = Get-AdbOutputAllowFailure -Arguments @('-s', $targetSerial, 'shell', 'pidof', $packageName)
$targetPid = ($pidOutput | Select-Object -First 1).Trim()

if ($IncludeSystem) {
  Write-Host "Capturing all logcat for $Seconds seconds."
} elseif ($targetPid) {
  Write-Host "Capturing relevant CityApp log lines for $Seconds seconds. PID: $targetPid"
} else {
  Write-Host "Could not resolve CityApp PID. Capturing relevant device log lines for $Seconds seconds."
}

Start-Sleep -Seconds $Seconds

Write-Host "Writing filtered log to $fullLogPath..."
if ($IncludeSystem) {
  $lines = Get-AdbOutput -Arguments @('-s', $targetSerial, 'logcat', '-d', '-v', 'time')
} elseif ($targetPid) {
  $appLines = Get-AdbOutput -Arguments @('-s', $targetSerial, 'logcat', '-d', '-v', 'time', '--pid', $targetPid)
  $lines = Select-RelevantLogLines -Lines $appLines
} else {
  $allLines = Get-AdbOutput -Arguments @('-s', $targetSerial, 'logcat', '-d', '-v', 'time')
  $lines = Select-RelevantLogLines -Lines $allLines
}

if ($lines) {
  $lines | Set-Content -Path $fullLogPath -Encoding utf8
} else {
  'No relevant CityApp log lines captured.' | Set-Content -Path $fullLogPath -Encoding utf8
}

Write-Host "Done. Relevant log written: $fullLogPath"
Write-Host 'Use -IncludeSystem only when you need the complete unfiltered device log.'

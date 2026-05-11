param(
  [string]$Serial,
  [switch]$KeepData
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
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

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & $adb @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Invoke-AdbOptional {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & $adb @Arguments | Out-Host
}

function Invoke-CommandChecked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Host 'Removing generated web and Capacitor assets...'
Remove-Item -Recurse -Force (Join-Path $repoRoot.Path 'dist') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $repoRoot.Path 'android\app\src\main\assets\public') -ErrorAction SilentlyContinue

Write-Host 'Building web assets and syncing Capacitor...'
Invoke-CommandChecked -FilePath 'npm.cmd' -Arguments @('run', 'android:sync') -WorkingDirectory $repoRoot.Path

Write-Host 'Checking connected Android devices...'
$deviceList = & $adb devices
if ($LASTEXITCODE -ne 0) {
  throw 'adb devices failed'
}

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

if (-not $KeepData) {
  Write-Host "Removing old $packageName install and WebView cache from $targetSerial..."
  Invoke-AdbOptional -Arguments @('-s', $targetSerial, 'shell', 'am', 'force-stop', $packageName)
  Invoke-AdbOptional -Arguments @('-s', $targetSerial, 'uninstall', $packageName)
}

Write-Host "Installing debug build on $targetSerial..."
Invoke-CommandChecked -FilePath (Join-Path $repoRoot.Path 'android\gradlew.bat') -Arguments @('clean', 'installDebug') -WorkingDirectory (Join-Path $repoRoot.Path 'android')

if (-not $KeepData) {
  Write-Host "Clearing app data for $packageName on $targetSerial..."
  Invoke-AdbOptional -Arguments @('-s', $targetSerial, 'shell', 'pm', 'clear', $packageName)
}

Write-Host "Starting $packageName on $targetSerial..."
Invoke-Adb -Arguments @('-s', $targetSerial, 'shell', 'am', 'start', '-n', $activityName)

Write-Host "App started on $targetSerial."

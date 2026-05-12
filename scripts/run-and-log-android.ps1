param(
  [Parameter(Position = 0)]
  [ValidateRange(1, 86400)]
  [int]$Seconds = 45,

  [string]$Serial,

  [string]$Output = 'cityapp-android-log.txt',

  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$outputPath = if ([System.IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $repoRoot.Path $Output }
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
  throw 'Android SDK nicht gefunden. Setze ANDROID_SDK_ROOT oder installiere das Android SDK im Standardpfad.'
}

$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  throw "adb nicht gefunden: $adb"
}

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & $adb @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Arguments -join ' ') fehlgeschlagen mit Exit-Code $LASTEXITCODE"
  }
}

function Get-AdbOutput {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $output = & $adb @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Arguments -join ' ') fehlgeschlagen mit Exit-Code $LASTEXITCODE"
  }

  return $output
}

if (-not $NoBuild) {
  Write-Host 'Baue und synchronisiere Android-Projekt...'
  Push-Location $repoRoot
  try {
    npm run android:sync
    if ($LASTEXITCODE -ne 0) {
      throw "npm run android:sync fehlgeschlagen mit Exit-Code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Write-Host 'Pruefe verbundene Android-Geraete...'
$deviceList = Get-AdbOutput -Arguments @('devices')
$devices = $deviceList | Select-String '^\S+\s+device$' | ForEach-Object {
  ($_ -split '\s+')[0]
}

if (-not $devices) {
  throw 'Kein autorisiertes Android-Geraet gefunden. USB-Debugging aktivieren und Geraet erneut verbinden.'
}

$targetSerial = $Serial
if (-not $targetSerial) {
  $targetSerial = $devices | Select-Object -First 1
}

if ($devices -notcontains $targetSerial) {
  throw "Geraet '$targetSerial' ist nicht verbunden oder nicht autorisiert. Verbunden: $($devices -join ', ')"
}

$outputDirectory = Split-Path -Parent $outputPath
if ($outputDirectory -and -not (Test-Path $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

Write-Host "Ueberschreibe Logdatei: $outputPath"
'' | Set-Content -Path $outputPath -Encoding utf8

Write-Host "Leere logcat auf $targetSerial..."
Invoke-Adb -Arguments @('-s', $targetSerial, 'logcat', '-c')

Write-Host "Starte $packageName auf $targetSerial..."
Invoke-Adb -Arguments @('-s', $targetSerial, 'shell', 'am', 'force-stop', $packageName)
Invoke-Adb -Arguments @('-s', $targetSerial, 'shell', 'am', 'start', '-n', $activityName)

Write-Host "Schreibe fuer $Seconds Sekunden nach $outputPath..."
$logcat = Start-Process `
  -FilePath $adb `
  -ArgumentList @('-s', $targetSerial, 'logcat', '-v', 'time') `
  -RedirectStandardOutput $outputPath `
  -RedirectStandardError $outputPath `
  -NoNewWindow `
  -PassThru

try {
  Start-Sleep -Seconds $Seconds
} finally {
  if (-not $logcat.HasExited) {
    $logcat.Kill()
    $logcat.WaitForExit()
  }
}

Write-Host "Fertig. Logdatei: $outputPath"

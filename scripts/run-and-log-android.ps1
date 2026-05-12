param(
  [Parameter(Position = 0)]
  [ValidateRange(1, 86400)]
  [int]$Seconds = 45,

  [string]$Serial,

  [string]$Output = 'cityapp-android-log.txt',

  [switch]$NoBuild,

  [switch]$NoInstall
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

function Test-LogContains {
  param(
    [string[]]$Lines,
    [string]$Pattern
  )

  return [bool]($Lines | Select-String -SimpleMatch $Pattern | Select-Object -First 1)
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
} else {
  Write-Warning 'NoBuild ist aktiv. Die App kann ein altes Web-Bundle verwenden.'
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

if (-not $NoInstall) {
  Write-Host "Installiere Debug-App auf $targetSerial..."
  Push-Location (Join-Path $repoRoot.Path 'android')
  try {
    .\gradlew.bat installDebug -Pandroid.injected.serial=$targetSerial
    if ($LASTEXITCODE -ne 0) {
      throw "gradlew.bat installDebug fehlgeschlagen mit Exit-Code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Warning 'NoInstall ist aktiv. Das Geraet kann eine alte APK ausfuehren.'
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
Invoke-Adb -Arguments @('-s', $targetSerial, 'shell', 'monkey', '-p', $packageName, '-c', 'android.intent.category.LAUNCHER', '1')

Write-Host "Sammle $Seconds Sekunden logcat..."
Start-Sleep -Seconds $Seconds

Write-Host "Schreibe logcat-Dump nach $outputPath..."
$lines = Get-AdbOutput -Arguments @('-s', $targetSerial, 'logcat', '-d', '-v', 'time')

if ($lines) {
  $lines | Set-Content -Path $outputPath -Encoding utf8
} else {
  'Keine logcat-Zeilen erfasst. Pruefe, ob das Geraet verbunden ist und logcat Ausgaben liefert.' | Set-Content -Path $outputPath -Encoding utf8
}

if ($lines) {
  if (Test-LogContains -Lines $lines -Pattern '[atlas-ui] city selection enhancer v8') {
    Write-Warning 'Stale Web-Bundle erkannt: Log zeigt noch city selection enhancer v8. Fuehre ohne -NoBuild/-NoInstall aus und installiere die neue Debug-App.'
  }

  if (-not (Test-LogContains -Lines $lines -Pattern '[atlas-live-places] bridge installed')) {
    Write-Warning 'Live-Places-Bridge wurde im Log nicht gefunden. Das APK enthaelt wahrscheinlich nicht das aktuelle Web-Bundle oder die App ist vor dem Bridge-Start abgestuerzt.'
  }
}

Write-Host "Fertig. Logdatei: $outputPath"

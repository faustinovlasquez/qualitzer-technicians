param([string]$ToolRoot = (Join-Path $env:LOCALAPPDATA "QualitzerAndroid"))

# Paquete AAB para Google Play de la versión actual. Compilar antes el APK de la misma versión (Build-Standalone.ps1).
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Use-Toolchain.ps1") -ToolRoot $ToolRoot
$fileSystem = New-Object -ComObject Scripting.FileSystemObject
$env:GRADLE_USER_HOME = $fileSystem.GetFolder($env:GRADLE_USER_HOME).ShortPath
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$cachePath = $env:GRADLE_USER_HOME
$usedDrives = [System.Environment]::GetLogicalDrives()
$cacheDrive = @("Q:", "R:", "S:", "T:", "U:", "V:", "W:", "X:", "Y:", "Z:") | Where-Object { $usedDrives -notcontains "$_\" } | Select-Object -First 1
if (-not $cacheDrive) { throw "NO_FREE_DRIVE_FOR_NATIVE_BUILD_CACHE" }
$subst = Join-Path $env:SystemRoot "System32\subst.exe"
& $subst $cacheDrive $cachePath
if ($LASTEXITCODE -ne 0) { throw "NATIVE_BUILD_CACHE_DRIVE_FAILED" }
try {
    $env:GRADLE_USER_HOME = "$cacheDrive\"
    & (Join-Path $projectRoot "node_modules\node\bin\node.exe") (Join-Path $PSScriptRoot "build-play-bundle.cjs") --tool-root $ToolRoot
    if ($LASTEXITCODE -ne 0) { throw "PLAY_BUNDLE_FAILED_EXIT_$LASTEXITCODE" }
} finally {
    $env:GRADLE_USER_HOME = $cachePath
    & $subst $cacheDrive /D
}

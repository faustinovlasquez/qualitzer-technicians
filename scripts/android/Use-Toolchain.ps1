param([string]$ToolRoot = (Join-Path $env:LOCALAPPDATA "QualitzerAndroid"))

$javaHome = Join-Path $ToolRoot "jdk\jdk-17.0.20.1+1"
$sdkRoot = Join-Path $ToolRoot "sdk"
$gradleHome = Join-Path $ToolRoot "gradle\gradle-9.3.1"
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$nodeDirectory = Join-Path $projectRoot "node_modules\node\bin"

foreach ($required in @(
    (Join-Path $javaHome "bin\javac.exe"),
    (Join-Path $sdkRoot "cmdline-tools\19.0\bin\sdkmanager.bat"),
    (Join-Path $sdkRoot "build-tools\36.0.0\apksigner.bat"),
    (Join-Path $sdkRoot "platforms\android-36\android.jar"),
    (Join-Path $sdkRoot "ndk\27.1.12297006\source.properties"),
    (Join-Path $sdkRoot "ndk\27.1.12297006\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe"),
    (Join-Path $sdkRoot "cmake\3.22.1\bin\cmake.exe"),
    (Join-Path $sdkRoot "cmake\3.30.5\bin\cmake.exe"),
    (Join-Path $gradleHome "bin\gradle.bat"),
    (Join-Path $nodeDirectory "node.exe")
)) {
    if (-not (Test-Path $required)) { throw "TOOLCHAIN_FILE_MISSING: $required" }
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $ToolRoot "android-user"
$env:GRADLE_USER_HOME = Join-Path $ToolRoot "gradle-user"
$env:Path = "$nodeDirectory;$javaHome\bin;$sdkRoot\cmdline-tools\19.0\bin;$sdkRoot\platform-tools;$gradleHome\bin;$env:Path"
Write-Host "Toolchain activo solo en este proceso: $ToolRoot"
param(
    [string]$ToolRoot = (Join-Path $env:LOCALAPPDATA "QualitzerAndroid"),
    [switch]$BootstrapOnly
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"

function Expand-ToolArchive {
    param([string]$Archive, [string]$Destination)

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    & "$env:SystemRoot\System32\tar.exe" -xf $Archive -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "ARCHIVE_EXTRACTION_FAILED: $Archive" }
}

function Get-VerifiedArchive {
    param([string]$Url, [string]$Name, [string]$Algorithm, [string]$ExpectedHash)

    $destination = Join-Path $ToolRoot "downloads\$Name"
    if (-not (Test-Path $destination)) {
        $partial = "$destination.partial"
        Invoke-WebRequest -Uri $Url -UseBasicParsing -OutFile $partial
        $actual = (Get-FileHash $partial -Algorithm $Algorithm).Hash
        if ($actual -ne $ExpectedHash) { throw "DOWNLOAD_CHECKSUM_MISMATCH: $Name" }
        Move-Item $partial $destination
    }
    $actual = (Get-FileHash $destination -Algorithm $Algorithm).Hash
    if ($actual -ne $ExpectedHash) { throw "CACHED_CHECKSUM_MISMATCH: $Name" }
    Write-Host "$Name $Algorithm=$($actual.ToLowerInvariant()) verified"
    return $destination
}

New-Item -ItemType Directory -Path (Join-Path $ToolRoot "downloads") -Force | Out-Null
$javaHome = Join-Path $ToolRoot "jdk\jdk-17.0.20.1+1"
if (-not (Test-Path (Join-Path $javaHome "bin\javac.exe"))) {
    $jdk = Get-VerifiedArchive `
        -Url "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip" `
        -Name "OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip" `
        -Algorithm "SHA256" `
        -ExpectedHash "e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0"
    Expand-ToolArchive $jdk (Join-Path $ToolRoot "jdk")
}

$sdkRoot = Join-Path $ToolRoot "sdk"
$commandLineRoot = Join-Path $sdkRoot "cmdline-tools\19.0"
if (-not (Test-Path (Join-Path $commandLineRoot "bin\sdkmanager.bat"))) {
    $commandLine = Get-VerifiedArchive `
        -Url "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip" `
        -Name "commandlinetools-win-13114758_latest.zip" `
        -Algorithm "SHA1" `
        -ExpectedHash "54a582f3bf73e04253602f2d1c80bd5868aac115"
    $staging = Join-Path $ToolRoot ("s-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
    Expand-ToolArchive $commandLine $staging
    New-Item -ItemType Directory -Path (Join-Path $sdkRoot "cmdline-tools") -Force | Out-Null
    Move-Item (Join-Path $staging "cmdline-tools") $commandLineRoot
    Remove-Item $staging
}

$gradleHome = Join-Path $ToolRoot "gradle\gradle-9.3.1"
if (-not (Test-Path (Join-Path $gradleHome "bin\gradle.bat"))) {
    $gradle = Get-VerifiedArchive `
        -Url "https://services.gradle.org/distributions/gradle-9.3.1-bin.zip" `
        -Name "gradle-9.3.1-bin.zip" `
        -Algorithm "SHA256" `
        -ExpectedHash "b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06"
    Expand-ToolArchive $gradle (Join-Path $ToolRoot "gradle")
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $ToolRoot "android-user"
$env:GRADLE_USER_HOME = Join-Path $ToolRoot "gradle-user"
Write-Host "JAVA_HOME=$javaHome"
Write-Host "ANDROID_HOME=$sdkRoot"
Write-Host "GRADLE_HOME=$gradleHome"

if (-not $BootstrapOnly) {
    if (-not (Test-Path (Join-Path $sdkRoot "platform-tools\adb.exe"))) {
        $platformTools = Get-VerifiedArchive `
            -Url "https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip" `
            -Name "platform-tools_r37.0.1-win.zip" `
            -Algorithm "SHA1" `
            -ExpectedHash "e03e78b1d80b396f1c3358e31251cb31740e1110"
        Expand-ToolArchive $platformTools $sdkRoot
    }
    & (Join-Path $commandLineRoot "bin\sdkmanager.bat") "--sdk_root=$sdkRoot" `
        "platforms;android-36" "build-tools;36.0.0" `
        "ndk;27.1.12297006" "cmake;3.22.1" "cmake;3.30.5"
    if ($LASTEXITCODE -ne 0) { throw "SDK_INSTALL_FAILED: $LASTEXITCODE" }

    $ndkRoot = Join-Path $sdkRoot "ndk\27.1.12297006"
    $clangRelative = "toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe"
    if (-not (Test-Path (Join-Path $ndkRoot $clangRelative))) {
        $ndk = Get-VerifiedArchive `
            -Url "https://dl.google.com/android/repository/android-ndk-r27b-windows.zip" `
            -Name "android-ndk-r27b-windows.zip" `
            -Algorithm "SHA1" `
            -ExpectedHash "3bb7efc850cd0af7707854b7e0d5c3b6a7153703"
        $staging = Join-Path $ToolRoot ("n-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
        Expand-ToolArchive $ndk $staging
        $extracted = Join-Path $staging "android-ndk-r27b"
        if (-not (Test-Path (Join-Path $extracted $clangRelative))) { throw "NDK_COMPILER_MISSING" }
        if (Test-Path $ndkRoot) {
            $packageMetadata = Join-Path $ndkRoot "package.xml"
            if (Test-Path $packageMetadata) {
                Copy-Item $packageMetadata (Join-Path $extracted "package.xml")
            }
            $backup = Join-Path $ToolRoot ("ndk-incomplete-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
            Move-Item $ndkRoot $backup
            Write-Host "Preserved incomplete NDK: $backup"
        }
        Move-Item $extracted $ndkRoot
        Remove-Item $staging
    }
}
Write-Host "TOOLCHAIN_PREPARATION_COMPLETE"
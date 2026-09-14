param(
    [string]$ToolRoot = (Join-Path $env:LOCALAPPDATA "QualitzerAndroid"),
    [ValidateSet("arm64-v8a", "arm64-v8a,armeabi-v7a", "arm64-v8a,armeabi-v7a,x86_64")]
    [string]$Architectures = "arm64-v8a,armeabi-v7a",
    [switch]$SkipPrebuild,
    [switch]$PrebuildOnly,
    [switch]$VerifyOnly,
    [switch]$DiagnosticOnly
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.PowerShell.Management
Import-Module Microsoft.PowerShell.Utility
Import-Module Microsoft.PowerShell.Security
. (Join-Path $PSScriptRoot "Use-Toolchain.ps1") -ToolRoot $ToolRoot
$fileSystem = New-Object -ComObject Scripting.FileSystemObject
$env:GRADLE_USER_HOME = $fileSystem.GetFolder($env:GRADLE_USER_HOME).ShortPath
Write-Host "Gradle usa alias corto de la misma cache: $env:GRADLE_USER_HOME"
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$signingRoot = Join-Path $projectRoot ".data\android-signing"
foreach ($requiredIdentity in @("qualitzer-field-release.p12", "credentials.json")) {
    if (-not [System.IO.File]::Exists((Join-Path $signingRoot $requiredIdentity))) {
        throw "UPDATE_REQUIRES_EXISTING_PRIVATE_SIGNING_IDENTITY"
    }
}
if ((Get-Item -LiteralPath $signingRoot -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "SIGNING_DIRECTORY_MUST_NOT_BE_A_LINK"
}
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")

function Protect-SigningEntry([System.IO.FileSystemInfo]$Entry) {
    $sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
    $acl = $Entry.GetAccessControl($sections)
    if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $userSid.Value) {
        throw "SIGNING_ENTRY_MUST_BELONG_TO_CURRENT_USER"
    }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        $acl.RemoveAccessRuleSpecific($rule)
    }
    $inheritance = if ($Entry -is [System.IO.DirectoryInfo]) {
        [System.Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit"
    } else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($sid in @($userSid, $systemSid)) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, "FullControl", $inheritance, "None", "Allow"))
    }
    $Entry.SetAccessControl($acl)
}

Protect-SigningEntry (Get-Item -LiteralPath $signingRoot -Force)
foreach ($file in Get-ChildItem -LiteralPath $signingRoot -Force) {
    if ($file.PSIsContainer -or ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw "UNEXPECTED_SIGNING_DIRECTORY_ENTRY"
    }
    Protect-SigningEntry $file
}
$buildArguments = @("--tool-root", $ToolRoot, "--architectures", $Architectures)
if ($SkipPrebuild) { $buildArguments += "--skip-prebuild" }
if ($PrebuildOnly) { $buildArguments += "--prebuild-only" }
if ($VerifyOnly) { $buildArguments += "--verify-only" }
if ($DiagnosticOnly) { $buildArguments += "--diagnostic-only" }
$cachePath = $env:GRADLE_USER_HOME
$usedDrives = [System.Environment]::GetLogicalDrives()
$cacheDrive = @("Q:", "R:", "S:", "T:", "U:", "V:", "W:", "X:", "Y:", "Z:") | Where-Object { $usedDrives -notcontains "$_\" } | Select-Object -First 1
if (-not $cacheDrive) { throw "NO_FREE_DRIVE_FOR_NATIVE_BUILD_CACHE" }
$subst = Join-Path $env:SystemRoot "System32\subst.exe"
& $subst $cacheDrive $cachePath
if ($LASTEXITCODE -ne 0) { throw "NATIVE_BUILD_CACHE_DRIVE_FAILED" }
try {
    $env:GRADLE_USER_HOME = "$cacheDrive\"
    Write-Host "Cache Gradle existente accesible temporalmente en $cacheDrive"
    & (Join-Path $projectRoot "node_modules\node\bin\node.exe") (Join-Path $PSScriptRoot "build-standalone.cjs") @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "STANDALONE_BUILD_FAILED_EXIT_$LASTEXITCODE" }
} finally {
    $env:GRADLE_USER_HOME = $cachePath
    & $subst $cacheDrive /D
}
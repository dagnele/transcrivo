param(
  [ValidateSet("cpu", "vulkan", "cuda")]
  [string] $Backend = "cpu",

  [string] $InstallDir = "$env:LOCALAPPDATA\Transcrivo\bin"
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "This installer is for Windows. Use install.sh on Linux."
}

$assetName = switch ($Backend) {
  "cpu" { "transcrivo-windows-x86_64-cpu.exe" }
  "vulkan" { "transcrivo-windows-x86_64-vulkan.exe" }
  "cuda" { "transcrivo-windows-x86_64-cuda.exe" }
  default { throw "Unsupported backend '$Backend'." }
}

$downloadUrl = "https://github.com/dagnele/transcrivo/releases/latest/download/$assetName"
$destinationPath = Join-Path $InstallDir "transcrivo.exe"
$tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".exe")

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

try {
  Write-Host "Downloading $assetName..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath
  Move-Item -Force -Path $tempPath -Destination $destinationPath
}
finally {
  if (Test-Path $tempPath) {
    Remove-Item -Force $tempPath
  }
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntries = @()
if (-not [string]::IsNullOrWhiteSpace($userPath)) {
  $pathEntries = $userPath.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)
}

if ($pathEntries -notcontains $InstallDir) {
  $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
    $InstallDir
  } else {
    "$userPath;$InstallDir"
  }

  [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
  $env:Path = "$InstallDir;$env:Path"
  Write-Host "Added $InstallDir to your user PATH. Open a new terminal if 'transcrivo' is not found immediately."
} else {
  Write-Host "The install directory is already on your user PATH."
}

Write-Host "Installed Transcrivo to $destinationPath"
Write-Host "Run 'transcrivo --help' to verify the installation."

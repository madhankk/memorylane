param([switch]$Installer)
$ErrorActionPreference = "Stop"
$TrayRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $TrayRoot "..")).Path
$Version = (Get-Content (Join-Path $RepoRoot "package.json") | ConvertFrom-Json).version
$ReleaseRoot = Join-Path $TrayRoot "release\$Version"
$Stage = Join-Path $ReleaseRoot "MemoryLane-win32-x64"

node (Join-Path $PSScriptRoot "prepare-runtime.mjs")
Push-Location $TrayRoot
try {
  go build -trimpath -ldflags "-s -w -H windowsgui -X main.version=$Version -X main.updateFeedURL=$env:MEMORYLANE_UPDATE_FEED_URL -X main.updatePublicKey=$env:MEMORYLANE_UPDATE_PUBLIC_KEY" -o "dist\MemoryLane.exe" .
} finally { Pop-Location }

if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item (Join-Path $TrayRoot "dist\MemoryLane.exe") (Join-Path $Stage "MemoryLane.exe")
Copy-Item (Join-Path $TrayRoot "runtime") (Join-Path $Stage "runtime") -Recurse

if ($env:SIGN_RELEASE -eq "1") {
  & (Join-Path $PSScriptRoot "sign-app-windows.ps1") (Join-Path $Stage "MemoryLane.exe")
  & (Join-Path $PSScriptRoot "sign-app-windows.ps1") (Join-Path $Stage "runtime\node-runtime.exe")
}

$Zip = Join-Path $ReleaseRoot "MemoryLane-win32-x64.zip"
Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$Stage\*" -DestinationPath $Zip -CompressionLevel Optimal

if ($Installer) {
  $Iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if (-not $Iscc) { throw "Inno Setup 6 (ISCC.exe) is required to build the Windows installer" }
  & $Iscc.Source "/DSourceDir=$Stage" "/DOutputDir=$ReleaseRoot" "/DAppVersion=$Version" (Join-Path $TrayRoot "installer.iss")
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
  $Setup = Join-Path $ReleaseRoot "MemoryLane-Setup.exe"
  if ($env:SIGN_RELEASE -eq "1") { & (Join-Path $PSScriptRoot "sign-installer-windows.ps1") $Setup }
}

Write-Host "MemoryLane desktop package: $ReleaseRoot"

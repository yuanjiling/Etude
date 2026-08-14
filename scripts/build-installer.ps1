# Build script for Etude Modern Capsule Installer with Native Uninstall.exe
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot "release"
$installerDir = Join-Path $projectRoot "installer"
$payloadZip = Join-Path $installerDir "src-tauri\payload.zip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building Etude Modern Installer & Uninstaller" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Build Main Application (Frontend + Embedded Rust Core) & Uninstaller
Write-Host ""
Write-Host "[1/4] Compiling main application with embedded frontend & Uninstaller..." -ForegroundColor Yellow
Set-Location $projectRoot
npm run tauri:build -- --no-bundle

Write-Host "Compiling standalone Uninstaller binary..." -ForegroundColor Gray
Set-Location (Join-Path $projectRoot "src-tauri")
cargo build --release --bin Uninstall

$mainExe = Join-Path $projectRoot "src-tauri\target\release\etude.exe"
$uninstExe = Join-Path $projectRoot "src-tauri\target\release\Uninstall.exe"
if (-not (Test-Path $mainExe)) {
    throw "Main app binary not found: $mainExe"
}
if (-not (Test-Path $uninstExe)) {
    throw "Uninstaller binary not found: $uninstExe"
}

# 2. Package into Payload.zip
Write-Host ""
Write-Host "[2/4] Packaging application & uninstaller into payload.zip..." -ForegroundColor Yellow
if (Test-Path $payloadZip) {
    Remove-Item -LiteralPath $payloadZip -Force
}

$tempPayloadDir = Join-Path $installerDir "temp_payload"
if (Test-Path $tempPayloadDir) { Remove-Item -LiteralPath $tempPayloadDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempPayloadDir -Force | Out-Null

Copy-Item -LiteralPath $mainExe -Destination (Join-Path $tempPayloadDir "Etude.exe") -Force
Copy-Item -LiteralPath $uninstExe -Destination (Join-Path $tempPayloadDir "Uninstall.exe") -Force

Compress-Archive -Path (Join-Path $tempPayloadDir "*") -DestinationPath $payloadZip -Force
Remove-Item -LiteralPath $tempPayloadDir -Recurse -Force

$payloadSizeMB = [math]::Round(((Get-Item $payloadZip).Length / 1MB), 2)
Write-Host "Payload packaged successfully: $payloadSizeMB MB" -ForegroundColor Green

# 3. Build Installer WebUI & Rust Binary
Write-Host ""
Write-Host "[3/4] Compiling modern installer WebUI and binary..." -ForegroundColor Yellow
Set-Location $installerDir
npm run build
npm run tauri:build -- --no-bundle

$installerExe = Join-Path $installerDir "src-tauri\target\release\etude_installer.exe"
if (-not (Test-Path $installerExe)) {
    throw "Installer binary not found: $installerExe"
}

# 4. Output to release directory
Write-Host ""
Write-Host "[4/4] Outputting final installer executable..." -ForegroundColor Yellow
if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
}

# Stop any running instances before copy
Stop-Process -Name "Etude-Setup" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "etude_installer" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$finalSetupExe = Join-Path $releaseDir "Etude-Setup.exe"
Copy-Item -LiteralPath $installerExe -Destination $finalSetupExe -Force

$finalSizeMB = [math]::Round(((Get-Item $finalSetupExe).Length / 1MB), 2)
Set-Location $projectRoot

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Etude Setup generated successfully!" -ForegroundColor Green
Write-Host " Output file: $finalSetupExe" -ForegroundColor Green
Write-Host " Installer size: $finalSizeMB MB" -ForegroundColor Green
Write-Host " Included: Etude.exe + Native Uninstall.exe" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

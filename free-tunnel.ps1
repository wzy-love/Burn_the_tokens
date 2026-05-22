$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/3] Checking cloudflared..." -ForegroundColor Cyan
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "cloudflared is not installed." -ForegroundColor Yellow
  Write-Host "Install first: winget install Cloudflare.cloudflared" -ForegroundColor Yellow
  exit 1
}

Write-Host "[2/3] Checking local game server on http://localhost:5173 ..." -ForegroundColor Cyan
$serverReady = $false
try {
  $resp = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 1
  if ($resp.StatusCode -ge 200) {
    $serverReady = $true
  }
} catch {
  $serverReady = $false
}

if (-not $serverReady) {
  Write-Host "Local server is not ready, starting start.bat ..." -ForegroundColor Yellow
  Start-Process -FilePath "$PSScriptRoot\start.bat"
  Start-Sleep -Seconds 8
}

Write-Host "[3/3] Starting free public tunnel..." -ForegroundColor Green
Write-Host "Share the https://*.trycloudflare.com URL shown below." -ForegroundColor Green
Write-Host "Keep this window open while others are playing." -ForegroundColor Green
Write-Host ""

& cloudflared tunnel --url http://localhost:5173

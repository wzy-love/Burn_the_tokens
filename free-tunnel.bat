@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Checking cloudflared...
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared is not installed.
  echo Install first: winget install Cloudflare.cloudflared
  echo Then run this script again.
  pause
  exit /b 1
)

echo [2/3] Checking local game server on http://localhost:5173 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }"

if not %errorlevel%==0 (
  echo Local server is not ready, starting start.bat ...
  start "" "%~dp0start.bat"
  timeout /t 8 /nobreak >nul
)

echo [3/3] Starting free public tunnel...
echo Share the https://*.trycloudflare.com URL shown below.
echo Keep this window open while others are playing.
echo.
cloudflared tunnel --url http://localhost:5173

endlocal

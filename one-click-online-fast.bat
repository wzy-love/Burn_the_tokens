@echo off
setlocal
cd /d "%~dp0"

echo Starting one-click FAST online mode...
echo This mode runs Docker production build on localhost:5174 then opens a public tunnel.
echo.

echo [1/4] Checking docker...
where docker >nul 2>nul
if errorlevel 1 (
  echo docker is not installed or not in PATH.
  echo Falling back to normal one-click online mode...
  echo.
  call "%~dp0one-click-online.bat"
  exit /b 0
)

echo [2/4] Checking cloudflared...
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared is not installed.
  echo Install first: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

echo [3/4] Starting production containers (port 5174)...
start "Burn Token FAST (Docker)" cmd /k "cd /d %~dp0 && docker compose -f docker-compose.yml -f docker-compose.fast.yml up --build"

set /a attempts=0
:wait_for_prod
set /a attempts+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri 'http://localhost:5174' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 goto start_tunnel
if %attempts% GEQ 150 goto timeout
timeout /t 1 /nobreak >nul
goto wait_for_prod

:timeout
echo Production service did not become ready in time.
echo Check the "Burn Token FAST (Docker)" window for errors, then retry.
pause
exit /b 1

:start_tunnel
echo [4/4] Starting free public tunnel to http://localhost:5174 ...
echo Share the https://*.trycloudflare.com URL shown below.
echo Keep this window open while others are playing.
echo.
cloudflared tunnel --url http://localhost:5174

endlocal

@echo off
cd /d "%~dp0"
echo Starting Burn Token Arena (frontend + backend)...
start "Burn Token Dev Server" cmd /k "cd /d %~dp0 && npm run dev"

set /a attempts=0
:wait_for_frontend
set /a attempts+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 goto open_browser
if %attempts% GEQ 45 goto open_browser
timeout /t 1 /nobreak >nul
goto wait_for_frontend

:open_browser
start "" "http://localhost:5173"

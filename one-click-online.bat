@echo off
setlocal
cd /d "%~dp0"

echo Starting one-click online mode...
echo This will start local services (if needed) and open a free public tunnel.
echo.

call "%~dp0free-tunnel.bat"

echo.
echo Tunnel process ended. Press any key to close.
pause >nul
endlocal

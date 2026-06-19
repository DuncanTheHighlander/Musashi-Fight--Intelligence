@echo off
REM ===================================================================
REM  start-musashi.bat
REM  Double-click this file (or run it from CMD/PowerShell) to launch
REM  the Musashi dev server on http://localhost:3000.
REM  Leave the window open while you use the app. Ctrl+C to stop.
REM ===================================================================

setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo  Musashi dev server
echo  Folder:  %CD%
echo  URL:     http://localhost:3000
echo ============================================================
echo.
echo Tip: if you see "EADDRINUSE :3000", another process is using
echo      port 3000. Close it, or run "pnpm dev:alt" in this folder
echo      to use port 3001 instead.
echo.

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [error] pnpm is not on your PATH. Install with:
  echo         npm install -g pnpm@10
  echo Then close this window and re-run start-musashi.bat.
  pause
  exit /b 1
)

call pnpm dev

echo.
echo (Dev server has exited. Press any key to close this window.)
pause >nul
endlocal

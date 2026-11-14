@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Spark needs Node.js 18 or newer. Install Node.js, then run this launcher again.
  pause
  exit /b 1
)
node server.cjs --open
if errorlevel 1 pause

@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Spark needs Node.js 22.13 or newer. Install Node.js, then run this launcher again.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
  echo Please upgrade Node.js to 22.13 or newer for SQLite support.
  pause
  exit /b 1
)
where docker >nul 2>nul && docker start spark-whisper >nul 2>nul
node family.cjs %*
pause

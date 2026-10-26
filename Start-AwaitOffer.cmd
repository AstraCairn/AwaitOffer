@echo off
setlocal
cd /d "%~dp0"
title AwaitOffer
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 24, then run this file again.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit(major===24 && minor>=15 ? 0 : 1)"
if errorlevel 1 (
  echo AwaitOffer requires Node.js 24.15 or newer within 24.x.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing AwaitOffer dependencies...
  call npm.cmd ci
  if errorlevel 1 goto failed
)
echo Preparing AwaitOffer...
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo AwaitOffer could not start. See the message above.
pause
exit /b 1

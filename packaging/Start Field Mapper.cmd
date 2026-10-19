@echo off
setlocal
title Field Mapper
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Runtime is missing. Right-click the downloaded ZIP and choose Extract All.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0launcher.cjs"
if errorlevel 1 (
  echo.
  echo Field Mapper could not start. See the message above and the Quick Setup guide.
  pause
)

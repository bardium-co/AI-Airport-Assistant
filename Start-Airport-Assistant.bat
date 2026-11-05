@echo off
rem Double-click to start the AI Airport Assistant for tablets and kiosks. Keep this window open.
title AI Airport Assistant
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-airport.ps1"
echo.
echo The assistant has stopped. Press any key to close this window.
pause >nul

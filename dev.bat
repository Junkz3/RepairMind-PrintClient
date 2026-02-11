@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
echo Starting RepairMind Print Client (dev mode)...
npx electron . --dev
pause

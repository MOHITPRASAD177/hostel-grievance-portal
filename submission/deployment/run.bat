@echo off
echo ===================================================
echo   HostelGrievance Portal - Launcher (Windows)
echo ===================================================
cd /d "%~dp0\..\.."
echo [1/3] Checking dependencies...
call npm install
echo [2/3] Initializing SQLite database...
call npm run db:init
echo [3/3] Starting backend server and frontend client...
call npm run dev:all
pause

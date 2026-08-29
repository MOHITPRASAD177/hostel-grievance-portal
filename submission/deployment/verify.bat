@echo off
echo ===================================================
echo   HostelGrievance - Verification Runner (Windows)
echo ===================================================
cd /d "%~dp0\..\.."
echo [1/2] Running automated Vitest test suite (23 tests)...
call npx vitest run
echo [2/2] Running TypeScript static analysis check...
call npm run typecheck
echo Verification complete.
pause

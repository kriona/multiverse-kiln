@echo off
rem Starts the shared watcher, Colyseus server, and Vite client. Ctrl+C stops everything.
cd /d "%~dp0"

rem Always install so pulled dependency changes are picked up; it's a quick no-op when nothing changed
echo Installing dependencies...
call npm install --no-audit --no-fund || goto :error

call npm run dev || goto :error
goto :eof

:error
echo.
echo Startup failed.
pause

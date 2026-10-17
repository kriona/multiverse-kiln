@echo off
rem Starts the shared watcher, Colyseus server, and Vite client. Ctrl+C stops everything.
cd /d "%~dp0"

rem Always install so pulled dependency changes are picked up; it's a quick no-op when nothing changed
echo Installing dependencies...
call npm install --no-audit --no-fund || goto :error
call npm run build -w shared || goto :error

rem npm renames the window to the command it runs, and so do the .cmd shims in node_modules\.bin
rem (title %COMSPEC%), so the watchers below run each tool's script with node, without either. They
rem are the same commands as the root package.json's dev script, and the title set here stays
set "MODULES=%~dp0node_modules"
title Multiverse Kiln

node "%MODULES%\concurrently\dist\bin\index.js" --kill-others --names shared,server,client --prefix-colors blue,green,magenta "cd shared && node \"%MODULES%\typescript\bin\tsc\" -p tsconfig.json --watch --preserveWatchOutput" "cd server && node \"%MODULES%\tsx\dist\cli.mjs\" watch src/index.ts" "cd client && node \"%MODULES%\vite\bin\vite.js\"" || goto :error
goto :eof

:error
echo.
echo Startup failed.
pause

@echo off
rem Starts the shared watcher, Colyseus server, and Vite client. Ctrl+C stops everything.
cd /d "%~dp0"

rem Start Docker Desktop if its engine isn't running, so it boots while dependencies install
set "DOCKER_DESKTOP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
docker info >nul 2>&1
if errorlevel 1 (
	if not exist "%DOCKER_DESKTOP%" (
		echo Docker isn't running, and Docker Desktop wasn't found at "%DOCKER_DESKTOP%". Start Docker, then run this again.
		goto :error
	)
	echo Starting Docker Desktop...
	start "" "%DOCKER_DESKTOP%"
)

rem Always install so pulled dependency changes are picked up; it's a quick no-op when nothing changed
echo Installing dependencies...
call npm install --no-audit --no-fund || goto :error
call npm run build -w shared || goto :error

rem Wait up to two minutes for the Docker engine. ping waits about a second per extra echo request;
rem timeout /t would fail when stdin is redirected
set /a DOCKER_TRIES=0
:waitForDocker
docker info >nul 2>&1
if not errorlevel 1 goto :dockerReady
set /a DOCKER_TRIES+=1
if %DOCKER_TRIES% geq 60 (
	echo Docker didn't start within two minutes.
	goto :error
)
if %DOCKER_TRIES% equ 1 echo Waiting for Docker...
ping -n 3 127.0.0.1 >nul
goto :waitForDocker
:dockerReady

rem --wait returns once Postgres passes its healthcheck in docker-compose.yml
echo Starting Postgres...
docker compose up -d --wait || goto :error

rem cmd reads each line of this file in the console's code page, so switch it to UTF-8 to read the title's emoji
chcp 65001 >nul

rem npm renames the window to the command it runs, and so do the .cmd shims in node_modules\.bin
rem (title %COMSPEC%), so the watchers below run each tool's script with node, without either. They
rem are the same commands as the root package.json's dev script, and the title set here stays
set "MODULES=%~dp0node_modules"
title 🌌Multiverse Kiln🔥

node "%MODULES%\concurrently\dist\bin\index.js" --kill-others --names shared,server,client --prefix-colors blue,green,magenta "cd shared && node \"%MODULES%\typescript\bin\tsc\" -p tsconfig.json --watch --preserveWatchOutput" "cd server && node \"%MODULES%\tsx\dist\cli.mjs\" watch src/index.ts" "cd client && node \"%MODULES%\vite\bin\vite.js\"" || goto :error
goto :eof

:error
echo.
echo Startup failed.
pause

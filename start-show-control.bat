@echo off
REM Double-click to start Whatnot Show Control. Close this window to stop it.
cd /d "%~dp0"
where node >NUL 2>NUL || (echo Node.js is not installed. Get the LTS version from https://nodejs.org && pause && exit /b 1)
start "" /min cmd /c "timeout /t 2 >NUL & start http://127.0.0.1:3000/dashboard/"
node server\index.js
pause

@echo off
rem Taktgeber unter Windows starten. Fenster offen lassen.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt. Bitte Node.js 22 LTS von https://nodejs.org installieren. & pause & exit /b 1)
if not exist node_modules (echo Installiere Abhaengigkeiten ... & call npm ci --no-audit --no-fund || (pause & exit /b 1))
if not exist dist\index.html (echo Baue die App ... & call npm run build || (pause & exit /b 1))
if not exist server\core.mjs (call npm run build:core || (pause & exit /b 1))
if "%PORT%"=="" set PORT=8787
start "" http://localhost:%PORT%
node server\index.mjs
pause

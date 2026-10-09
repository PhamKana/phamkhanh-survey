@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Hay cai Node.js 24 tro len truoc khi chay.
  pause
  exit /b 1
)
echo Survey: http://localhost:3000/s/genai
echo Admin:  http://localhost:3000/admin
echo Tai khoan lan dau: data\admin-first-login.txt
node server.mjs
pause

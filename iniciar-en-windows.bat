@echo off
setlocal

echo ==========================================
echo   WhatsApp Masivo - Inicio en Windows
echo ==========================================
echo.

cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  echo [OK] Python detectado. Iniciando servidor local en puerto 4180...
  start "" http://localhost:4180/index.html
  py -m http.server 4180
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo [OK] Python detectado. Iniciando servidor local en puerto 4180...
  start "" http://localhost:4180/index.html
  python -m http.server 4180
  goto :eof
)

echo [AVISO] No se detecto Python. Abriendo index.html directo en el navegador...
start "" index.html

echo.
echo Si no funciona correctamente, instala Python desde:
echo https://www.python.org/downloads/windows/
echo y vuelve a ejecutar este archivo .bat

echo.
pause

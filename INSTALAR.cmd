@echo off
cd /d "%~dp0"
call npm ci
if errorlevel 1 (
  echo No se pudo completar la instalacion. Revisa la conexion a internet.
  pause
  exit /b 1
)
echo Instalacion completa. Abre INICIAR.cmd.
pause
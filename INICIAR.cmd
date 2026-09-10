@echo off
cd /d "%~dp0"
if not exist "node_modules\node\bin\node.exe" (
  echo Primero abre INSTALAR.cmd para instalar las dependencias.
  pause
  exit /b 1
)
"node_modules\node\bin\node.exe" scripts\start.cjs
pause
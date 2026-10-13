@echo off
setlocal
chcp 65001 >nul
if exist "E:\nodejs\node.exe" (
  "E:\nodejs\node.exe" "%~dp0scripts\local-dev.mjs" %*
) else (
  node "%~dp0scripts\local-dev.mjs" %*
)
set "MIAOJI_LAUNCH_EXIT=%ERRORLEVEL%"
echo.
if "%~1"=="" pause
endlocal & exit /b %MIAOJI_LAUNCH_EXIT%

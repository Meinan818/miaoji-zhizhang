@echo off
setlocal
chcp 65001 >nul
if exist "E:\nodejs\node.exe" (
  "E:\nodejs\node.exe" "%~dp0scripts\backup-db.mjs" %*
) else (
  node "%~dp0scripts\backup-db.mjs" %*
)
set "MIAOJI_BACKUP_EXIT=%ERRORLEVEL%"
echo.
pause
endlocal & exit /b %MIAOJI_BACKUP_EXIT%

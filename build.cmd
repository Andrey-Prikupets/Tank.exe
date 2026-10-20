@echo off
setlocal
call npm.cmd run build %*
exit /b %ERRORLEVEL%

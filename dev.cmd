@echo off
setlocal
call npm.cmd run dev %*
exit /b %ERRORLEVEL%

@echo off
setlocal
call npm.cmd run preview %*
exit /b %ERRORLEVEL%

@echo off
setlocal
node tools\vcr.js %*
exit /b %ERRORLEVEL%

@echo off
setlocal
node tools\bench.js %*
exit /b %ERRORLEVEL%

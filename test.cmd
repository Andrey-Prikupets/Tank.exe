@echo off
setlocal
node test\run_tests.js
exit /b %ERRORLEVEL%

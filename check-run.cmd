@echo off
setlocal
for /f "tokens=*" %%i in ('gh run list --limit 1 --json databaseId -q ".[0].databaseId"') do set RUN_ID=%%i
echo ========================================================
echo LATEST GITHUB ACTIONS RUN (ID: %RUN_ID%)
echo ========================================================
gh run list --limit 1
if defined RUN_ID (
    echo.
    echo --------------------------------------------------------
    echo DETAILS:
    echo --------------------------------------------------------
    gh run view %RUN_ID%
)
endlocal


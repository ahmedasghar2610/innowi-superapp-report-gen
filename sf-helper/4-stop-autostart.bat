@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Innowi crawler helper.cmd" 2>nul
taskkill /F /FI "WINDOWTITLE eq Innowi crawler helper" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe' OR Name='python.exe'\" | Where-Object { $_.CommandLine -like '*helper.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
if exist "%~dp0helper.lock" del "%~dp0helper.lock"
echo Auto-start removed and the background helper stopped.
pause

@echo off
cd /d "%~dp0"
set PYW=
for /f "delims=" %%P in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%P"
if not defined PYW (echo pythonw not found - install Python from python.org and tick "Add Python to PATH".& pause & exit /b 1)
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Innowi crawler helper.cmd"
(echo @echo off& echo start "" "%PYW%" "%~dp0helper.py") > "%LNK%"
start "" "%PYW%" "%~dp0helper.py"
echo.
echo Done. The helper is running now (no window) and starts by itself every time you log in.
echo Its log is helper.log in this folder.
pause

@echo off
REM Double-click, or run "start-local" from cmd, to start Postgres + API + web.
REM Passes any arguments through, so "start-local -Stop" and "start-local -Status" work too.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*

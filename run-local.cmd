@echo off
rem Double-click or run from cmd: starts PostgreSQL + API + dashboard locally.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local.ps1" %*
if errorlevel 1 pause

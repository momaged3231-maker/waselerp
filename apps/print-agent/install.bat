@echo off
REM WaselERP Print Agent installer launcher.
REM Right-click -> "Run as administrator", or run from an elevated PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause

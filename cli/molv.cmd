@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\MolvOS.exe" "%~dp0main.js" %*

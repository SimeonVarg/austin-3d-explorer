@echo off
rem ---------------------------------------------------------------------------
rem  watch.cmd - open a live window onto what the agents are doing.
rem
rem  Double-click this file, or run it from anywhere:
rem      C:\Users\simip\Projects\austin-3d-explorer\scripts\watch.cmd
rem
rem  Extras:
rem      watch.cmd --list          what is running right now
rem      watch.cmd thinking        turn the agents' thinking on or off
rem      watch.cmd --one           follow only the busiest agent
rem
rem  Set WATCH_NO_PAUSE=1 to skip the "press any key" at the end. That is for
rem  scripts and pipes only - a double-click needs the pause or the window
rem  flashes and vanishes before anything can be read.
rem ---------------------------------------------------------------------------
setlocal
title Watching the agents
set "HERE=%~dp0"

set "PY="
for %%P in (py.exe) do if not defined PY if exist "%%~$PATH:P" set "PY=py"
for %%P in (python.exe) do if not defined PY if exist "%%~$PATH:P" set "PY=python"
for %%P in (python3.exe) do if not defined PY if exist "%%~$PATH:P" set "PY=python3"

if not defined PY (
  echo.
  echo   I could not find Python on this computer, so I cannot run the viewer.
  echo   Install it from https://www.python.org/downloads/ and run this again.
  echo.
  if not defined WATCH_NO_PAUSE pause
  exit /b 1
)

pushd "%HERE%.."
%PY% "%HERE%watch-agents.py" %*
set "RC=%ERRORLEVEL%"
popd

if not defined WATCH_NO_PAUSE (
  echo.
  pause
)
exit /b %RC%

@echo off
cd /d "%~dp0"
start "Outward Crafting API" cmd /k "%~dp0run_api.cmd"
start "Outward Crafting Frontend" cmd /k "%~dp0run_frontend.cmd"

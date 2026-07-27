@echo off
chcp 65001 >nul
title ViralFlow
cd /d "%~dp0"
echo 正在启动 ViralFlow，请不要关闭此窗口...
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5173'"
call npm.cmd run dev
echo.
echo 服务已经停止。按任意键关闭窗口。
pause >nul

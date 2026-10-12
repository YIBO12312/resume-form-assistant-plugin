@echo off
chcp 65001 >nul
title 网申助手 · 自检
echo.
echo 正在运行全部自检（识别引擎 / 端到端填充 / service worker / 静态检查）...
echo.

set "RUNNER=%~dp0tests\run-all.mjs"

set "NODE=node"
where node >nul 2>nul
if %errorlevel%==0 goto run

set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto run

set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%NODE%" goto run

set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if exist "%NODE%" goto run

echo 没有找到 Node.js。两种办法：
echo.
echo   1. 装一个 Node.js（https://nodejs.org）后重新双击本文件
echo   2. 不用命令行：打开插件设置页，点右上角「识别引擎自测」
goto end

:run
echo 使用 %NODE%
"%NODE%" "%RUNNER%"

:end
echo.
pause

@echo off
chcp 65001 >nul
title 网申助手 · 安装到 Edge
echo.
echo ============================================================
echo   网申助手 · Resume Form Assistant    安装助手
echo ============================================================
echo.
echo   接下来按三步操作：
echo.
echo   1. 在马上打开的 Edge 页面里，打开左下角「开发人员模式」
echo   2. 点上方「加载解压缩的扩展」
echo   3. 选中马上打开的文件夹，直接点「选择文件夹」
echo.
echo   装好后浏览器会自动打开设置页，按提示做就能用了。
echo.
echo   快捷键： Alt+Shift+F 一键填充    Alt+Shift+P 预览识别结果
echo.
echo ============================================================
echo.

start "" msedge.exe "edge://extensions/"
timeout /t 2 /nobreak >nul
start "" explorer.exe "%~dp0."

echo 已打开 Edge 扩展页与插件文件夹。
echo 如果 Edge 没有自动打开，请手动访问 edge://extensions/
echo.
pause

@echo off
setlocal

rem Always run from this script's own directory (repo root)
cd /d "%~dp0"

rem Prefer the portable Node 24 runtime if present (matches .nvmrc)
set "NODE24=%LOCALAPPDATA%\mimo-node24\node-v24.19.0-win-x64"
if exist "%NODE24%\node.exe" set "PATH=%NODE24%;%PATH%"

rem Electron / Playwright binaries download slowly from GitHub in some regions;
rem use the npmmirror mirror by default (override with your own env vars).
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined PLAYWRIGHT_DOWNLOAD_HOST set "PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/"

rem Defaults: production build, install only when caches are missing.
set "BUILD_TARGET=build:prod"
set "DO_INSTALL=1"
if exist "node_modules\" if exist "app\node_modules\" if exist "node_modules\electron\dist\electron.exe" set "DO_INSTALL=0"

rem Arguments:
rem   dev       build the development channel instead of prod
rem   prod      build the production channel (default)
rem   install   force a fresh dependency install (ignore existing caches)
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="dev" set "BUILD_TARGET=build:dev"
if /I "%~1"=="prod" set "BUILD_TARGET=build:prod"
if /I "%~1"=="install" set "DO_INSTALL=1"
shift
goto parse_args
:args_done

echo ==============================================
echo  GitHub Desktop rebuild
echo ==============================================
echo  Target : %BUILD_TARGET%
echo  Install: %DO_INSTALL% (1=install, 0=skip cached)

echo.
echo [0/4] Checking prerequisites...
where node >nul 2>nul
if errorlevel 1 goto error_node
where yarn >nul 2>nul
if errorlevel 1 goto error_yarn

echo Node:
node -v
echo Yarn:
call yarn -v

echo.
if "%DO_INSTALL%"=="1" goto do_install
echo [1/4] Skipping dependency install - node_modules and Electron are already cached.
echo        Force a fresh install with: rebuild.bat install
goto after_install

:do_install
echo [1/4] Installing dependencies (yarn install)...
call yarn install
if errorlevel 1 goto error_install

:after_install
if exist "app\node_modules\dugite\git" goto dugite_ok
echo.
echo [2/4] Embedded Git (dugite) is missing, fetching it...
node app\node_modules\dugite\script\download-git.js
if errorlevel 1 goto error_dugite

:dugite_ok
echo.
echo [3/4] Building (%BUILD_TARGET%)...
call yarn %BUILD_TARGET%
if errorlevel 1 goto error_build

echo.
echo ==============================================
echo  Done.
echo    out\   = webpack bundle
echo    dist\  = packaged app (run with: yarn start)
echo ==============================================
endlocal
pause
exit /b 0

:error_node
echo.
echo [ERROR] Node.js not found in PATH.
echo         Required: Node 24.19.0 (see .nvmrc)
pause
exit /b 1

:error_yarn
echo.
echo [ERROR] yarn not found in PATH.
pause
exit /b 1

:error_install
echo.
echo [ERROR] yarn install failed. See output above.
pause
exit /b 1

:error_dugite
echo.
echo [ERROR] dugite (embedded Git) download failed. See output above.
pause
exit /b 1

:error_build
echo.
echo [ERROR] %BUILD_TARGET% failed. See output above.
pause
exit /b 1
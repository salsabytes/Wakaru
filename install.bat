@echo off
setlocal EnableDelayedExpansion
title Wakaru installer
cd /d "%~dp0"

echo.
echo   ✨ Wakaru — one-shot installer (Windows)
echo.

REM --- Git ---
where git >nul 2>&1
if errorlevel 1 (
  echo [1/5] Installing Git...
  winget install -e --accept-source-agreements --accept-package-agreements --id Git.Git >nul
  if errorlevel 1 (
    echo   Git install failed - install it from https://git-scm.com and re-run
    exit /b 1
  )
) else (
  echo [1/5] Git found
)

REM --- Bun ---
where bun >nul 2>&1
if errorlevel 1 (
  echo [2/5] Installing Bun...
  winget install -e --accept-source-agreements --accept-package-agreements --id Oven-sh.Bun >nul
  if errorlevel 1 (
    echo   Bun install failed - install it from https://bun.sh and re-run
    exit /b 1
  )
) else (
  echo [2/5] Bun found
)

REM refresh PATH so freshly installed tools are visible
set "PATH=%USERPROFILE%\.bun\bin;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"

REM --- Clone ---
echo [3/5] Getting Wakaru...
if exist src\index.ts (
  echo   already inside the repo
) else (
  if not exist wakaru git clone https://github.com/salsabytes/Wakaru.git wakaru
  if errorlevel 1 (
    echo   clone failed
    exit /b 1
  )
  cd wakaru
)

REM --- Dependencies ---
echo [4/5] Installing dependencies...
bun install
if errorlevel 1 (
  echo   bun install failed
  exit /b 1
)

REM --- Sticker engine (needs Rust) ---
where cargo >nul 2>&1
if errorlevel 1 (
  echo   Installing Rust toolchain (needed for the sticker engine)...
  winget install -e --accept-source-agreements --accept-package-agreements --id Rustlang.Rustup >nul
  set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)
echo [5/5] Building sticker engine (first run takes a few minutes)...
REM build:sticker needs bash (Git) and ships the MinGW DLLs next to the exe
set "PATH=%ProgramFiles%\Git\bin;%ProgramFiles(x86)%\Git\bin;%PATH%"
call bun run build:sticker
if errorlevel 1 (
  echo   sticker build failed - bot still works without it
) else (
  echo   sticker engine built
)

echo.
echo   ✨ All set - starting Wakaru!
echo   (keep this window open while the bot runs)
echo.
call bun run start
pause

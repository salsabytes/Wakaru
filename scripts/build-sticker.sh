#!/usr/bin/env bash
# Build the sticker binary and, on Windows, ship the MinGW runtime DLLs next
# to it. sticker.exe links libstdc++ dynamically; without the DLLs beside the
# exe it dies with 0xC0000135 (STATUS_DLL_NOT_FOUND) when the bot runs without
# msys64/Git-mingw in PATH (e.g. started from install.bat or a service).
set -e
cd native/sticker
cargo build --release
mkdir -p ../../bin
if [ -f target/release/wakaru-sticker.exe ]; then
  cp target/release/wakaru-sticker.exe ../../bin/sticker.exe
  for d in /c/msys64/mingw64/bin "/c/Program Files/Git/mingw64/bin" \
           ~/.rustup/toolchains/*/lib/rustlib/x86_64-pc-windows-gnu/bin; do
    if [ -f "$d/libstdc++-6.dll" ]; then
      cp "$d/libstdc++-6.dll" "$d/libgcc_s_seh-1.dll" "$d/libwinpthread-1.dll" ../../bin/ 2>/dev/null || true
      break
    fi
  done
else
  cp target/release/wakaru-sticker ../../bin/sticker
fi

#!/usr/bin/env bash
# Wakaru — one-shot installer.
# Termux (Android), Linux, macOS, and Windows (Git Bash / WSL).
# Re-runnable: skips whatever is already there. Works both as
#   curl -fsSL <url> | bash     (installs into ./wakaru)
#   ./install.sh                (already inside the repo — installs in place)
set -euo pipefail

REPO="https://github.com/salsabytes/Wakaru.git"
IS_TERMUX=0
[ -d /data/data/com.termux/files/usr ] && IS_TERMUX=1

# --- charmbracelet-ish palette ---
R='\033[0m'; B='\033[1m'; M='\033[2m'
PINK='\033[1;38;5;213m'; PURPLE='\033[1;38;5;141m'
GREEN='\033[1;38;5;114m'; YELLOW='\033[1;38;5;228m'; RED='\033[1;38;5;203m'

line() { printf "${M}────────────────────────────────────────${R}\n"; }
mute() { printf "${M}%s${R}\n" "$*"; }
step() { printf "\n${PINK}◆ ${B}%s${R}\n" "$*"; }
ok()   { printf "  ${GREEN}✔${R} %s\n" "$*"; }
skip() { printf "  ${YELLOW}⚠${R} %s\n" "$*"; }

has() { command -v "$1" >/dev/null 2>&1; }

node_ok() {
  has node && node -e "const [m,p]=process.versions.node.split('.').map(Number); process.exit(m>23||(m===23&&p>=6)?0:1)" 2>/dev/null
}

printf "${PURPLE}${B}  ✨ Wakaru — one-shot installer${R}\n"
mute "  Termux · Linux · macOS · Windows (Git Bash/WSL)"
line

# --- runtime: bun if present, else node >= 23.6, else install one ---
step "Runtime"
use_bun=0
if has bun; then
  ok "Bun found — using it for the fastest installs"
  use_bun=1
elif node_ok; then
  ok "Node $(node -v) found"
else
  mute "installing a runtime..."
  if [ "$IS_TERMUX" = 1 ]; then
    pkg update -y && pkg install -y nodejs-lts
  elif has winget; then
    winget install -e --id Oven-sh.Bun
  elif has brew; then
    brew install oven-sh/bun/bun
  else
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  if has bun; then use_bun=1; ok "Bun installed"; else ok "runtime ready"; fi
fi

# --- optional bun upgrade (opt-in: WAKARU_BUN_UPGRADE=canary|stable|latest) ---
if [ "$use_bun" = 1 ] && [ -n "${WAKARU_BUN_UPGRADE:-}" ]; then
  case "$WAKARU_BUN_UPGRADE" in
    canary|stable)
      step "Bun upgrade"
      mute "running bun upgrade --${WAKARU_BUN_UPGRADE}..."
      bun upgrade "--${WAKARU_BUN_UPGRADE}"
      ;;
    latest)
      step "Bun upgrade"
      mute "running bun upgrade..."
      bun upgrade
      ;;
    *) skip "WAKARU_BUN_UPGRADE must be canary|stable|latest — skipped" ;;
  esac
fi

# --- yt-dlp + ffmpeg (soft-fail: bot still works without them) ---
step "Tools"
install_pkg() { # $1 = binary, $2 = winget id, $3 = brew formula
  if has "$1"; then ok "$1 already installed"; return 0; fi
  mute "installing $1..."
  if [ "$IS_TERMUX" = 1 ]; then pkg install -y "$1"
  elif has winget; then winget install -e --id "$2"
  elif has brew; then brew install "$3"
  elif has apt-get; then (sudo apt-get install -y "$1" || apt-get install -y "$1") 2>/dev/null
  elif [ "$1" = yt-dlp ]; then python3 -m pip install -U yt-dlp
  else skip "$1 skipped — no package manager found"; return 0
  fi
  if has "$1"; then ok "$1 installed"; else skip "$1 install failed — bot still works without it"; fi
}
install_pkg yt-dlp yt-dlp.yt-dlp yt-dlp || true
install_pkg ffmpeg Gyan.FFmpeg ffmpeg || true

# --- clone or install in place ---
step "Wakaru"
if [ -f src/index.ts ]; then
  DIR=.
  ok "inside the repo — installing in place"
else
  if [ ! -d wakaru ]; then
    mute "cloning..."
    git clone "$REPO" wakaru
  else
    ok "wakaru/ already present"
  fi
  DIR=wakaru
  cd wakaru
fi

# --- dependencies ---
step "Dependencies"
if [ "$use_bun" = 1 ]; then bun install; else npm install; fi
ok "dependencies installed"

# --- sticker engine (soft-fail: bot still works without it) ---
step "Sticker engine"
build_sticker() {
  if [ -x bin/sticker ] || [ -x bin/sticker.exe ]; then
    ok "already built (bin/sticker)"
    return 0
  fi
  if ! has cargo; then
    if [ "$IS_TERMUX" = 1 ]; then mute "installing rust..."; pkg install -y rust
    elif has winget; then mute "installing rust..."; winget install -e --id Rustlang.Rustup
    elif has brew; then mute "installing rust..."; brew install rust
    else skip "no Rust found — skipped (bot still works)"; return 0
    fi
  fi
  mute "building (a few minutes on first run)..."
  if (cd native/sticker && cargo build --release); then
    mkdir -p bin
    if [ -f native/sticker/target/release/wakaru-sticker.exe ]; then
      cp native/sticker/target/release/wakaru-sticker.exe bin/sticker.exe
    else
      cp native/sticker/target/release/wakaru-sticker bin/sticker && chmod +x bin/sticker
    fi
    ok "built (bin/sticker)"
  else
    skip "build failed — bot still works without it"
  fi
}
build_sticker

# --- done ---
line
printf "  ${PURPLE}${B}✨ All set — Wakaru is ready!${R}\n"
mute "  next:"
printf "    ${B}cd ${DIR}${R}\n"
printf "    ${B}bun run start${R}          ${M}# or: node src/index.ts${R}\n"
printf "    ${B}bun run start:pairing${R}  ${M}# pairing code instead of QR${R}\n"
mute "  tip: keep bun fresh — WAKARU_BUN_UPGRADE=canary ./install.sh (desktop only)"

#!/usr/bin/env bash
# Wakaru — one-shot installer for Termux, Linux, macOS, and Windows (Git Bash/WSL).
# Works as `curl -fsSL <url> | bash` (installs into ./wakaru) or `./install.sh` (in place).
set -euo pipefail

REPO="https://github.com/salsabytes/Wakaru.git"
IS_TERMUX=0
[ -d /data/data/com.termux/files/usr ] && IS_TERMUX=1

R='\033[0m'; B='\033[1m'; M='\033[2m'
PINK='\033[1;38;5;213m'; PURPLE='\033[1;38;5;141m'
GREEN='\033[1;38;5;114m'; YELLOW='\033[1;38;5;228m'; RED='\033[1;38;5;203m'

line() { printf "${M}────────────────────────────────────────${R}\n"; }
mute() { printf "${M}%s${R}\n" "$*"; }
step() { printf "\n${PINK}◆ ${B}%s${R}\n" "$*"; }
ok()   { printf "  ${GREEN}✔${R} %s\n" "$*"; }
skip() { printf "  ${YELLOW}⚠${R} %s\n" "$*"; }

has() { command -v "$1" >/dev/null 2>&1; }

# winget prompts for source/package agreements on first use — accept silently (CI-safe)
winget_install() { winget install -e --accept-source-agreements --accept-package-agreements --id "$1"; }

node_ok() {
  has node && node -e "const [m,p]=process.versions.node.split('.').map(Number); process.exit(m>23||(m===23&&p>=6)?0:1)" 2>/dev/null
}

printf "${PURPLE}${B}  ✨ Wakaru — one-shot installer${R}\n"
mute "  Termux · Linux · macOS · Windows (Git Bash/WSL)"
line

step "Prerequisites"
prereq() {
  local bin="$1"
  if has "$bin"; then ok "$bin found"; return 0; fi
  mute "installing $bin..."
  if [ "$IS_TERMUX" = 1 ]; then pkg install -y "$bin" || true
  elif has winget && [ "$bin" = git ]; then winget_install Git.Git || true
  elif has brew; then brew install "$bin" || true
  elif has apt-get; then (sudo apt-get install -y "$bin" || apt-get install -y "$bin") 2>/dev/null || true
  fi
  if has "$bin"; then ok "$bin installed"; else skip "$bin install failed — install it manually"; fi
}
prereq git
prereq curl

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
    winget_install Oven-sh.Bun
  elif has brew; then
    brew install oven-sh/bun/bun
  else
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  if has bun; then use_bun=1; ok "Bun installed"; else ok "runtime ready"; fi
fi

# Termux: force bun in too (npm -g works on aarch64); skip keeps Node if it fails
if [ "$IS_TERMUX" = 1 ] && ! has bun; then
  mute "forcing Bun into Termux via npm..."
  npm install -g bun || skip "bun install failed — using Node"
  if has bun; then use_bun=1; ok "Bun installed"; fi
fi

if [ "$use_bun" = 1 ]; then
  step "Bun upgrade"
  mute "running bun upgrade --canary..."
  # brew/winget/npm-managed installs can refuse (EROFS) — the installed bun still works, keep going
  bun upgrade --canary || skip "bun upgrade failed — continuing with installed bun"
fi



step "Wakaru"
if [ -f src/index.ts ]; then
  DIR=.
  ok "inside the repo — installing in place"
else
  if [ ! -d wakaru ]; then
    if ! has git; then
      skip "git is missing — install git, then re-run"
      exit 1
    fi
    mute "cloning..."
    git clone "$REPO" wakaru
  else
    ok "wakaru/ already present"
  fi
  DIR=wakaru
  cd wakaru
fi

step "Dependencies"
if [ "$use_bun" = 1 ]; then bun install; else npm install; fi
ok "dependencies installed"

step "Engines (sticker)"
build_engine() {
  local crate="$1" binary="$2" out="$3"
  if [ -x "bin/$out" ] || [ -x "bin/$out.exe" ]; then
    ok "already built (bin/$out)"
    return 0
  fi
  if ! has cargo; then
    if [ "$IS_TERMUX" = 1 ]; then mute "installing rust..."; pkg install -y rust
    elif has winget; then mute "installing rust..."; winget_install Rustlang.Rustup
    elif has brew; then mute "installing rust..."; brew install rust
    else skip "no Rust found — skipped (bot still works)"; return 0
    fi
  fi
  mute "building (a few minutes on first run)..."
  if (cd "$crate" && cargo build --release); then
    mkdir -p bin
    if [ -f "$crate/target/release/$binary.exe" ]; then
      cp "$crate/target/release/$binary.exe" "bin/$out.exe"
    else
      cp "$crate/target/release/$binary" "bin/$out" && chmod +x "bin/$out"
    fi
    ok "built (bin/$out)"
  else
    skip "build failed — bot still works without it"
  fi
}
build_engine native/sticker wakaru-sticker sticker
build_engine native/audio wakaru-audio audio

line
printf "  ${PURPLE}${B}✨ All set — Wakaru is ready!${R}\n"
mute "  next:"
printf "    ${B}cd ${DIR}${R}\n"
printf "    ${B}bun run start${R}          ${M}# or: node src/index.ts${R}\n"
printf "    ${B}bun run start:pairing${R}  ${M}# pairing code instead of QR${R}\n"
mute "  tip: bun is kept on the latest canary automatically (falls back to Node)"

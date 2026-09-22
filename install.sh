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

ver_ok() {
  "$1" -e "const [m,p]=process.versions.node.split('.').map(Number); process.exit(m>23||(m===23&&p>=6)?0:1)" 2>/dev/null
}
node_ok() {
  has node && ver_ok node
}

# after a fresh install the shell may still resolve a stale/shadowed node
# (e.g. CI runners keep an old node earlier in PATH) — re-hash and prefer
# a good binary if several exist
refresh_node() {
  hash -r 2>/dev/null || true
  node_ok && return 0
  for cand in /usr/local/bin/node /usr/bin/node; do
    if [ -x "$cand" ] && ver_ok "$cand"; then
      export PATH="$(dirname "$cand"):$PATH"
      hash -r 2>/dev/null || true
      return 0
    fi
  done
  return 1
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

step "Runtime (Node >= 23.6)"
if node_ok; then
  ok "Node $(node -v) found"
else
  mute "installing Node 24 LTS..."
  if [ "$IS_TERMUX" = 1 ]; then
    pkg update -y || true
    pkg install -y nodejs-lts || pkg install -y nodejs || true
  elif has winget; then
    winget_install OpenJS.NodeJS.LTS || true
  elif has brew; then
    brew install node || true
  elif has apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - 2>/dev/null \
      || curl -fsSL https://deb.nodesource.com/setup_24.x | bash 2>/dev/null || true
    (sudo apt-get install -y nodejs || apt-get install -y nodejs) 2>/dev/null || true
  else
    skip "no supported installer — install Node >= 23.6 manually from https://nodejs.org"
  fi
  refresh_node || true
  if node_ok; then ok "Node $(node -v) installed"
  else
    skip "Node >= 23.6 not found after install — install it manually from https://nodejs.org"
    exit 1
  fi
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
npm install
ok "dependencies installed"

# .ai primary backend needs python3 + curl_cffi — missing pieces only
# knock out the sidecar, the poolside fallback still answers.
step "AI sidecar (chatgpt-anon)"
if has python3; then
  python3 -m pip install --quiet curl_cffi 2>/dev/null \
    && ok "curl_cffi installed" \
    || skip "curl_cffi install failed - .ai falls back to poolside"
else
  skip "python3 missing - .ai falls back to poolside"
fi

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
    else
      # containers (Pterodactyl etc.) have no apt/root — rustup installs per-user, no sudo needed
      mute "installing rust via rustup (~/.cargo, no root)..."
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
      export PATH="$HOME/.cargo/bin:$PATH"
      if ! has cargo; then skip "no Rust found — skipped (bot still works)"; return 0; fi
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
printf "    ${B}npm run start${R}          ${M}# or: node src/index.ts${R}\n"
printf "    ${B}npm run start:pairing${R}  ${M}# pairing code instead of QR${R}\n"
mute "  tip: needs Node >= 23.6 (type-stripping, no build step)"

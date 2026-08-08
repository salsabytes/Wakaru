#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
done_m() { echo -e "\033[1;32m==> $*\033[0m"; }

say "Installing Termux prerequisites..."
apt update && apt upgrade -y
apt install -y git curl clang make python pacman patchelf
if ! command -v grun >/dev/null 2>&1; then
  say "Setting up glibc + glibc-runner via pacman (needed by bun-termux)..."
  apt install -y termux-keyring
  pacman-key --init 2>/dev/null || true
  # silence the "unsafe permissions on homedir" gpg warning
  chmod 700 "$PREFIX/etc/pacman.d/gnupg" 2>/dev/null || true
  pacman-key --populate 2>/dev/null || true
  pacman-db-upgrade 2>/dev/null || true
  # pacman-key --add/--import only take keyring dirs; if the org key is still
  # missing, feed the pubkey straight into gpg
  if ! pacman-key --list-keys 998DE27318E867EA976BA877389CEED64573DFCA >/dev/null 2>&1; then
    curl -fsSL --max-time 30 "https://raw.githubusercontent.com/termux-pacman/termux-packages/master/packages/termux-keyring/termux-pacman.gpg" -o "${TMPDIR:-$HOME}/wakaru-termux-pacman.gpg"
    gpg --homedir "$PREFIX/etc/pacman.d/gnupg" --batch --import "${TMPDIR:-$HOME}/wakaru-termux-pacman.gpg"
    pacman-key --lsign-key 998DE27318E867EA976BA877389CEED64573DFCA 2>/dev/null || true
    rm -f "${TMPDIR:-$HOME}/wakaru-termux-pacman.gpg"
  fi
  cat > "${TMPDIR:-$HOME}/wakaru-gpkg.conf" <<'EOF'
[options]
Architecture = auto
SigLevel = Required
[gpkg]
# pacman tries these in order and falls back on failure (the primary server
# has been returning 403 under load, so the mirrors below keep glibc installs working)
Server = https://service.termux-pacman.dev/gpkg/$arch
Server = https://ftp.agdsn.de/termux-pacman/gpkg/$arch
Server = https://mirror.clarkson.edu/termux-pacman/gpkg/$arch
EOF
  pacman --config "${TMPDIR:-$HOME}/wakaru-gpkg.conf" -Sy --needed --noconfirm --assume-installed bash,patchelf,resolv-conf glibc glibc-runner ||
    { echo "glibc setup gagal - kalau masih error, ganti bootstrap ke pacman: wiki.termux.com/wiki/Switching_package_manager" >&2; exit 1; }
fi
python -m pip install -U yt-dlp

BTM_URL="https://raw.githubusercontent.com/Happ1ness-dev/bun-termux/main/helper_scripts/bun-termux-manager"
if ! command -v bun >/dev/null 2>&1; then
  say "Installing Bun for Termux (bun-termux-manager)..."
  # bun >= 1.3 requires kernel >= 5.1; on older kernels (most Android < 12)
  # it SIGABRTs via seccomp (pidfd_open), so try a pre-1.3 build first.
  for v in 1.2.23 latest; do
    if curl -fsSL "$BTM_URL" | bash -s install --bun-version "$v"; then
      break
    fi
    echo "  bun $v tidak bisa jalan di perangkat ini..." >&2
  done
fi
export PATH="$HOME/.bun/bin:$PATH"
if command -v bun >/dev/null 2>&1; then
  done_m "Bun: $(bun --version)"
  RUN_START="bun run start"
  RUN_PAIR="bun run start:pairing"
else
  say "Bun tidak kompatibel dengan perangkat ini - pakai Node (jalur resmi di HP)..."
  apt install -y nodejs-lts
  RUN_START="node src/index.ts"
  RUN_PAIR="node src/index.ts --use-pairing-code"
fi

REPO="https://github.com/salsabytes/Wakaru.git"
if [ ! -d wakaru ]; then
  say "Cloning Wakaru..."
  git clone "$REPO" wakaru
fi

say "Installing dependencies..."
cd wakaru
if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install
fi

say "Building the native sticker engine (Rust, a few minutes on first run)..."
apt install -y rust
cd native/sticker
if cargo build --release; then
  cd ../..
  mkdir -p bin
  cp native/sticker/target/release/wakaru-sticker bin/sticker
  chmod +x bin/sticker
  done_m "Sticker engine built"
else
  cd ../..
  echo "sticker engine build skipped (bot still works)" >&2
fi

done_m "All set! Start the bot:"
echo "   cd wakaru"
echo "   $RUN_START          # scan QR"
echo "   $RUN_PAIR   # or use a pairing code"

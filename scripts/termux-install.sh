#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
done_m() { echo -e "\033[1;32m==> $*\033[0m"; }

say "Installing Termux prerequisites..."
apt update && apt upgrade -y
apt install -y git curl clang make python pacman patchelf
if ! command -v grun >/dev/null 2>&1; then
  say "Setting up glibc + glibc-runner via pacman (needed by bun-termux)..."
  pacman-key --init 2>/dev/null || true
  pacman-key --populate 2>/dev/null || true
  pacman-db-upgrade 2>/dev/null || true
  # org signing key is not in a reachable keyserver; pull it straight from the repo
  if ! pacman-key --list-keys 998DE27318E867EA976BA877389CEED64573DFCA >/dev/null 2>&1; then
    curl -fsSL --max-time 30 "https://raw.githubusercontent.com/termux-pacman/termux-packages/master/packages/termux-keyring/termux-pacman.gpg" -o "${TMPDIR:-$HOME}/wakaru-termux-pacman.gpg"
    pacman-key --import "${TMPDIR:-$HOME}/wakaru-termux-pacman.gpg"
    pacman-key --lsign-key 998DE27318E867EA976BA877389CEED64573DFCA
    rm -f "${TMPDIR:-$HOME}/wakaru-termux-pacman.gpg"
  fi
  cat > "${TMPDIR:-$HOME}/wakaru-gpkg.conf" <<'EOF'
[options]
Architecture = auto
SigLevel = Required
[gpkg]
Server = https://service.termux-pacman.dev/gpkg/$arch
EOF
  pacman --config "${TMPDIR:-$HOME}/wakaru-gpkg.conf" -Sy --needed --noconfirm --assume-installed bash,patchelf,resolv-conf glibc glibc-runner ||
    { echo "glibc setup gagal - kalau masih error, ganti bootstrap ke pacman: wiki.termux.com/wiki/Switching_package_manager" >&2; exit 1; }
fi
python -m pip install -U yt-dlp

if ! command -v bun >/dev/null 2>&1; then
  say "Installing Bun for Termux (bun-termux-manager)..."
  curl -fsSL "https://raw.githubusercontent.com/Happ1ness-dev/bun-termux/main/helper_scripts/bun-termux-manager" | bash -s install
fi
export PATH="$HOME/.bun/bin:$PATH"
command -v bun >/dev/null 2>&1 || { echo "bun not found after install" >&2; exit 1; }
done_m "Bun: $(bun --version)"

REPO="https://github.com/salsabytes/Wakaru.git"
if [ ! -d wakaru ]; then
  say "Cloning Wakaru..."
  git clone "$REPO" wakaru
fi

say "Installing dependencies..."
cd wakaru
bun install

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
echo "   bun run start            # scan QR"
echo "   bun run start:pairing    # or use a pairing code"

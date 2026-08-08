#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
done_m() { echo -e "\033[1;32m==> $*\033[0m"; }

say "Installing Termux prerequisites..."
pkg update -y
pkg install -y git curl clang make glibc-repo python
pkg install -y glibc-runner
# yt-dlp powers the ytmp3 downloader command — part of the bot, not optional
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
pkg install -y rust
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
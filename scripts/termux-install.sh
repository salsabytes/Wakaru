#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
done_m() { echo -e "\033[1;32m==> $*\033[0m"; }

say "Installing Termux prerequisites..."
apt update && apt upgrade -y
apt install -y git curl clang make python nodejs-lts
python -m pip install -U yt-dlp

REPO="https://github.com/salsabytes/Wakaru.git"
if [ ! -d wakaru ]; then
  say "Cloning Wakaru..."
  git clone "$REPO" wakaru
fi

say "Installing dependencies..."
cd wakaru
npm install

say "Building the native sticker engine (Rust, a few minutes on first run)..."
if apt install -y rust && (cd native/sticker && cargo build --release) && [ -f native/sticker/target/release/wakaru-sticker ]; then
  mkdir -p bin
  cp native/sticker/target/release/wakaru-sticker bin/sticker
  chmod +x bin/sticker
  done_m "Sticker engine built"
else
  echo "sticker engine build skipped (bot still works)" >&2
fi

done_m "All set! Start the bot:"
echo "   cd wakaru"
echo "   node src/index.ts          # scan QR"
echo "   node src/index.ts --use-pairing-code   # or use a pairing code"

#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
done_m() { echo -e "\033[1;32m==> $*\033[0m"; }

say "Installing Termux prerequisites..."
apt update && apt upgrade -y
apt install -y git curl clang make python pacman
# glibc TIDAK ada di repo apt Termux: repo resmi cuma bionic (libc Android), dan
# bootstrap apt `glibc-repo` dari termux-pacman udah discontinued. Sekarang glibc
# cuma dirilis lewat pacman repo [gpkg] — makanya `apt install glibc-repo` selalu
# "Unable to locate package", dan ganti pkg->apt gak ngaruh (source-nya sama).
# bun-termux butuh glibc + glibc-runner (grun) di $PREFIX/glibc sebelum build Bun.
if ! command -v grun >/dev/null 2>&1; then
  say "Setting up glibc + glibc-runner via pacman (needed by bun-termux)..."
  pacman-key --init 2>/dev/null || true
  pacman-key --populate 2>/dev/null || true
  # apt-bundled pacman ships an old-format empty DB -> needs format upgrade before -S works
  pacman-db-upgrade 2>/dev/null || true
  # ponytail: --assume-installed skips file conflicts with apt's bash/patchelf/resolv-conf
  pacman -S --needed --noconfirm --assume-installed bash,patchelf,resolv-conf glibc glibc-runner ||
    { echo "glibc setup gagal - coba manual: pacman-db-upgrade && pacman -S --needed --noconfirm --assume-installed bash,patchelf,resolv-conf glibc glibc-runner" >&2; exit 1; }
fi
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

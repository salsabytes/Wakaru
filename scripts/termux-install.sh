#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

say()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
done_m() { echo -e "\033[1;32m==> $*\033[0m"; }

say "Installing Termux prerequisites..."
pkg update -y
pkg install -y git curl clang make glibc-repo python
pkg install -y glibc-runner

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

done_m "All set! Start the bot:"
echo "   cd wakaru"
echo "   bun run start            # scan QR"
echo "   bun run start:pairing    # or use a pairing code"
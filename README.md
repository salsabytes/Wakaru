# Wakaru ✨

*分かる* — "to understand".

A tiny WhatsApp bot with an **agentic AI** that understands you: chat normally, or let it
run commands for you — download audio/video, make stickers. Built on
[Baileys](https://github.com/whiskeysockets/Baileys) and TypeScript.
One codebase, two runtimes — run it on your desktop with **Bun**, or right from your phone with **Node**. 🫶

> 🚧 **Status:** still growing (work in progress). It connects, authenticates, auto-reconnects, runs a command system, and logs prettily. More replies come as we play together.

---

## Features

- 🔐 Authenticate via QR code or pairing code
- 🔁 Auto-reconnect with exponential backoff
- 🤖 Agentic AI (`.ai`): chat normally, or have it run any command with `@run:` — with per-chat memory
- ⬇️ Downloader commands: `.ytmp3` (audio), `.ytmp4` (video) via yt-dlp
- 🧩 Command system: drop a file in `src/commands/<category>/` and it's live — no registry to edit
- ✨ `.menu` command that lists every registered command
- 🎨 Pretty charmbracelet-style console logger (clock-only timestamp)
- 📱 One codebase runs on **Bun** (desktop) and **Node ≥ 23.6** (phone)

## Quick start

**Desktop (Bun):**

```bash
bun install
bun run start            # scan QR
bun run start:pairing    # or use a pairing code
```

**Phone / Termux:**

Easiest — one-liner installs Node + Wakaru + deps:

```bash
pkg install -y curl && \
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/scripts/termux-install.sh | bash
```

Or the plain Node path:

```bash
pkg update && pkg install nodejs-lts
git clone https://github.com/salsabytes/Wakaru.git && cd wakaru
npm install
node src/index.ts                 # scan QR
node src/index.ts --use-pairing-code
```

Node ≥ 23.6 runs the TypeScript files directly — no `tsx`, no build step.

### Can Bun run on Termux?

Officially no: Bun ships no Android binaries. Community builds exist — the maintained one is [Happ1ness-dev/bun-termux](https://github.com/Happ1ness-dev/bun-termux), a native glibc-runner wrapper with no root/proot. It's unofficial, needs kernel ≥ 5.1 on newer Bun versions, and can break on Bun updates. `scripts/termux-install.sh` therefore installs Node — the boring, safe path that works on every device. Want Bun anyway? Install it manually and run `bun install && bun run start`.

### Why `npm install` doesn't pull in `sharp`

`sharp` (an image library, a peer of baileys) has no Android prebuilt — npm would try to compile libvips from source on Termux and fail the whole install. The repo's `.npmrc` sets `omit=peer`, so the install goes through. Trade-off: baileys' own link-preview thumbnails don't work; media features (stickers) use the repo's own Rust sidecar instead, which cross-compiles cleanly for Android.

## Commands

```
.ai      — chat or run any command (owner only, e.g. ".ai make a sticker from the last image")
.menu    — list all available commands
.ytmp3   — download audio (mp3) from a video link
.ytmp4   — download video (mp4) from a video link
.sticker — make a sticker from a quoted photo or video
```

`.ytmp3`/`.ytmp4` need `yt-dlp` on PATH (+ `ffmpeg` for mp3 extraction): `winget install yt-dlp.yt-dlp ffmpeg` on Windows, `apt install yt-dlp ffmpeg` on Linux, `pkg install yt-dlp ffmpeg` on Termux.

### Native sticker engine

`.sticker` shells out to a small Rust sidecar (`native/sticker/`) that turns media into 512×512 webp stickers — fast and low-RAM. Photos become still stickers; videos become animated ones (H.264 mp4, first 8 seconds, auto-compressed to stay under WhatsApp's 100KB limit). All codecs are compiled in — no ffmpeg needed. Build it once per platform:

```bash
bun run build:sticker          # desktop: puts the binary in bin/
```

On Termux, `scripts/termux-install.sh` builds it for you on-device (installs `rust`, compiles once — takes a few minutes). The binary is gitignored either way.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_DIR` | `sessions` | Folder where the login session is stored |
| `PAIRING_CODE` | — | Set to `1` to use a pairing code |

Or pass the flag: `--use-pairing-code`.

Owner commands (`.ai`): edit `config.json` (gitignored) at the project root and list
phone numbers in `"owners"` — bare number (`628123...`) or full JID. Empty list =
owner commands disabled.

```json
{
  "owners": ["6281234567890"]
}
```

## Project structure

```
src/
├── index.ts             # socket config, connect, connection handler, shutdown
├── lib/                 # shared helpers (no deps beyond stdlib)
│   ├── logger.ts        # charmbracelet-style console logger
│   ├── store.ts         # in-memory message store (getMessage for baileys)
│   ├── config.ts        # owner list from config.json
│   ├── llm.ts           # free chateverywhere backend client for .ai
│   ├── simple.ts        # WAMessage -> flat SerializedMessage
│   └── downloader.ts    # yt-dlp wrapper (mp3/mp4)
├── commands/
│   ├── index.ts         # command loader + types + PREFIX
│   └── <category>/      # one file per command, auto-scanned
└── handlers/
    └── messages.ts      # messages.upsert handler (log + dispatch)
```

## Notes

- Never run two instances sharing the same `sessions/` folder — they'll kick each other (status `440`, `connectionReplaced`).
- Logged out? Delete `sessions/` and scan again.
- `sessions/` is gitignored — credentials never reach the repo.
- Keep the phone awake with `termux-wake-lock` when hosting on Termux.

## Roadmap

- [ ] More commands
- [ ] GIF → animated sticker (reuses the video engine's animated webp path)
- [ ] Poll updates and chat status handling

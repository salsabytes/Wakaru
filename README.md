# Wakaru ✨

*分かる — "to understand."*

A small WhatsApp bot with an agentic brain: talk to it and it talks back —
or let it do things for you. It pulls songs, saves videos, and turns your
photos into stickers. Built on [Baileys](https://github.com/whiskeysockets/Baileys)
and TypeScript. One codebase, two runtimes — **Bun** on desktop, **Node** on your phone. 🫶

---

## Features

- 🧠 **It gets you** — `.ai` chats naturally, and can run commands on its own with `@run:`, remembering each chat
- 🎬 **Plays with media** — pulls audio from a link, saves videos, makes stickers from photos & videos
- 🧩 **Extensible** — drop a file in `src/commands/<category>/` and it's live; no registry to edit
- 🔁 **Never leaves you hanging** — auto-reconnects with exponential backoff
- 🔐 **Easy in** — log in with a QR code or a pairing code
- 🎨 **Prettily logged** — charmbracelet-style console output, clock-only timestamp

## Quick start

**Desktop (Bun):**

```bash
bun install
bun run start            # scan QR
bun run start:pairing    # or use a pairing code
```

**Any platform — one-liner (Termux, Linux, macOS, Windows Git Bash/WSL):**

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && bun run start
```

It installs the runtime (Bun on desktop, Node on Termux), dependencies, and builds
the native sticker engine — no manual steps. Re-running also updates Bun to the
latest canary automatically (Termux runs Node instead).

Node ≥ 23.6 runs the TypeScript files directly — no `tsx`, no build step.

### Can Bun run on Termux?

Officially no: Bun ships no Android binaries. Community builds exist — the maintained one is [Happ1ness-dev/bun-termux](https://github.com/Happ1ness-dev/bun-termux), a native glibc-runner wrapper with no root/proot. It's unofficial, needs kernel ≥ 5.1 on newer Bun versions, and can break on Bun updates. `install.sh` therefore installs Node — the boring, safe path that works on every device. Want Bun anyway? Install it manually and run `bun install && bun run start`.

### Why `npm install` doesn't pull in `sharp`

`sharp` (an image library, a peer of baileys) has no Android prebuilt — npm would try to compile libvips from source on Termux and fail the whole install. The repo's `.npmrc` sets `omit=peer`, so the install goes through. Trade-off: baileys' own link-preview thumbnails don't work; media features (stickers) use the repo's own Rust sidecar instead, which cross-compiles cleanly for Android.

## Commands

The bot maintains its own command list — send **`.menu`** in WhatsApp and it shows every
command it can run, generated fresh from `src/commands/`. Drop a new file there and it
shows up in `.menu` automatically, so this README never needs updating for new commands.

Downloads resolve through the pure-TS scraper — no yt-dlp, no ffmpeg, no Python, no self-host. `.ytmp3` (audio) and `.ytmp4` (video) go through the free ytmp3.mobi converter: paste a YouTube link, get the file (mp3 / mp4). `.tiktok` grabs a TikTok video without a watermark via tiktokdownloaderr.id.

### Native engines

`.sticker` shells out to a small Rust sidecar (`native/sticker/`) that turns media into 512×512 webp stickers — fast and low-RAM. Photos become still stickers; videos become animated ones (H.264 mp4, first 8 seconds, auto-compressed to stay under WhatsApp's 100KB limit). All codecs are compiled in — no ffmpeg needed. Build it once per platform:

```bash
bun run build:sticker          # desktop: puts the binary in bin/
```

It's pure-Rust with zero system deps; `install.sh` builds it for you (installs Rust once, compiles on first run — a few minutes). The binary is gitignored.

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
│   └── scraper.ts       # pure-TS downloader (ytmp3.mobi — mp3/mp4, tiktokdownloaderr.id — tiktok)
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

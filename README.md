# Wakaru ✨

A tiny, friendly WhatsApp bot built on [Baileys](https://github.com/whiskeysockets/Baileys) and TypeScript.
One codebase, two runtimes — run it on your desktop with **Bun**, or right from your phone with **Node**. 🫶

> 🚧 **Status:** still growing (work in progress). It connects, authenticates, auto-reconnects, runs a command system, and logs prettily. More replies come as we play together.

---

## Features

- 🔐 Authenticate via QR code or pairing code
- 🔁 Auto-reconnect with exponential backoff
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

Easiest — one-liner installs Bun + Wakaru + deps:

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

Officially no: Bun ships no Android binaries. Community builds exist — the maintained one is [Happ1ness-dev/bun-termux](https://github.com/Happ1ness-dev/bun-termux), a native glibc-runner wrapper with no root/proot. It's unofficial and can break on Bun updates; Node is the boring, safe path on phones.

### Why `npm install` doesn't pull in `sharp`

`sharp` (an image library, a peer of baileys) has no Android prebuilt — npm would try to compile libvips from source on Termux and fail the whole install. The repo's `.npmrc` sets `omit=peer`, so the install goes through. Trade-off: no media thumbnails yet (the bot is text-only; when media lands, baileys' pure-JS `jimp` fallback covers Termux without native builds).

## Commands

```
.menu  — list all available commands
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_DIR` | `sessions` | Folder where the login session is stored |
| `PAIRING_CODE` | — | Set to `1` to use a pairing code |

Or pass the flag: `--use-pairing-code`.

## Project structure

```
src/
├── index.ts             # socket config, connect, connection handler, shutdown
├── logger.ts            # charmbracelet-style console logger (no deps)
├── store.ts             # in-memory message store (getMessage for baileys)
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

- [ ] AI agent that writes its own commands
- [ ] More commands
- [ ] Sending media (needs `jimp` for thumbnails on Termux)
- [ ] Poll updates and chat status handling

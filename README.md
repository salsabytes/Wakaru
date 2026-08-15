<div align="center">

# ✨ Wakaru

**分かる — *"to understand."***

A tiny WhatsApp bot with an agentic brain. It talks back, pulls songs,
saves videos, and turns your photos into stickers — all through one
command list you can grow yourself.

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-7DD3FC?style=for-the-badge&logo=typescript&logoColor=0F172A)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1E293B?style=for-the-badge&logo=bun&logoColor=FDE68A)](https://bun.sh/)
[![Rust](https://img.shields.io/badge/Rust%20sidecar-D97706?style=for-the-badge&logo=rust&logoColor=white)](native/sticker)
[![CodeFactor](https://img.shields.io/codefactor/grade/github/salsabytes/wakaru/master?style=for-the-badge&logo=codefactor&logoColor=white&label=CodeFactor)](https://www.codefactor.io/repository/github/salsabytes/wakaru)

</div>

---

## 🧠 What is Wakaru?

Wakaru is a **self-hosted WhatsApp bot** built on
[Baileys](https://github.com/whiskeysockets/Baileys) and TypeScript — no
yt-dlp, no ffmpeg, no Python, no self-hosted servers. Everything resolves
through pure-TS scrapers and one tiny Rust sidecar.

One codebase, three runtimes: **Bun** on desktop, **Bun or Node ≥ 23.6** on
Termux, and a one-line installer for every platform. Chat with it, or let
it *do* things for you.

<div align="center">

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## ✨ Features

- 🧠 **It gets you** — `.ai` chats naturally, can run any command on its own with `@run:`, and remembers each conversation
- 🎬 **Plays with media** — pulls audio and video from links, searches YouTube by query, and makes stickers from photos & videos
- 🧩 **Extensible** — register a command in `src/commands/index.ts` and it shows up in `.menu` automatically
- 🔁 **Never leaves you hanging** — auto-reconnects with exponential backoff
- 🔐 **Easy in** — log in with a QR code or a pairing code
- 📱 **Runs on your phone** — first-class Termux support, no root needed
- 🎨 **Prettily logged** — charmbracelet-style console output, clock-only timestamps
- ⚡ **Fast & cheap** — every command runs in parallel (one global slot pool), per-user cooldown on heavy commands, 30 MB download cap, zero external services

---

## 📜 Commands

Send `.menu` in WhatsApp to see the live list. Aliases in parentheses.

| Command | Aliases | What it does |
|---|---|---|
| `.ai <msg>` | — | Agentic chat; can run commands via `@run:`, remembers each sender |
| `.menu` | `.help` | List every command |
| `.sticker` | `.st` | Quoted photo/video → 512×512 webp sticker (optional `.sticker <pack>|<author>` name) |
| `.ytmp3 <url>` | `.ytm`, `.music` | Any video link → mp3 audio |
| `.ytmp4 <url>` | `.ytv`, `.video` | Any video link → mp4 video |
| `.play <query>` | `.yt`, `.song` | Search YouTube → tap a result → pick mp3/mp4 |
| `.tiktok <url>` | `.tt`, `.ttdl` | TikTok video, no watermark |
| `.instagram <url>` | `.ig`, `.igdl` | IG reels, videos, photos & carousels, no watermark |
| `.facebook <url>` | `.fb`, `.fbdl` | Facebook video in HD |
| `.pinterest <url\|query>` | `.pin`, `.pins` | Images from a pin link, or a search query |
| `.x <url>` | `.twitter`, `.tw` | X (Twitter) video, no watermark |
| `.setlang <id\|en>` | `.lang`, `.bahasa` | Switch the bot's reply language (Indonesian/English) |

Multi-file results (IG carousels, Pinterest searches) are delivered to your
**private chat** so groups stay tidy.

---

## 🚀 Quick start

### One-liner (any platform)

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && bun run start
```

The installer detects your platform, installs the runtime, dependencies,
and builds the native sticker engine. Re-running it **keeps Bun on the
latest canary automatically** (`bun upgrade --canary`).

### Windows

Download [`install.bat`](install.bat), double-click it (or run it in
`cmd`). It installs Git + Bun (via `winget`), clones the repo, installs
dependencies, compiles the sticker engine, and starts the bot.

### Manual (Bun)

<details>
<summary>Show manual setup</summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
bun install
bun run build:sticker   # one-time: compile the Rust sticker engine
                        # (on Windows it also ships the MinGW DLLs next to the exe)

bun run start            # scan the QR with your phone
bun run start:pairing    # or use a pairing code
```

</details>

### Logging in

1. Run the bot — a **QR code** appears in the terminal
2. Open WhatsApp → *Settings → Linked devices → Link a device*
3. Scan. Session is saved to `sessions/` and reused on restart

Prefer a code? Run with `--use-pairing-code` or set `PAIRING_CODE=1`.

---

## 🔄 Updating

- Run **`.update`** (owner only) from WhatsApp — the bot backs up
  `config.json` + `sessions/`, pulls the latest code, reinstalls
dependencies, rebuilds the sticker engine, typechecks, and **restarts
itself**. On any failure it rolls back to the previous version.
- The bot also **checks for updates on every start** and logs when a new
  one is available.
- Channel: add `"updateChannel": "release"` to `config.json` to follow
  the latest release tag instead of `master` (the default).

---

## ⚙️ Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_DIR` | `sessions` | Folder where the login session is stored |
| `PAIRING_CODE` | — | Set to `1` to log in with a pairing code |
| `updateChannel` | `master` | `master` = follow the branch, `release` = follow the latest release tag |
| `IG_SESSIONID` | — | Optional fallback IG session cookie for `.instagram` stories when snapsave is down (use a burner account) |

**Owner commands (`.ai`):** create `config.json` (gitignored) at the project
root and list phone numbers in `"owners"` — bare number (`628123...`) or
full JID. An empty list disables owner commands.

The bot's reply language lives in the same file:

```json
{
  "owners": ["6281234567890"],
  "language": "id",
  "stickerPack": "Wakaru",
  "stickerAuthor": "buatan gweh"
}
```

`"language"` accepts `id` (Indonesian, the default) or `en`. You can also
switch it live from WhatsApp with `.setlang` — or just ask `.ai` to change
the language for you.

The `.ai` brain chats through **askgpt5.app — anonymous, free, zero setup**
(port of [AyGemuy's `askgpt5.js`](https://github.com/AyGemuy/api-wudysoft),
no API key, no Python, no cookies). On first use it auto-registers a random
guest account (valid 24h) and streams the reply. Nothing to configure — if
the session expires it re-registers automatically.

`"stickerPack"` / `"stickerAuthor"` are the default sticker name shown in
WhatsApp — override per sticker with `.sticker <pack>|<author>` (e.g.
`.sticker rawr|buatan gweh`).

---

## 🧰 Tech stack

<div align="center">

[![Skills](https://skillicons.dev/icons?i=ts,bun,nodejs,rust,githubactions)](https://skillicons.dev)

</div>

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** (canary) · Node ≥ 23.6 fallback | TypeScript runs directly — no build step, no `tsx` |
| WhatsApp protocol | **Baileys** | The battle-tested Web API client |
| Sticker engine | **Rust sidecar** | 512×512 webp, animated support, all codecs compiled in |
| Scrapers | **Pure TypeScript** | No yt-dlp / ffmpeg / Python — nothing to maintain |
| Logging | **pino** | Fast, structured, prettified |
| CI | **GitHub Actions** | Real installs tested on Ubuntu, macOS, Windows + simulated Termux |

---

## 📁 Project structure

<details>
<summary>Show source layout</summary>

```
src/
├── index.ts                 # entry: boot + signal handling
├── socket.ts                # Baileys connection lifecycle (reconnect, QR, pairing)
├── handlers/
│   └── messages.ts          # upsert → drop rules → dispatch
├── commands/
│   ├── index.ts             # static command registry + types
│   ├── main/                # ai/ (prompt, tools, exchange), menu, setlang
│   ├── downloader/          # ytmp3, ytmp4, play, tiktok, instagram, facebook, pinterest
│   └── converter/sticker.ts
└── lib/
    ├── scrapers/            # one module per platform + shared http helpers
    ├── queue.ts             # global slot pool + per-user cooldown
    ├── serialize.ts         # WAMessage → flat SerializedMessage (incl. tap parsing)
    ├── sender.ts            # reply/audio/video/sticker/react/list/buttons
    ├── media.ts             # requireUrl, sendMedia (multi-file routing)
    └── store · config · lang · llm · logger · aiHistory · factory · buttons
```

</details>

---

## 🤝 Contributing

PRs are welcome! This is a small, lazy codebase — keep it that way.

- Found a bug? [Open an issue](https://github.com/salsabytes/Wakaru/issues)
- Want a feature? Same place
- Respect the [Code of Conduct](CODE_OF_CONDUCT.md)

<div align="center">

[![Contributors](https://contrib.rocks/image?repo=salsabytes/Wakaru)](https://github.com/salsabytes/Wakaru/graphs/contributors)

</div>

---

## 📄 License

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes)

---

## ❓ FAQ

<details>
<summary>Can Bun run on Termux?</summary>

**Yes.** Installers force Bun in via `npm install -g bun` (works on
aarch64) and keep it on the latest canary. If that ever fails, the
installer gracefully falls back to Node ≥ 23.6 — which also runs the
TypeScript files directly.

</details>

<details>
<summary>Why doesn't `npm install` pull in `sharp`?</summary>

`sharp` (a peer of baileys) has no Android prebuilt — npm would try to
compile libvips from source on Termux and fail the whole install. The
repo's `.npmrc` sets `omit=peer`, so installs go through. Trade-off:
baileys' link-preview thumbnails don't work; media features use the
Rust sidecar instead.

</details>

<details>
<summary>Can I run two instances?</summary>

Never two instances sharing the same `sessions/` folder — they kick each
other (`status 440`, `connectionReplaced`).

</details>

<details>
<summary>I got logged out — what now?</summary>

Delete `sessions/` and scan the QR again. Credentials never reach the
repo — the folder is gitignored.

</details>

<details>
<summary>Hosting on Termux — anything special?</summary>

Keep the phone awake with `termux-wake-lock`. Note that `.facebook`
relies on the system `curl` — it works on Windows/Bun; on Linux hosts
the fdown challenge may block it.

</details>

---

## 🏷️ Versioning

Wakaru follows [Semantic Versioning](https://semver.org/) — `major.minor.patch`
(e.g. `1.1.0`).

| Bump | When |
|---|---|
| `major` | Breaking changes |
| `minor` | New features (`1.1.0`, `1.2.0`, …) |
| `patch` | Bug fixes (`1.1.1`, `1.1.2`, …) |

---

## 📦 Changelog

<details>
<summary>Recent changes</summary>

**v1.1.0** — back to [semver](https://semver.org/) (the short-lived `YY.MM.R` releases were dropped; this is the same code, re-released cleanly)
- iPhone audio fix: ytmp3's "mp3" is AAC in a fragmented MP4 (iOS refuses to play) — new `native/audio` Rust engine remuxes it to a standard M4A (lossless, no codec deps)
- `.play` results now render everywhere: quick_reply buttons + numbered text (the old native-flow list was blank on iOS) — still replyable as `1 mp3`
- `.play` cancel: `❌ Batal` button on the list & format pick, or type `batal`/`gajadi`/`cancel`; chatting about other things no longer gets spam replies
- `.add` accepts `+62` with spaces/dashes
- Boot log prints `Wakaru v<version> (<commit>)` so restarts are verifiable
- Group management: `.kick @member` (tag or reply) and `.add <number>` (accepts `+62` formats, multiple numbers)
- `.kick`/`.add` guarded: group admins/owner only, bot must be admin
- LID→PN resolved once at the message boundary; mentions stay raw — commands match any jid form
- Commands auto-discovered from `commands/` — new command = drop a file, no `index.ts` edits (category from folder name)
- Sticker: fills the 512 canvas edge-to-edge with a transparent letterbox; 24 fps, 7 s cap, ≤500 KB ladder
- Sticker EXIF rewritten to the JSON payload WhatsApp reads today (pack name shows again)
- Windows: `sticker.exe` ships its MinGW DLLs — fixes the silent `code 53` crash on clean PATHs

**v1.0.0**
- Multitasking: every command runs concurrently — one global slot pool, no per-command flags
- Per-user 5 s cooldown on heavy commands (downloaders + sticker)
- Media downloads capped at 30 MB (lower peak RAM)
- AI reports real download results: title · duration · size
- Reply language configurable via `config.json` / `.setlang` / `.ai`
- Deep modularization: `lib/scrapers/*`, `socket.ts`, `ai/`, `queue` + `serialize` + `sender` + `media`
- `.play` two-stage pick: search → tap result → MP3/MP4 buttons (native-flow list)
- New downloaders: `.facebook` (HD) and `.pinterest` (pin link or search query)
- Multi-file results now land in your private chat, not the group
- Tap/button parsing unified — all interactive message shapes handled
- Termux installer: forced Bun via npm, automatic canary upgrade, simulated-Termux CI

**Earlier**
- Performance pass: per-chat parallel queues, global concurrency caps, LID→PN cache, AI history TTL, ytmp3 cookie caching
- Full Instagram downloader (reels, carousels, stories) with snapsave fallback
- TikTok downloader without watermark (real titles, one-shot POST)
- Agentic `.ai` with tool execution (`@run:`) and per-sender memory
- Rust sticker engine with animated webp support

</details>

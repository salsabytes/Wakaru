<div align="center">

# Wakaru (分かる)

**“To understand.”** — a tiny, agentic WhatsApp bot built on [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript.

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-join-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

<p><b>English</b> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a></p>

<img src="https://media.tenor.com/ZafC06r3sksAAAAC/anime-anime-girl.gif" alt="Wakaru" width="480" />

</div>

Wakaru runs TypeScript directly on Node (no build step), talks in chat, downloads media, makes stickers, helps manage groups — and its `.ai` can act as an agent (run bot commands, and for the owner, read/edit this repo safely).

## Features

- **Agentic chat (`.ai`)** — answers questions, runs bot commands for you (`@run:<cmd>`), remembers context per chat. For the owner it can work on the repo (`@read/@ls/@grep/@search/@fetch/@write/@typecheck/@test/@done`), sandboxed to `src/`, `test/`, `docs` with automatic typecheck+test rollback. If something isn’t in the repo, it can research via web search/fetch.
- **Downloaders** — YouTube (`.play`/`.ytmp3`/`.ytmp4`), TikTok, Instagram, Facebook, Pinterest, SoundCloud, Spotify, X/Twitter.
- **Stickers & media** — photo/video → sticker, sticker → image, video → audio, brat sticker, AI upscale (`.hd`).
- **Group tools** — kick/promote/demote/add, hidetag/tagall, anti-link & anti-delete (per group), admin/bot-admin guards.
- **Utilities & fun** — menu, Wikipedia, reminders, Family 100, and more. Send `.menu` in chat for the live list.
- **Lightweight** — runs on Termux (no root), no yt-dlp/ffmpeg required for core features (sticker engine is a small Rust sidecar).

## Requirements

- **Node.js ≥ 23.6** (uses Node’s type-stripping to run `.ts` directly)
- npm
- (Optional, for stickers) Rust toolchain to build `native/sticker` once (`npm run build:sticker`)

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru
npm run start
```

1. A QR code appears — scan it from WhatsApp (*Settings → Linked devices*).
2. Session is saved in `sessions/`.

**Windows:** run [`install.bat`](install.bat) (double-click) or follow manual setup below.

<details>
<summary><b>Manual setup / pairing code</b></summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # one-time: compile the Rust sticker engine (optional)
npm run start           # scan QR
# or: npm run start:pairing  (or set PAIRING_CODE=1) for a pairing code
```

</details>

## Configuration

`config.json` is created on first boot (gitignored). Minimal example:

```json
{
  "owners": ["6281234567890"],
  "language": "id"
}
```

- **`owners`** — numbers (or JIDs) that can use owner-only commands. Empty = owner-only commands disabled.
- **`language`** — reply language (`id`, `en`, `ja`, or other codes supported by `.ai`).
- Other options (see [`config.example.json`](config.example.json)): `mode` (public/self/private), `prefixes`, `bare`, `maxDownloadMB`, `aiModel`, `aiFree`, `stickerPack`/`stickerAuthor`, `updateChannel`, `markOnline`.

Most can be changed live from WhatsApp: `.setlang`, `.mode`, `.prefix`, `.limit` (or ask `.ai`).

## Commands

Send **`.menu`** in WhatsApp for the live, up-to-date list with aliases.

| Category | Examples |
|---|---|
| Chat / AI | `.ai` (chat + agent), `.menu`, `.wiki`, `.setlang`, `.remind` |
| Stickers & media | `.sticker`, `.toimg`, `.brat`, `.toaudio`, `.hd` (reply to media) |
| Downloaders | `.play`, `.ytmp3`, `.ytmp4`, `.tiktok`, `.instagram`, `.facebook`, `.pinterest`, `.soundcloud`, `.spotify`, `.twitter` |
| Group (admin/owner) | `.kick`, `.promote`, `.demote`, `.add`, `.hidetag`, `.antilink`, `.antidelete` |
| Games | `.family100` |
| Owner | `.mode`, `.prefix`, `.limit`, `.update`, `.aistatus` |

> Multi-file results (e.g. IG carousels, Pinterest) are sent to your private chat.

## How the AI works

- `.ai <message>` chats and can invoke bot commands (`@run:<cmd>`). It keeps short per-`chat:sender` history/memory.
- **Owner repo mode:** when you ask to change/read code, the agent can `@read/@ls/@grep/@write/@rm/@send`, then `@typecheck`/`@test`. Edits are limited to `src/`, `test/`, `docs` and are auto-rolled back unless checks pass. Use `@repo` / `@chat` to force a mode.
- **Research:** if a requested API/pattern isn’t in this repo, it can `@search`/`@fetch` docs (e.g. Baileys) and should tell you it’s researching.
- Backend: Wakafy AI API (`/v1/ext/salsabytes/gpt-6`, anon). Set `WAKAFY_API_KEY` only for a personal key (public free key built in). `WAKARU_AI_MODEL`, `WAKARU_AI_FREE`/`aiFree` tweak behavior.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node:test (test/**/*.test.ts)
npm run start       # run the bot
npm run build:sticker
```

- No build step for app code; imports use explicit `.ts` extensions (ESM, strict).
- Commands: `src/commands/<category>/<name>.ts` default-export `{ name, run(ctx), ... } satisfies Command` (auto-registered).
- Shared helpers in `src/lib/` (stdlib-first).

## Troubleshooting

- **Two instances kick each other (440 / `connectionReplaced`)** — never run two bots on the same `sessions/` folder.
- **Logged out / need to re-link** — delete `sessions/` and scan again.
- **Termux sleeps** — run `termux-wake-lock`.
- **Sticker fails** — build the sidecar: `npm run build:sticker` (Rust). `sharp` is intentionally not installed.
- **`.ai` slow or errors** — LLM calls have a ~120s timeout; a slow/down backend returns an error instead of crashing. Try again or check connectivity/API limits.

## Contributing

Small, lazy codebase — keep it that way. Issues and PRs welcome. Join the [WhatsApp group](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD) for questions.

## License & credits

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes). Built on [Baileys](https://github.com/whiskeysockets/Baileys). [Releases](https://github.com/salsabytes/Wakaru/releases).

<div align="center">

**If Wakaru helps you, a ⭐ on the repo means a lot.**

</div>

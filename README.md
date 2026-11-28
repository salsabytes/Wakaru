<div align="center">

# Wakaru (分かる)

**“To understand.”** — a tiny WhatsApp bot built on [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript.

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-join-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

<p><b>English</b> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a></p>

<img src="https://media.giphy.com/media/pwkpuW7xF9BflrrYpB/giphy.gif" alt="Wakaru" width="320" />

</div>

Wakaru runs TypeScript directly on Node.js (no build step). It handles chat, media downloads, stickers, group tools, and an agentic `.ai` mode that can run bot commands — and, for owners, safely inspect/edit this repo.

## Features

- **Agentic AI (`.ai`)** — chat, remember per-chat context, and run bot commands with `@run:<cmd>`. Owner mode can inspect/edit the repo with tool markers (`@read/@ls/@grep/@write/@edit/@rm/@typecheck/@test/@done`), sandboxed to `src/`, `test/`, and docs, with automatic rollback on failed verification.
- **Downloaders** — YouTube (`.play`, `.ytmp3`, `.ytmp4`), TikTok, Instagram, Facebook, Pinterest, SoundCloud, Spotify, X/Twitter.
- **Stickers & media** — photo/video to sticker, sticker to image, video to audio, brat sticker, AI upscale (`.hd`).
- **Group tools** — kick/promote/demote/add, hidetag, anti-link, anti-delete, welcome/goodbye.
- **Utilities** — menu, Wikipedia, reminders, Family 100, AFK, stats, and more. Send `.menu` in chat for the live list.
- **Lightweight** — runs on Termux (no root). Core features don't need yt-dlp/ffmpeg; stickers use a small Rust sidecar.

## Requirements

- **Node.js >= 23.6** (uses Node type-stripping for `.ts`)
- npm
- Rust toolchain only if you want to build the sticker sidecar (`npm run build:sticker`)

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru
npm run start
```

Scan the QR code from WhatsApp: *Settings > Linked devices*. The session is saved in `sessions/`.

**Windows:** run [`install.bat`](install.bat), or use the manual setup below.

<details>
<summary><b>Manual setup / pairing code</b></summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # optional, one-time
npm run start           # QR
# or: npm run start:pairing
# or: PAIRING_CODE=1 npm run start
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

| Key | Purpose |
|---|---|
| `owners` | Numbers/JIDs allowed to use owner-only commands. Empty disables owner-only commands. |
| `language` | Default reply language (`id`, `en`, `ja`, etc.). |
| `mode` | `public`, `all` (everyone + the bot's own number), `self`, or `private`. |
| `prefixes` | Command prefixes. |
| `maxDownloadMB` | Download size limit. |
| `markOnline` | Keep bot presence online on connect. |

See [`config.example.json`](config.example.json) for all options. Most settings can be changed from WhatsApp via `.setlang`, `.mode`, `.prefix`, `.limit`, or by asking `.ai`.

## Commands

Send **`.menu`** in WhatsApp for the live, up-to-date list.

| Category | Examples |
|---|---|
| AI / chat | `.ai`, `.menu`, `.wiki`, `.setlang`, `.remind`, `.afk` |
| Media / stickers | `.sticker`, `.toimg`, `.brat`, `.toaudio`, `.hd` |
| Downloaders | `.play`, `.ytmp3`, `.ytmp4`, `.tiktok`, `.instagram`, `.facebook`, `.pinterest`, `.soundcloud`, `.spotify`, `.twitter` |
| Group | `.kick`, `.promote`, `.demote`, `.add`, `.hidetag`, `.antilink`, `.antidelete`, `.welcome`, `.goodbye` |
| Games | `.family100` |
| Owner | `.mode`, `.prefix`, `.limit`, `.update`, `.eval`, `.aistatus` |

## AI Notes

- `.ai <message>` can chat normally or invoke bot commands (`@run:<cmd>`).
- Owner repo mode is for this workspace only. Edits are limited to `src/`, `test/`, and docs; writes are verified with typecheck/tests and rolled back on failure.
- Use `@repo ...` or `@chat ...` to force mode.
- Backend: Wakafy AI API. `WAKAFY_API_KEY` is optional; a public key is built in. `WAKARU_AI_MODEL`, `WAKARU_AI_FREE`, and `aiFree` adjust behavior.

## Development

```bash
npm install
npm run typecheck
npm test
npm run start
npm run build:sticker
```

- App code has no build step; imports use explicit `.ts` extensions.
- Commands live in `src/commands/<category>/<name>.ts` and are auto-registered from the default export.
- Shared helpers go in `src/lib/`.

## Troubleshooting

- **Two instances conflict (`440` / `connectionReplaced`)** — never run two bots on the same `sessions/` folder.
- **Logged out / need relink** — delete `sessions/` and scan again.
- **Replies missing on linked devices** — check for duplicate instances, relink the session, and try `markOnline: false` in `config.json` if needed.
- **Termux sleeps** — run `termux-wake-lock`.
- **Sticker fails** — build the sidecar with `npm run build:sticker`. `sharp` is intentionally not installed.
- **Sticker/`.ss` rejected with `usage: sticker ...`** — `bin/` is gitignored, so a `git pull` leaves the old sidecar running. The bot rebuilds a stale sidecar at boot; if cargo is unavailable, run `npm run build:sticker` manually and restart.
- **Running under pm2/systemd** — start it as `pm2 start src/index.ts --interpreter node` (or `pm2 start npm --name wakaru -- start`). `.update` then just exits and lets pm2 revive it; it never spawns a second bot, which would kick the session with `440`.
- **`.ai` slow/errors** — LLM calls have a ~120s timeout; a slow or unavailable backend returns an error instead of crashing.

## Contributing

Keep changes small and practical. Issues and PRs are welcome.

- [Open an issue](https://github.com/salsabytes/Wakaru/issues)
- [WhatsApp group](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

## License

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes). Built on [Baileys](https://github.com/whiskeysockets/Baileys).

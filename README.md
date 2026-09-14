<div align="center">

# ✨ Wakaru

**分かる — *"to understand."***

A tiny WhatsApp bot with an agentic brain. It talks back, pulls songs,
saves videos, and turns your photos into stickers.

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

**Self-hosted WhatsApp bot** on [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript —
no yt-dlp, no ffmpeg, no self-hosted servers. Pure-TS scrapers, one tiny
Rust sidecar, one Python sidecar for the AI brain.

One codebase, three runtimes: **Bun** on desktop, **Bun or Node ≥ 23.6** on
Termux, one-line installer everywhere. Chat with it, or let it *do* things.

<div align="center">

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## ✨ Features

- 🧠 **It gets you** — `.ai` chats naturally, runs any command via `@run:`, remembers each sender
- 🎬 **Plays with media** — audio/video from links, YouTube search, stickers, `.brat` memes, `.toimg`
- 👥 **Group-ready** — kick/promote/demote/add with declarative admin guards
- 🌐 **Speaks your language** — free-form `.setlang` (`id`/`en`/`ja`/…) with file cache
- 🔁 **Never leaves you hanging** — auto-reconnect with exponential backoff
- 🔐 **Easy in** — QR code or pairing code login
- 📱 **Runs on your phone** — first-class Termux support, no root needed
- ⚡ **Fast & cheap** — parallel commands, per-user cooldown, configurable download cap

---

## 📚 Docs

| Doc | What's inside |
|---|---|
| [📜 Commands](docs/commands.md) | Full 23-command table with aliases & guards |
| [⚙️ Configuration](docs/config.md) | Every `config.json` key: mode, prefix, bare, lang, limit |
| [🚀 Guide](docs/guide.md) | Install, login, update, FAQ |
| [🛠️ Developer notes](docs/dev.md) | Layout, adding commands, checks, tech stack |
| [📦 Changelog](docs/changelog.md) | Version history |

---

## 🚀 Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && bun run start
```

Scan the QR with WhatsApp (*Settings → Linked devices*). Details per
platform, manual setup, and updating: [Guide](docs/guide.md).

Owner setup: `config.json` is auto-created on first boot — add your number
to `"owners"` (bare `628123...` or full JID). Empty list disables owner
commands.

```json
{
  "owners": ["6281234567890"],
  "language": "id",
  "mode": "public",
  "prefixes": ["."],
  "maxDownloadMB": 100
}
```

The `.ai` brain chats through **chatgpt.com anonymous — free, zero setup**
(fresh device + proof-of-work per request, no key, no login). Needs
`python3` + `curl_cffi`; without them it falls back to Poolside.

---

## 🤝 Contributing

PRs welcome! Small, lazy codebase — keep it that way.

- Bug? [Open an issue](https://github.com/salsabytes/Wakaru/issues)
- Feature? Same place
- Respect the [Code of Conduct](CODE_OF_CONDUCT.md)

<div align="center">

[![Contributors](https://contrib.rocks/image?repo=salsabytes/Wakaru)](https://github.com/salsabytes/Wakaru/graphs/contributors)

</div>

---

## 📄 License

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes)

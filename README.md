<div align="center">

# ✨ Wakaru

**分かる — *"to understand."* A tiny WhatsApp bot that talks back.**

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/WXk69eF4A)

<p>🌐 <b>English</b> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a></p>

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## 🚀 Run it

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && npm run start
```

1. QR appears → scan it from WhatsApp (*Settings → Linked devices*)
2. Done. Session is saved in `sessions/`

> Windows? Open [`install.bat`](install.bat) and double-click it.

<details>
<summary>Manual setup / pairing code</summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # one-time: compile the Rust sticker engine
npm run start           # or: npm run start:pairing
```

Pairing code login: `npm run start:pairing` or set `PAIRING_CODE=1`.

</details>

---

## 💡 What it does

- 🧠 `.ai` — chat + runs commands for you (`@run:`), remembers context
- 🎬 Downloaders — YouTube, TikTok, IG, FB, Pinterest, SoundCloud, Spotify, X
- 🖼️ Stickers & media — photo/video → sticker, sticker → photo, video → audio, AI upscale
- 👥 Group tools — kick / promote / demote / add
- 📱 Runs on Termux, no root. No yt-dlp, no ffmpeg

---

## 📜 Commands

Send `.menu` in WhatsApp for the live list with aliases.

<details>
<summary>Show all commands</summary>

**Chat**
`.ai` — agentic chat · `.menu` — list all · `.wiki` — Wikipedia search · `.setlang` — switch language

**Stickers & media** (reply to a photo/video/sticker)
`.sticker` — → sticker · `.toimg` — sticker → photo · `.brat` — text → meme sticker · `.toaudio` — video → audio · `.hd` — 2x AI upscale

**Downloaders**
`.play` — search YouTube → mp3/mp4 · `.ytmp3` / `.ytmp4` — link → audio/video
`.tiktok` · `.instagram` · `.facebook` · `.pinterest` · `.soundcloud` · `.spotify` · `.twitter`

**Group** (admins/owner only)
`.kick` · `.promote` · `.demote` · `.add`

**Owner only**
`.mode` (public/self/private) · `.prefix` · `.limit` (10–2048 MB) · `.update`

Multi-file results (IG carousels, Pinterest) go to your **private chat**.

</details>

---

## ⚙️ Config

`config.json` is auto-created on first boot. Only thing you need:

```json
{ "owners": ["6281234567890"], "language": "id" }
```

Add your number → owner commands unlock. See [`config.example.json`](config.example.json) for everything (`mode`, `prefixes`, `maxDownloadMB`, `stickerPack`…).

<details>
<summary>Advanced</summary>

- `.ai` brain: free, no key — Python sidecar (`native/ai`, needs `python3` + `curl_cffi`, installed by `install.sh`), Poolside fallback
- Live from WhatsApp: `.setlang`, `.mode`, `.prefix`, `.limit` — or just ask `.ai`
- Env: `SESSION_DIR` (default `sessions`), `PAIRING_CODE=1`, `WAKAFY_API_KEY` (optional — public free key `@waka:alpha` built in, no signup; set only for your own key)
- Update: send `.update` from WhatsApp (backs up, pulls, rebuilds, restarts, rolls back on failure)

</details>

---

## ❓ Stuck?

<details>
<summary>Two instances kick each other (440)?</summary>

Never share one `sessions/` folder. One folder = one bot.

</details>

<details>
<summary>Logged out?</summary>

Delete `sessions/` and scan again.

</details>

<details>
<summary>Termux goes to sleep?</summary>

Run `termux-wake-lock`.

</details>

---

## 🤝 Contributing

Small lazy codebase — keep it that way. Bug or idea? [Open an issue](https://github.com/salsabytes/Wakaru/issues). PRs welcome. Questions? Hang out on [Discord](https://discord.gg/WXk69eF4A).

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes) · [Releases](https://github.com/salsabytes/Wakaru/releases) · Built on [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript + Node + Rust

---

<div align="center">

## ⭐ pls star

Wakaru works for free and only asks for one thing in return: a star.<br>
No star = the bot cries in `sessions/`. You wouldn't make a bot cry, right? 🥺

</div>

# 📜 Commands

Send `.menu` in WhatsApp for the live list. Aliases in parentheses.
Guards: 🔒 owner only · 👥 group only (admins + bot must be admin).

## 🧠 Main

| Command | Aliases | What it does |
|---|---|---|
| `.ai <msg>` | — | Agentic chat; runs commands via `@run:`, remembers each sender |
| `.menu` | `.help` | List every command |
| `.setlang <code>` | `.lang`, `.bahasa` | Reply language, any code (`id`/`en`/`ja`…) |
| `.mode <public\|self\|private>` | `.self` | 🔒 Who can use the bot: everyone, this account, owners |
| `.prefix <chars\|none>` | — | 🔒 Prefixes, multi (`.prefix ! /`), bare (`.prefix ! / none`) |
| `.limit <MB>` | — | 🔒 Max download size, 10–2048 MB |
| `.update` | — | 🔒 Pull code, rebuild, restart |

## 🎬 Downloaders

| Command | Aliases | What it does |
|---|---|---|
| `.ytmp3 <url>` | `.ytm`, `.music` | Any video link → mp3 audio |
| `.ytmp4 <url>` | `.ytv`, `.video` | Any video link → mp4 video |
| `.play <query>` | `.yt`, `.song` | Search YouTube → tap result → pick mp3/mp4 |
| `.tiktok <url>` | `.tt`, `.ttdl` | TikTok video, no watermark |
| `.instagram <url>` | `.ig`, `.igdl` | IG reels, videos, photos & carousels |
| `.facebook <url>` | `.fb`, `.fbdl` | Facebook video or photos (share links ok) |
| `.pinterest <url\|query>` | `.pin`, `.pins` | Images from pin link, or search query |
| `.soundcloud <url>` | `.sc` | SoundCloud track → mp3 audio |
| `.spotify <url>` | `.sp` | Spotify track/album → matched on YouTube |
| `.twitter <url>` | `.x`, `.tw`, `.twdl` | X (Twitter) video or photos |

## ✨ Converter

| Command | Aliases | What it does |
|---|---|---|
| `.sticker` | `.st` | Quoted photo/video → 512×512 webp (`.sticker <pack>\|<author>`) |
| `.toimg` | `.toimage` | Quoted sticker → PNG image |
| `.brat <text>` | — | White brat-style meme sticker from text |

## 👥 Group (👥 admins/owner only, bot must be admin)

| Command | Aliases | What it does |
|---|---|---|
| `.kick` | `.tendang`, `.keluarkan` | Kick a member (tag or reply) |
| `.promote` | `.angkat` | Promote member(s) to admin (tag or reply) |
| `.demote` | `.turunkan` | Demote admin(s) to member (tag or reply) |
| `.add <number>` | `.tambah` | Add members by phone number |

Multi-file results (IG carousels, Pinterest searches) land in your
**private chat** so groups stay tidy. Files over ~64MB arrive as
**documents** (up to 2GB, WhatsApp's cap) instead of inline media.

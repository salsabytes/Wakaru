# 📦 Changelog

## Unreleased

- Reply language is free-form: `.setlang <code>` accepts any code
  (`id`/`en`/`ja`/…) with `data/lang/<code>.json` file cache, pivot fallback
- Reply-to-bot and link follow-ups reach `.ai` even with bare mode on
- `.ai` output is WhatsApp-safe: `[text](url)` flattened, `**bold**` → `*bold*`
- Group commands are declarative (`groupOnly`/`adminOnly`/`botAdmin` flags)
- Multi-prefix accepts bare alongside (`.prefix ! / none`)
- `.update` follows `master` by default

**v1.2.0**
- `.prefix`: custom, multi (`.prefix ! /`), bare (`.prefix none`)
- Bare commands need a double-tap when prefixes are set; instant in bare mode
- Fix: `queryText` ate one char when a space follows the prefix

**v1.1.1**
- `.mode`: `public` / `self` / `private` reply gate, live or via `config.json`
- `.brat`: white brat-style meme sticker (Rust engine)
- `.toimg`: quoted sticker → PNG (Rust engine)
- `.facebook` share links via fdown.world fallback
- Static command registry (`src/commands/index.ts`)

**v1.1.0** — back to [semver](https://semver.org/)
- iPhone audio fix: `native/audio` Rust engine remuxes AAC-fMP4 → M4A
- `.play`: quick_reply buttons + numbered text (blank native-flow list fixed)
- `.play` cancel via button or `batal`/`gajadi`/`cancel`
- `.add` accepts `+62` with spaces/dashes
- Boot log prints `Wakaru v<version> (<commit>)`
- `.kick` / `.add` with group guards, LID→PN at the message boundary
- Sticker: edge-to-edge 512 canvas, 24fps, 7s cap, ≤500KB ladder
- Sticker EXIF rewritten (pack name shows again)
- Windows: `sticker.exe` ships MinGW DLLs (silent `code 53` fixed)

**v1.0.0**
- Concurrent commands (global slot pool), 5s per-user cooldown on heavy ones
- 30MB download cap, AI reports real results (title · duration · size)
- Reply language via `config.json` / `.setlang` / `.ai`
- `lib/scrapers/*` modularization, `.play` two-stage pick
- `.facebook` (HD), `.pinterest` (link or query)
- Multi-file results land in private chat
- Termux installer: forced Bun via npm, canary upgrade, simulated-Termux CI

**Earlier**
- Per-chat parallel queues, LID→PN cache, AI history TTL, ytmp3 cookies
- Full Instagram downloader (reels, carousels, stories) + snapsave fallback
- TikTok downloader, no watermark
- Agentic `.ai` with `@run:` tools and per-sender memory
- Rust sticker engine with animated webp

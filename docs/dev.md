# 🛠️ Developer notes

## Layout

```
src/
├── index.ts                 # entry: boot + signal handling
├── socket.ts                # Baileys connection lifecycle (reconnect, QR, pairing)
├── handlers/
│   └── messages.ts          # upsert → drop rules → dispatch
├── commands/
│   ├── index.ts             # static registry (imports + entries)
│   ├── main/                # ai/ (prompt, tools, exchange), menu, mode, prefix, limit, setlang, update
│   ├── downloader/          # ytmp3, ytmp4, play, tiktok, instagram, facebook,
│   │                        # pinterest, soundcloud, spotify, twitter
│   ├── converter/           # sticker, toimg, brat
│   └── group/               # kick, promote, demote, add (groupOnly + adminOnly + botAdmin)
├── lib/
│   ├── scrapers/            # one module per platform + shared http/curl helpers
│   ├── queue.ts             # global slot pool + per-user cooldown
│   ├── serialize.ts         # WAMessage → flat SerializedMessage (incl. tap parsing)
│   ├── sender.ts            # reply/audio/video/sticker/react/list/buttons
│   ├── media.ts             # requireUrl, sendMedia (multi-file routing, doc fallback)
│   └── store · config · lang · llm · logger · aiHistory · factory ·
│       buttons · contributors · disk · updater · group
└── ../native/
    ├── sticker/             # Rust: webp engine (sticker/toimg/brat)
    ├── audio/               # Rust: fMP4 → M4A remux for iOS
    └── ai/                  # Python: chatgpt-anon sidecar (needs curl_cffi)
```

## Adding a command

`src/commands/<category>/<name>.ts`, default-exported:

```ts
export default {
  name: 'hug',
  desc: 'hug someone (tag or reply)',
  aliases: ['peluk'],
  groupOnly: true,   // + adminOnly / botAdmin / ownerOnly / cooldown as needed
  run: async (ctx: CommandContext) => {
    await ctx.reply('…')
  },
} satisfies Command
```

Then register it (static imports + `entries` in `src/commands/index.ts`) —
dropping a file alone does NOT register it. Context types are global
(`src/commands/types.d.ts`): flat `ctx` with `sock, args, text, reply,
sendSticker, download, quoted, isGroup/isAdmin/isBotAdmin/isOwner…`

Conventions: 2-space indent, minimal English comments, explicit `.ts`
import extensions, `strict: true`, no semicolons. `src/lib/` = shared
helpers, stdlib only.

## Checks

- `bun run typecheck` — the only gate, run before claiming anything works
- `AI_SELFTEST=1 bun src/commands/main/ai/index.ts` — parser self-check
- `MENU_SELFTEST=1`, `GROUP_SELFTEST=1`, `MEDIA_SELFTEST=1` — same pattern
  per module (all wired into CI)

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** (canary) · Node ≥ 23.6 fallback | TS runs directly — no build step |
| WhatsApp | **Baileys** | Battle-tested Web API client |
| Sticker engine | **Rust sidecar** | 512×512 webp, animated, brat/toimg, codecs compiled in |
| Audio engine | **Rust sidecar** | AAC-in-fMP4 → standard M4A for iOS, lossless |
| AI brain | **Python sidecar** (`native/ai`, `curl_cffi`) + Poolside fallback | chatgpt.com anonymous, no key/login; memory in `aiHistory.ts` |
| Scrapers | **Pure TypeScript** | No yt-dlp / ffmpeg — nothing to maintain |
| Logging | **pino** | Fast, structured, prettified |
| CI | **GitHub Actions** | Real installs: Ubuntu, macOS, Windows + simulated Termux |

## Gotchas

- Never run two instances on one `sessions/` dir (`440 connectionReplaced`)
- LID jids (`@lid`) must resolve via `lidMapping.getPNForLID` before comparing
- LLM call has a 90s timeout — a slow backend replies `❌`, never crashes
- WhatsApp renders `*bold*` single-star only — `.ai` normalizes `**` and
  `[text](url)` before sending

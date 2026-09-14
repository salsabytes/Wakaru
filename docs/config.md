# ⚙️ Configuration

`config.json` (gitignored) is auto-created from `config.example.json` on
first boot — just add your number to `"owners"` (bare `628123...` or full
JID). Empty list disables owner commands. Every key below is also
switchable live from WhatsApp (or via `.ai`).

```json
{
  "owners": ["6281234567890"],
  "language": "id",
  "mode": "public",
  "prefixes": ["."],
  "bare": false,
  "maxDownloadMB": 100,
  "stickerPack": "Wakaru",
  "stickerAuthor": "buatan gweh",
  "updateChannel": "master"
}
```

| Key | Default | Command | Notes |
|---|---|---|---|
| `owners` | `[]` | — | Owner-only commands need at least one |
| `language` | `id` | `.setlang <code>` | Any code: `id`/`en`/`ja`/… — see below |
| `mode` | `public` | `.mode` | `public` everyone · `self` this account · `private` owners |
| `prefixes` | `["."]` | `.prefix` | Max 5, no spaces; multi: `.prefix ! /` |
| `bare` | `false` | `.prefix … none` | `true` = bare commands fire without prefix |
| `maxDownloadMB` | `100` | `.limit <MB>` | Clamped 10–2048; bigger = more RAM (≈2-3×) |
| `stickerPack` / `stickerAuthor` | — | `.sticker <pack>\|<author>` | Default EXIF name on stickers |
| `updateChannel` | `master` | — | `master` = follow branch, `release` = follow tag |

## Prefixes & bare mode

- `.prefix !` — switch to `!` · `.prefix ! /` — both work
- `.prefix ! / none` — prefixed AND bare work together
- `.prefix none` — full bare mode, no prefix at all
- With prefixes only, a bare `menu` fires when sent **twice in a row**
  (chat-safe); with bare on it fires right away.

## Languages

`id` and `en` are built in. Any other code reads
`data/lang/<code>.json` (gitignored) — a plain `{ key: translation }`
file with `{placeholders}` kept intact. Missing file or key falls back
to English, so the bot never breaks. The `.ai` chat voice follows the
same code automatically.

## Env vars

| Variable | Purpose |
|---|---|
| `SESSION_DIR` | Login session folder (default `sessions`) |
| `PAIRING_CODE=1` | Log in with a pairing code instead of QR |
| `IG_SESSIONID` | Burner IG cookie for `.instagram` stories when snapsave is down |

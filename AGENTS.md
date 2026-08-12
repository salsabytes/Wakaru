# Wakaru (分かる)

Tiny WhatsApp bot on Baileys + TypeScript: `.ai` agent chat, media downloaders (ytmp3/tiktok/instagram), photo/video → sticker via a Rust sidecar. Runs TypeScript directly — no build step. Bun on desktop, Node ≥ 23.6 on Termux/phone.

## Dev environment

- Runtime: Bun (desktop). `node src/index.ts` works everywhere with Node ≥ 23.6.
- Deps: `bun install`. `.npmrc` sets `omit=peer` — `sharp` is intentionally NOT installed (no Android prebuilt; would fail Termux installs). Don't add packages that require it.
- The sticker binary is a Rust crate (`native/sticker/`, pure codecs, no ffmpeg/system deps). Built artifact goes to `bin/` (gitignored).
- Installer: `install.sh` (runs bare via curl|bash or in-place). CI (`.github/workflows/install.yml`) tests it on ubuntu/macos/windows + simulated Termux. Touching install.sh or ai.ts → CI runs.

## Build & test

- `bun run typecheck` — the only gate. Run before claiming anything works.
- No test framework. The one test: `AI_SELFTEST=1 bun src/commands/main/ai/index.ts` (parseRuns self-check, wired into CI).
- `bun run start` — live bot, scan QR. `bun run start:pairing` — pairing code instead.
- `bun run build:sticker` — cargo build --release, copies binary to `bin/sticker[.exe]` (takes minutes on first run).
- Config: `config.json` at root (gitignored) — `{"owners": ["628..."]}` bare numbers or JIDs. Empty list disables owner-only commands.

## Conventions

- Commands: `src/commands/<category>/<name>.ts`, default-exported `{ name, desc?, aliases?, ownerOnly?, run(ctx) } satisfies Command`. Context types are global (declared in `src/commands/types.d.ts`) — CommandContext carries sock, args, reply, sendSticker, download, quoted, etc.
- Registering a command: add it to the static imports + `entries` array in `src/commands/index.ts`. The dynamic loader was removed — dropping a file alone does NOT register it (README's auto-scan claim is stale).
- `src/lib/` = shared helpers, stdlib only — no new deps in lib files.
- Imports use explicit `.ts` extensions (`allowImportingTsExtensions`); ESM (`type: module`); `strict: true`; no semicolons.
- AI: `src/commands/main/ai.ts` — chateverywhere.app free backend with a 2-round `@run:<cmd>` tool loop. History per `chat:sender` key via `src/lib/aiHistory.ts` (in-memory, resets on restart).
- Commits: conventional style from git log (`feat:` `fix:` `refactor:` `chore:` `style:`).

## Pitfalls

- Download scrapers (ytmp3.mobi, tiktokdownloaderr.id, Instagram web API, snapsave) are third-party and break silently. Verify against a real link, don't assume a fix works. `.instagram` stories fall back to `IG_SESSIONID` env (burner account cookie) when snapsave is down.
- Never run two instances on the same `sessions/` dir — they kick each other (`440 connectionReplaced`). Logged out? Delete `sessions/` and re-scan.
- Telemetry: `waka.user?.id` and quoted-sender matching do JID comparisons — LID (`@lid`) jids must be resolved via `signalRepository.lidMapping.getPNForLID` before comparing (see `src/handlers/messages.ts`).
- LLM call has a 90s timeout (`AbortSignal.timeout`) — a slow/down chateverywhere makes `.ai` hang-reply "❌ ...", not crash.
- On Termux keep the phone awake (`termux-wake-lock`); `install.sh` upgrades Bun to latest canary on every run.

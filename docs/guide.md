# 🚀 Guide

## One-liner (any platform)

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && bun run start
```

The installer detects your platform, installs the runtime, dependencies,
and builds the native sticker engine.

## Windows

Download [`install.bat`](../install.bat), double-click it (or run in
`cmd`). Installs Git + Bun via `winget`, clones, builds, starts.

## Manual (Bun)

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
bun install
bun run build:sticker   # one-time: compile the Rust sticker engine
bun run start            # scan the QR with your phone
bun run start:pairing    # or use a pairing code
```

## Logging in

1. Run the bot — a **QR code** appears in the terminal
2. WhatsApp → *Settings → Linked devices → Link a device*
3. Scan. Session is saved to `sessions/` and reused on restart

Prefer a code? Run with `--use-pairing-code` or `PAIRING_CODE=1`.

## Updating

- **`.update`** (owner only) from WhatsApp — backs up `config.json` +
  `sessions/`, pulls code, reinstalls deps, rebuilds the sticker engine,
  typechecks, and **restarts itself**. Rolls back on any failure.
- The bot **checks for updates on every start** and logs when one is out.

## ❓ FAQ

<details>
<summary>Can Bun run on Termux?</summary>

**Yes.** Installers force Bun via `npm install -g bun` (works on aarch64),
kept on latest canary. Falls back to Node ≥ 23.6 if that ever fails.

</details>

<details>
<summary>Why doesn't <code>npm install</code> pull in <code>sharp</code>?</summary>

`sharp` (a baileys peer) has no Android prebuilt — npm would compile
libvips from source on Termux and fail the install. `.npmrc` sets
`omit=peer`. Trade-off: link-preview thumbnails don't work; media uses
the Rust sidecar instead.

</details>

<details>
<summary>Can I run two instances?</summary>

Never two instances sharing one `sessions/` folder — they kick each other
(`status 440`, `connectionReplaced`).

</details>

<details>
<summary>I got logged out — what now?</summary>

Delete `sessions/` and scan the QR again. Credentials never reach the
repo — the folder is gitignored.

</details>

<details>
<summary>Hosting on Termux — anything special?</summary>

Keep the phone awake with `termux-wake-lock`. `.facebook` relies on system
`curl` — works on Windows/Bun; some Linux hosts block backends. Share
links (`facebook.com/share/…`) resolve via the fdown.world fallback.

</details>

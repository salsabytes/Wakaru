# Wakaru ✨

An **imoets** WhatsApp bot built on [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript.
Runs on **Bun** (PC) *and* **Node** (Termux/Android) — yes, you can host a bot on your phone. 🫶

> 🚧 **Status: work-in-progress skeleton (not done yet).**
> So far it can: connect, authenticate (QR / pairing code), auto-reconnect, and log incoming messages.
> The reply/command handlers are still empty — they'll be filled in as we grow together.

---

## ✨ Current features

- 🔐 Authentication via **QR code** or **pairing code**
- 🔁 Auto-reconnect with exponential backoff
- 📥 Logs incoming text messages (📥 received / 📤 sent)
- 🧩 Message handler already split into its own file for easy growth
- 🗂️ Multi-file session storage (`sessions/` folder) — safe for bot use

## 🧰 Requirements

| Platform | Runtime | Notes |
|---|---|---|
| PC | **Bun** | `bun run start` |
| Termux/Android | **Node 23.6+** (LTS) | `npm install`, then `node src/index.ts` |

`Node 23.6+` runs TypeScript directly (built-in type stripping) — no `tsx` needed.

## 📦 Installation

**On PC (Bun):**
```bash
bun install
bun run start          # scan QR
bun run start:pairing  # use pairing code instead
```

**On Termux (Node):**
```bash
pkg update && pkg install nodejs-lts
cd wakaru
npm install
node src/index.ts
```

> 🔧 Why doesn't `npm install` pull in `sharp`? Because `sharp` (an image library, a peer of baileys)
> has **no Android prebuilt** — npm would try to build libvips from source and fail, breaking the
> whole install. Our `.npmrc` sets `omit=peer` so the install goes through.
> The only trade-off: no media thumbnails yet (and the `jimp` fallback isn't used either — the bot
> is text-only right now, so we're fine). Full reasoning lives in `.npmrc`.

## ⚙️ Configuration

Via environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_DIR` | `sessions` | Folder where the login session is stored |
| `PAIRING_CODE` | — | Set to `1` to use pairing code |

Or pass the flag: `--use-pairing-code`.

## 🗂️ Code structure

```
src/
├── index.ts            # socket config + connect + connection handler + shutdown
├── store.ts            # in-memory message store (getMessage for baileys)
└── handlers/
    └── messages.ts     # messages.upsert handler (logs + stores messages)
```

## ⚠️ Important notes

- **Never run 2 instances sharing the same `sessions/` folder** — you'll hit status `440`
  (`connectionReplaced`) and the bots will kick each other. Run one instance only.
- If the bot gets logged out: delete the `sessions/` folder and scan again.
- `sessions/` is gitignored — credentials never end up in the repo.

## 🗺️ Roadmap

- [ ] Reply / command handlers (e.g. `.menu`, auto-reply)
- [ ] Sending media (needs `jimp` for thumbnails on Termux)
- [ ] Poll updates & chat status reading
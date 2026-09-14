<div align="center">

# ✨ Wakaru

**分かる — *"mengerti."***

Bot WhatsApp mungil berotak agen. Diajak ngobrol nyambung, bisa ambil
lagu, simpan video, dan ubah fotomu jadi stiker — semua lewat satu daftar
command yang bisa kamu kembangkan sendiri.

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-7DD3FC?style=for-the-badge&logo=typescript&logoColor=0F172A)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1E293B?style=for-the-badge&logo=bun&logoColor=FDE68A)](https://bun.sh/)
[![Rust](https://img.shields.io/badge/Rust%20sidecar-D97706?style=for-the-badge&logo=rust&logoColor=white)](native/sticker)
[![CodeFactor](https://img.shields.io/codefactor/grade/github/salsabytes/wakaru/master?style=for-the-badge&logo=codefactor&logoColor=white&label=CodeFactor)](https://www.codefactor.io/repository/github/salsabytes/wakaru)

<p>🌐 <a href="README.md">English</a> · <b>Bahasa Indonesia</b> · <a href="README.ja.md">日本語</a></p>

</div>

---

## 🧠 Wakaru itu apa?

Bot WhatsApp **self-hosted** berbasis
[Baileys](https://github.com/whiskeysockets/Baileys) dan TypeScript — tanpa
yt-dlp, tanpa ffmpeg, tanpa server sendiri. Semua beres lewat scraper
murni-TS, satu sidecar Rust mungil, dan satu sidecar Python buat otak AI.

Satu kode, tiga runtime: **Bun** di desktop, **Bun atau Node ≥ 23.6** di
Termux, dan installer satu baris buat semua platform. Ajak ngobrol, atau
biarin dia *ngerjain* sesuatu buat kamu.

<div align="center">

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## ✨ Fitur

- 🧠 **Nyambung** — `.ai` ngobrol natural, bisa jalanin command sendiri via `@run:`, dan ingat tiap percakapan
- 🎬 **Jago media** — ambil audio dan video dari link, cari YouTube pakai kata kunci, dan bikin stiker dari foto & video (plus meme `.brat`, `.toimg` stiker→foto, `.toaudio` video→audio, `.hd` upscale AI)
- 🧩 **Gampang dikembangin** — daftarin command di `src/commands/index.ts` dan otomatis muncul di `.menu`
- 🔁 **Anti ngilang** — reconnect otomatis dengan exponential backoff
- 🔐 **Gampang masuk** — login pakai QR code atau pairing code
- 📱 **Jalan di HP** — dukungan Termux kelas satu, tanpa root
- 🎨 **Log-nya cantik** — output konsol gaya charmbracelet, timestamp jam doang
- ⚡ **Cepat & murah** — tiap command jalan paralel (satu pool slot global), cooldown per user buat command berat, batas download bisa diatur (default 100 MB), tanpa server sendiri

---

## 📜 Commands

Kirim `.menu` di WhatsApp buat liat daftar live. Alias dalam kurung.

| Command | Aliases | Fungsinya |
|---|---|---|
| `.ai <msg>` | — | Ngobrol agen; bisa jalanin command via `@run:`, ingat tiap pengirim |
| `.menu` | `.help` | List semua command |
| `.sticker` | `.st` | Foto/video yang di-quote → stiker webp 512×512 (optional `.sticker <pack>\|<author>`) |
| `.toimg` | `.toimage` | Stiker yang di-quote → gambar PNG |
| `.brat <text>` | — | Stiker meme ala brat dari teks |
| `.toaudio` | `.tomp3`, `.tomp4a`, `.toaud` | Video yang di-quote → audio m4a (extract, tanpa re-encode) |
| `.hd` | `.remini`, `.upscale` | Foto yang di-quote → upscale AI 2x (iloveimg, fallback Rust) |
| `.ytmp3 <url>` | `.ytm`, `.music` | Link video apa aja → audio mp3 |
| `.ytmp4 <url>` | `.ytv`, `.video` | Link video apa aja → video mp4 |
| `.play <query>` | `.yt`, `.song` | Cari YouTube → ketuk hasil → pilih mp3/mp4 |
| `.tiktok <url>` | `.tt`, `.ttdl` | Video TikTok, tanpa watermark |
| `.instagram <url>` | `.ig`, `.igdl` | IG reels, video, foto & carousel, tanpa watermark |
| `.facebook <url>` | `.fb`, `.fbdl` | Video atau foto Facebook |
| `.pinterest <url\|query>` | `.pin`, `.pins` | Gambar dari link pin, atau cari pakai kata kunci |
| `.soundcloud <url>` | `.sc` | Lagu SoundCloud → audio (mp3), tanpa watermark |
| `.spotify <url>` | `.sp` | Lagu/album Spotify → dicocokkan di YouTube → audio |
| `.twitter <url>` | `.x`, `.tw`, `.twdl` | Video X (Twitter), tanpa watermark |
| `.kick` | `.tendang`, `.keluarkan` | Kick member (tag atau reply, khusus admin grup/owner) |
| `.promote` | `.angkat` | Angkat member jadi admin (tag atau reply, khusus admin grup/owner) |
| `.demote` | `.turunkan` | Turunkan admin jadi member (tag atau reply, khusus admin grup/owner) |
| `.add <number>` | `.tambah` | Tambah member pakai nomor HP (khusus admin grup/owner) |
| `.setlang <code>` | `.lang`, `.bahasa` | Ganti bahasa balasan bot, kode bebas (`id`/`en`/`ja`/…) |
| `.mode <public\|self\|private>` | `.self` | Siapa yang bisa pakai bot: semua orang, akun ini aja, atau owner aja (khusus owner) |
| `.prefix <chars\|none>` | — | Prefix command, multi, atau mode bare (khusus owner) |
| `.limit <MB>` | — | Maksimal ukuran download media, 10–2048 MB (khusus owner) |
| `.update` | — | Tarik kode terbaru, rebuild, restart (khusus owner) |

Hasil multi-file (carousel IG, pencarian Pinterest) dikirim ke
**chat pribadimu** biar grup tetap rapi.

---

## 🚀 Mulai cepat

### Satu baris (semua platform)

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && bun run start
```

Installer mendeteksi platformmu, menginstal runtime, dependencies,
dan build engine stiker native. Dijalankan ulang **otomatis bikin Bun
tetap di canary terbaru** (`bun upgrade --canary`).

### Windows

Download [`install.bat`](install.bat), klik dua kali (atau jalanin di
`cmd`). Dia menginstal Git + Bun (via `winget`), clone repo, instal
dependencies, compile engine stiker, dan start bot.

### Manual (Bun)

<details>
<summary>Lihat setup manual</summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
bun install
bun run build:sticker   # sekali aja: compile engine stiker Rust
                        # (di Windows sekalian kirim DLL MinGW di sebelah exe)

bun run start            # scan QR pakai HP-mu
bun run start:pairing    # atau pakai pairing code
```

</details>

### Login

1. Jalanin bot — **QR code** muncul di terminal
2. Buka WhatsApp → *Setelan → Perangkat tertaut → Tautkan perangkat*
3. Scan. Sesi disimpan di `sessions/` dan dipakai lagi tiap restart

Mau pakai kode? Jalanin dengan `--use-pairing-code` atau set `PAIRING_CODE=1`.

---

## 🔄 Update

- Jalanin **`.update`** (khusus owner) dari WhatsApp — bot backup
  `config.json` + `sessions/`, tarik kode terbaru, instal ulang
dependencies, rebuild engine stiker, typecheck, dan **restart
sendiri**. Kalau ada yang gagal dia rollback ke versi sebelumnya.
- Bot juga **cek update tiap start** dan log kalau ada yang baru.
- Channel: tambah `"updateChannel": "release"` di `config.json` buat
  ngikutin tag rilis terbaru, bukan `master` (default).

---

## ⚙️ Konfigurasi

| Variabel | Default | Fungsi |
|---|---|---|
| `SESSION_DIR` | `sessions` | Folder penyimpanan sesi login |
| `PAIRING_CODE` | — | Set `1` buat login pakai pairing code |
| `updateChannel` | `master` | `master` = ngikutin branch, `release` = ngikutin tag rilis terbaru |
| `IG_SESSIONID` | — | Cookie sesi IG cadangan buat stories `.instagram` saat snapsave down (pakai akun burner) |

**Command owner (`.ai`):** `config.json` (gitignored) otomatis dibuat dari
`config.example.json` saat boot pertama — tinggal tambah nomor HP-mu ke
`"owners"` (`628123...` polos atau JID full). List kosong = command owner
mati.

Bahasa balasan bot ada di file yang sama:

```json
{
  "owners": ["6281234567890"],
  "language": "id",
  "mode": "public",
  "prefixes": ["."],
  "maxDownloadMB": 100,
  "stickerPack": "Wakaru",
  "stickerAuthor": "buatan gweh"
}
```

`"language"` terima kode apa aja — `id` (default), `en`, `ja`, dan
lainnya. Bisa juga diganti live dari WhatsApp pakai `.setlang` — atau
tinggal minta `.ai` buat gantiin bahasanya.

Otak `.ai` ngobrol lewat **chatgpt.com anonim — gratis, tanpa setup**
(sidecar `native/ai/chatgpt-anon.py`: device random fresh + proof-of-work
per request, tanpa API key, tanpa login). Butuh `python3` + `curl_cffi`
(diinstal oleh `install.sh`); tanpanya fallback ke Poolside. Memori chat
ada di (`src/lib/aiHistory.ts`, per chat:sender, awet walau restart),
nggak pernah di backend.

`"mode"` terima `public` (semua orang, default), `self` (cuma command
yang dikirim dari akun bot sendiri), atau `private` (owner aja). Ganti
live pakai `.mode` — atau minta `.ai`.

`"prefixes"` adalah list prefix command (maks 5, tanpa spasi). Ganti live
pakai `.prefix <chars>` (mis. `.prefix !`, multi: `.prefix ! /`). Tambah
`none` biar command bare juga diterima (`.prefix ! / none`) — atau `none`
aja buat mode bare penuh. Kalau cuma prefix, command bare (`menu`) cuma
jalan kalau dikirim dua kali beruntun; kalau bare nyala langsung jalan.

`"maxDownloadMB"` membatasi download media (default 100, dijepit 10–2048).
Ganti live pakai `.limit <MB>` — atau minta `.ai`. File gede makan RAM
lebih banyak saat download (≈2-3×), jadi jangan gede-gede di HP kentang.
File di atas ~64MB nggak bisa diputar inline — bot kirim sebagai dokumen
aja (sampai 2GB, batas mutlak WhatsApp).

`"stickerPack"` / `"stickerAuthor"` adalah nama stiker default yang muncul
di WhatsApp — override per stiker pakai `.sticker <pack>|<author>` (mis.
`.sticker rawr|buatan gweh`).

---

## 🧰 Tech stack

<div align="center">

[![Skills](https://skillicons.dev/icons?i=ts,bun,nodejs,rust,py,githubactions)](https://skillicons.dev)

</div>

| Lapisan | Pilihan | Kenapa |
|---|---|---|
| Runtime | **Bun** (canary) · fallback Node ≥ 23.6 | TypeScript jalan langsung — tanpa build step, tanpa `tsx` |
| Protokol WhatsApp | **Baileys** | Client Web API yang teruji |
| Engine stiker | **Sidecar Rust** | Webp 512×512, support animasi, brat/toimg, semua codec dikompilasi di dalam |
| Engine audio | **Sidecar Rust** | AAC-dalam-fMP4 diremux jadi M4A standar buat iOS, lossless |
| Otak AI | **Sidecar Python** (`native/ai`, butuh `python3` + `curl_cffi`) + fallback Poolside | chatgpt.com anonim: device fresh + proof-of-work per request, tanpa key, tanpa login |
| Scraper | **TypeScript murni** | Tanpa yt-dlp / ffmpeg — nggak ada yang perlu dirawat |
| Logging | **pino** | Cepat, terstruktur, dipercantik |
| CI | **GitHub Actions** | Instal beneran dites di Ubuntu, macOS, Windows + Termux simulasi |

---

## 📁 Struktur proyek

<details>
<summary>Lihat layout source</summary>

```
src/
├── index.ts                 # entry: boot + signal handling
├── socket.ts                # lifecycle koneksi Baileys (reconnect, QR, pairing)
├── handlers/
│   └── messages.ts          # upsert → aturan drop → dispatch
├── commands/
│   ├── index.ts             # registry command statis (tambah import + entries buat daftar)
│   ├── main/                # ai/ (prompt, tools, exchange), menu, mode, prefix, limit, setlang, update
│   ├── downloader/          # ytmp3, ytmp4, play, tiktok, instagram, facebook,
│   │                        # pinterest, soundcloud, spotify, twitter
│   ├── converter/           # sticker, toimg, brat, toaudio, hd
│   └── group/               # kick, promote, demote, add
├── lib/
│   ├── scrapers/            # satu modul per platform + helper http/curl bersama
│   ├── queue.ts             # pool slot global + cooldown per user
│   ├── serialize.ts         # WAMessage → SerializedMessage flat (termasuk parsing tap)
│   ├── sender.ts            # reply/audio/video/sticker/react/list/buttons
│   ├── media.ts             # requireUrl, sendMedia (routing multi-file)
│   └── store · config · lang · llm · logger · aiHistory · factory ·
│       buttons · contributors · disk · updater · group
└── ../native/
    ├── sticker/             # Rust: engine webp (sticker/toimg/brat)
    ├── audio/               # Rust: remux fMP4 → M4A buat iOS
    └── ai/                  # Python: sidecar chatgpt-anon (butuh curl_cffi)
```

</details>

---

## 🤝 Kontribusi

PR welcome! Ini codebase kecil yang malas — jaga tetap begitu.

- Nemu bug? [Buka issue](https://github.com/salsabytes/Wakaru/issues)
- Mau fitur? Tempat yang sama
- Hormati [Code of Conduct](CODE_OF_CONDUCT.md)

<div align="center">

[![Contributors](https://contrib.rocks/image?repo=salsabytes/Wakaru)](https://github.com/salsabytes/Wakaru/graphs/contributors)

</div>

---

## 📄 Lisensi

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes)

---

## ❓ FAQ

<details>
<summary>Bun bisa jalan di Termux?</summary>

**Bisa.** Installer memaksa Bun masuk via `npm install -g bun` (jalan di
aarch64) dan menjaganya di canary terbaru. Kalau suatu saat gagal,
installer fallback anggun ke Node ≥ 23.6 — yang juga jalanin file
TypeScript langsung.

</details>

<details>
<summary>Kenapa `npm install` nggak narik `sharp`?</summary>

`sharp` (peer baileys) nggak punya prebuilt Android — npm bakal coba
compile libvips dari source di Termux dan menggagalkan seluruh instal.
`.npmrc` repo set `omit=peer`, jadi instal lolos. Trade-off: thumbnail
link-preview baileys nggak jalan; fitur media pakai sidecar Rust aja.

</details>

<details>
<summary>Bisa jalan dua instance?</summary>

Jangan pernah dua instance berbagi folder `sessions/` yang sama — mereka
saling tendang (`status 440`, `connectionReplaced`).

</details>

<details>
<summary>Ke-logout — ngapain?</summary>

Hapus `sessions/` dan scan QR lagi. Kredensial nggak pernah nyentuh
repo — foldernya gitignored.

</details>

<details>
<summary>Hosting di Termux — ada yang spesial?</summary>

Jaga HP tetap melek dengan `termux-wake-lock`. Perlu dicatat `.facebook`
bergantung ke `curl` sistem — jalan di Windows/Bun; di host Linux
beberapa backend bisa ngeblok. Link share (`facebook.com/share/…`) resolve
via fallback fdown.world.

</details>

---

## 🏷️ Versi

Wakaru ikut [Semantic Versioning](https://semver.org/) — `major.minor.patch`
(mis. `1.1.0`).

| Kenaikan | Kapan |
|---|---|
| `major` | Perubahan breaking |
| `minor` | Fitur baru (`1.1.0`, `1.2.0`, …) |
| `patch` | Perbaikan bug (`1.1.1`, `1.1.2`, …) |

---

## 📦 Changelog

<details>
<summary>Perubahan terbaru</summary>

**Belum dirilis**
- `.toaudio`: video yang di-quote → audio m4a via engine Rust (sample copy, tanpa re-encode)
- `.hd`: foto yang di-quote → upscale AI 2x via scraper iloveimg, fallback sharpen Rust

**v1.2.0**
- Command `.prefix`: prefix custom, multi-prefix (`.prefix ! /`), atau mode bare tanpa prefix (`.prefix none`) — juga bisa via `"prefixes"` di `config.json`
- Command bare butuh double-tap kalau prefix diset (aman dari chat); langsung jalan di mode bare
- Fix: `queryText` makan satu karakter kalau ada spasi setelah prefix (`. brat halo` → `t halo`)
- Sync README: sidecar AI Python di tech stack, tabel 26 command full, tree proyek live

**v1.1.1**
- Command `.mode`: gate balasan `public` (semua orang) / `self` (cuma akun bot) / `private` (owner aja), bisa live atau via `config.json`
- `.brat`: stiker meme ala brat (Arial Narrow, blur, case-sensitive) dari engine Rust
- `.toimg`: quote stiker → PNG via engine Rust
- `.facebook` handle link share via fallback fdown.world (flow port dari AyGemuy/api-wudysoft v8)
- Command balik ke registry statis — daftar = tambah import + entry di `src/commands/index.ts`

**v1.1.0** — balik ke [semver](https://semver.org/) (rilis `YY.MM.R` yang sebentar itu dibuang; ini kode yang sama, dirilis ulang bersih)
- Fix audio iPhone: "mp3"-nya ytmp3 itu AAC dalam MP4 fragmented (iOS nolak muter) — engine Rust `native/audio` baru meremux jadi M4A standar (lossless, tanpa dep codec)
- Hasil `.play` sekarang kerender di mana aja: tombol quick_reply + teks bernomor (list native-flow lama blank di iOS) — tetap bisa dibalas `1 mp3`
- Cancel `.play`: tombol `❌ Batal` di list & pick format, atau ketik `batal`/`gajadi`/`cancel`; ngobrol soal lain nggak lagi dispam balasan
- `.add` terima `+62` pakai spasi/strip
- Log boot cetak `Wakaru v<version> (<commit>)` biar restart bisa diverifikasi
- Manajemen grup: `.kick @member` (tag atau reply) dan `.add <number>` (terima format `+62`, beberapa nomor)
- `.kick`/`.add` dijaga: cuma admin grup/owner, bot harus admin
- LID→PN diresolve sekali di batas pesan; mention tetap mentah — command cocok ke semua bentuk jid
- Command auto-discovery dari `commands/` — command baru = daftarin di entries `index.ts` statis (kategori dari nama folder)
- Stiker: isi kanvas 512 edge-to-edge dengan letterbox transparan; 24 fps, cap 7 dtk, tangga ≤500 KB
- EXIF stiker ditulis ulang ke payload JSON yang dibaca WhatsApp sekarang (nama pack muncul lagi)
- Windows: `sticker.exe` bawa DLL MinGW-nya — fix crash diam-diam `code 53` di PATH bersih

**v1.0.0**
- Multitasking: tiap command jalan barengan — satu pool slot global, tanpa flag per command
- Cooldown 5 dtk per user buat command berat (downloader + stiker)
- Download media dibatasi 30 MB (RAM puncak lebih rendah)
- AI melaporkan hasil download beneran: judul · durasi · ukuran
- Bahasa balasan bisa diatur via `config.json` / `.setlang` / `.ai`
- Modularisasi dalam: `lib/scrapers/*`, `socket.ts`, `ai/`, `queue` + `serialize` + `sender` + `media`
- Pick dua tahap `.play`: cari → ketuk hasil → tombol MP3/MP4 (list native-flow)
- Downloader baru: `.facebook` (HD) dan `.pinterest` (link pin atau query)
- Hasil multi-file sekarang mendarat di chat pribadi, bukan grup
- Parsing tap/button disatukan — semua bentuk pesan interaktif kehandle
- Installer Termux: paksa Bun via npm, upgrade canary otomatis, CI Termux simulasi

**Sebelumnya**
- Performance pass: antre paralel per chat, cap konkurensi global, cache LID→PN, TTL history AI, caching cookie ytmp3
- Downloader Instagram full (reels, carousel, stories) dengan fallback snapsave
- Downloader TikTok tanpa watermark (judul asli, POST sekali tembak)
- `.ai` agen dengan eksekusi tool (`@run:`) dan memori per pengirim
- Engine stiker Rust dengan support webp animasi

</details>

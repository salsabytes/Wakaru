<div align="center">

# ✨ Wakaru

**分かる — *"mengerti."* Bot WhatsApp mungil yang nyambung diajak ngobrol.**

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)

<p>🌐 <a href="README.md">English</a> · <b>Bahasa Indonesia</b> · <a href="README.ja.md">日本語</a></p>

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## 🚀 Jalanin

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && npm run start
```

1. QR muncul → scan dari WhatsApp (*Setelan → Perangkat tertaut*)
2. Beres. Sesi tersimpan di `sessions/`

> Windows? Buka [`install.bat`](install.bat), klik dua kali.

<details>
<summary>Setup manual / pairing code</summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # sekali aja: compile engine stiker Rust
npm run start           # atau: npm run start:pairing
```

Login pakai kode: `npm run start:pairing` atau set `PAIRING_CODE=1`.

</details>

---

## 💡 Bisa apa aja

- 🧠 `.ai` — ngobrol + jalanin command buat kamu (`@run:`), ingat konteks
- 🎬 Downloader — YouTube, TikTok, IG, FB, Pinterest, SoundCloud, Spotify, X
- 🖼️ Stiker & media — foto/video → stiker, stiker → foto, video → audio, upscale AI
- 👥 Tools grup — kick / promote / demote / add
- 📱 Jalan di Termux, tanpa root. Tanpa yt-dlp, tanpa ffmpeg

---

## 📜 Commands

Kirim `.menu` di WhatsApp buat liat daftar live + alias.

<details>
<summary>Lihat semua command</summary>

**Ngobrol**
`.ai` — chat agen · `.menu` — list semua · `.wiki` — cari Wikipedia · `.setlang` — ganti bahasa

**Stiker & media** (reply foto/video/stiker)
`.sticker` — → stiker · `.toimg` — stiker → foto · `.brat` — teks → meme stiker · `.toaudio` — video → audio · `.hd` — upscale AI 2x

**Downloader**
`.play` — cari YouTube → mp3/mp4 · `.ytmp3` / `.ytmp4` — link → audio/video
`.tiktok` · `.instagram` · `.facebook` · `.pinterest` · `.soundcloud` · `.spotify` · `.twitter`

**Grup** (khusus admin/owner)
`.kick` · `.promote` · `.demote` · `.add`

**Khusus owner**
`.mode` (public/self/private) · `.prefix` · `.limit` (10–2048 MB) · `.update`

Hasil multi-file (carousel IG, Pinterest) dikirim ke **chat pribadi**.

</details>

---

## ⚙️ Konfigurasi

`config.json` otomatis dibuat saat boot pertama. Cuma ini yang penting:

```json
{ "owners": ["6281234567890"], "language": "id" }
```

Tambah nomormu → command owner kebuka. Sisanya liat [`config.example.json`](config.example.json) (`mode`, `prefixes`, `maxDownloadMB`, `stickerPack`…).

<details>
<summary>Lanjutan</summary>

- Otak `.ai`: gratis, tanpa key — sidecar Python (`native/ai`, butuh `python3` + `curl_cffi`, diinstal `install.sh`), fallback Poolside
- Live dari WhatsApp: `.setlang`, `.mode`, `.prefix`, `.limit` — atau tinggal minta `.ai`
- Env: `SESSION_DIR` (default `sessions`), `PAIRING_CODE=1`, `WAKAFY_API_KEY` (opsional — key gratis sudah bawaan selama API masih beta), `IG_SESSIONID` (cookie burner cadangan buat stories IG)
- Update: kirim `.update` dari WhatsApp (backup, pull, rebuild, restart, rollback kalau gagal)

</details>

---

## ❓ Mentok?

<details>
<summary>Dua instance saling tendang (440)?</summary>

Jangan pernah berbagi satu folder `sessions/`. Satu folder = satu bot.

</details>

<details>
<summary>Ke-logout?</summary>

Hapus `sessions/` lalu scan ulang.

</details>

<details>
<summary>Termux ketiduran?</summary>

Jalanin `termux-wake-lock`.

</details>

---

## 🤝 Kontribusi

Codebase kecil yang malas — jaga tetap begitu. Nemu bug / punya ide? [Buka issue](https://github.com/salsabytes/Wakaru/issues). PR welcome.

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes) · [Rilis](https://github.com/salsabytes/Wakaru/releases) · Dibangun di atas [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript + Node + Rust

---

<div align="center">

## ⭐ kasih star dong

Wakaru kerja gratis, mintanya cuma satu: star.<br>
Nggak kasih star = bot nangis di `sessions/`. Masa tega bikin bot nangis? 🥺

</div>

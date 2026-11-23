<div align="center">

# Wakaru (分かる)

**“Mengerti.”** — bot WhatsApp mungil berbasis [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript.

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-join-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

<p><a href="README.md">English</a> · <b>Bahasa Indonesia</b> · <a href="README.ja.md">日本語</a></p>

<img src="https://media.giphy.com/media/pwkpuW7xF9BflrrYpB/giphy.gif" alt="Wakaru" width="480" />

</div>

Wakaru menjalankan TypeScript langsung di Node.js (tanpa build step). Bisa chat, download media, bikin stiker, kelola grup, dan punya mode `.ai` agentic yang bisa menjalankan command bot — serta, untuk owner, menginspeksi/mengedit repo ini dengan aman.

## Fitur

- **AI agentic (`.ai`)** — chat, ingat konteks per chat, dan jalankan command bot lewat `@run:<cmd>`. Mode owner bisa baca/edit repo dengan tool marker (`@read/@ls/@grep/@write/@edit/@rm/@typecheck/@test/@done`), dibatasi ke `src/`, `test/`, dan docs, dengan rollback otomatis kalau verifikasi gagal.
- **Downloader** — YouTube (`.play`, `.ytmp3`, `.ytmp4`), TikTok, Instagram, Facebook, Pinterest, SoundCloud, Spotify, X/Twitter.
- **Stiker & media** — foto/video ke stiker, stiker ke gambar, video ke audio, brat sticker, AI upscale (`.hd`).
- **Tools grup** — kick/promote/demote/add, hidetag, anti-link, anti-delete, welcome/goodbye.
- **Utilitas** — menu, Wikipedia, pengingat, Family 100, AFK, stats, dll. Kirim `.menu` di WhatsApp untuk daftar live.
- **Ringan** — jalan di Termux (tanpa root). Fitur inti tidak butuh yt-dlp/ffmpeg; stiker pakai Rust sidecar kecil.

## Kebutuhan

- **Node.js >= 23.6** (pakai Node type-stripping untuk `.ts`)
- npm
- Rust toolchain hanya jika ingin build sticker sidecar (`npm run build:sticker`)

## Mulai Cepat

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru
npm run start
```

Scan QR dari WhatsApp: *Setelan > Perangkat tertaut*. Sesi tersimpan di `sessions/`.

**Windows:** jalankan [`install.bat`](install.bat), atau pakai setup manual di bawah.

<details>
<summary><b>Setup manual / pairing code</b></summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # opsional, sekali saja
npm run start           # QR
# atau: npm run start:pairing
# atau: PAIRING_CODE=1 npm run start
```

</details>

## Konfigurasi

`config.json` dibuat otomatis saat pertama jalan (gitignored). Contoh minimal:

```json
{
  "owners": ["6281234567890"],
  "language": "id"
}
```

| Key | Fungsi |
|---|---|
| `owners` | Nomor/JID yang boleh pakai command owner. Kosong = command owner dinonaktifkan. |
| `language` | Bahasa balasan default (`id`, `en`, `ja`, dll.). |
| `mode` | `public`, `self`, atau `private`. |
| `prefixes` | Prefix command. |
| `maxDownloadMB` | Batas ukuran download. |
| `markOnline` | Jaga status bot tetap online saat connect. |

Lihat [`config.example.json`](config.example.json) untuk opsi lengkap. Sebagian besar bisa diubah dari WhatsApp lewat `.setlang`, `.mode`, `.prefix`, `.limit`, atau minta `.ai`.

## Command

Kirim **`.menu`** di WhatsApp untuk daftar command terbaru.

| Kategori | Contoh |
|---|---|
| AI / chat | `.ai`, `.menu`, `.wiki`, `.setlang`, `.remind`, `.afk` |
| Media / stiker | `.sticker`, `.toimg`, `.brat`, `.toaudio`, `.hd` |
| Downloader | `.play`, `.ytmp3`, `.ytmp4`, `.tiktok`, `.instagram`, `.facebook`, `.pinterest`, `.soundcloud`, `.spotify`, `.twitter` |
| Grup | `.kick`, `.promote`, `.demote`, `.add`, `.hidetag`, `.antilink`, `.antidelete`, `.welcome`, `.goodbye` |
| Game | `.family100` |
| Owner | `.mode`, `.prefix`, `.limit`, `.update`, `.eval`, `.aistatus` |

## Catatan AI

- `.ai <pesan>` bisa chat biasa atau menjalankan command bot (`@run:<cmd>`).
- Mode repo owner hanya untuk workspace ini. Edit dibatasi ke `src/`, `test/`, dan docs; perubahan diverifikasi dengan typecheck/test dan rollback otomatis kalau gagal.
- Pakai `@repo ...` atau `@chat ...` untuk memaksa mode.
- Backend: Wakafy AI API. `WAKAFY_API_KEY` opsional; public key sudah built-in. `WAKARU_AI_MODEL`, `WAKARU_AI_FREE`, dan `aiFree` mengatur perilaku.

## Development

```bash
npm install
npm run typecheck
npm test
npm run start
npm run build:sticker
```

- Kode app tidak butuh build step; import pakai ekstensi `.ts` eksplisit.
- Command ada di `src/commands/<category>/<name>.ts` dan auto-register dari default export.
- Helper bersama taruh di `src/lib/`.

## Troubleshooting

- **Dua instance bentrok (`440` / `connectionReplaced`)** — jangan jalankan dua bot di folder `sessions/` yang sama.
- **Logout / perlu relink** — hapus `sessions/` lalu scan ulang.
- **Balasan hilang di linked device** — cek tidak ada instance ganda, relink sesi, dan coba `markOnline: false` di `config.json` jika perlu.
- **Termux tidur** — jalankan `termux-wake-lock`.
- **Stiker gagal** — build sidecar dengan `npm run build:sticker`. `sharp` memang tidak diinstall.
- **`.ai` lambat/error** — panggilan LLM punya timeout ~120 detik; backend lambat/down mengembalikan error, bukan crash.

## Kontribusi

Jaga perubahan tetap kecil dan praktis. Issue dan PR welcome.

- [Buka issue](https://github.com/salsabytes/Wakaru/issues)
- [Grup WhatsApp](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

## Lisensi

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes). Dibangun di atas [Baileys](https://github.com/whiskeysockets/Baileys).

---

<div align="center">

Kalau Wakaru kepake, kasih ⭐ di repo ini ya.

</div>

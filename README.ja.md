<div align="center">

# ✨ Wakaru

**分かる — 小さくて話の通じるWhatsAppボット。**

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/WXk69eF4A)

<p>🌐 <a href="README.md">English</a> · <a href="README.id.md">Bahasa Indonesia</a> · <b>日本語</b></p>

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## 🚀 起動

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && npm run start
```

1. QRが表示 → WhatsApp（設定 → リンク済みデバイス）でスキャン
2. 以上。セッションは`sessions/`に保存

> Windows? [`install.bat`](install.bat)をダブルクリック。

<details>
<summary>手動セットアップ / ペアリングコード</summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # 初回のみ：Rustステッカーエンジンをコンパイル
npm run start           # or: npm run start:pairing
```

コードでログイン：`npm run start:pairing` or `PAIRING_CODE=1`を設定。

</details>

---

## 💡 できること

- 🧠 `.ai` — 会話＋コマンド代行（`@run:`）、文脈を記憶
- 🎬 ダウンローダー — YouTube、TikTok、IG、FB、Pinterest、SoundCloud、Spotify、X
- 🖼️ ステッカー＆メディア — 写真・動画→ステッカー、ステッカー→画像、動画→音声、AIアップスケール
- 👥 グループ管理 — kick / promote / demote / add
- 📱 Termuxで動く、root不要。yt-dlp・ffmpegなし

---

## 📜 コマンド

ライブ一覧はWhatsAppで`.menu`（エイリアス付き）。

<details>
<summary>全コマンドを表示</summary>

**チャット**
`.ai` — エージェント会話 · `.menu` — 一覧 · `.wiki` — Wikipedia検索 · `.setlang` — 言語切替

**ステッカー＆メディア**（写真・動画・ステッカーに返信）
`.sticker` — →ステッカー · `.toimg` — ステッカー→画像 · `.brat` — テキスト→ミーム · `.toaudio` — 動画→音声 · `.hd` — 2x AIアップスケール

**ダウンローダー**
`.play` — YouTube検索→mp3/mp4 · `.ytmp3` / `.ytmp4` — リンク→音声・動画
`.tiktok` · `.instagram` · `.facebook` · `.pinterest` · `.soundcloud` · `.spotify` · `.twitter`

**グループ**（管理者／ownerのみ）
`.kick` · `.promote` · `.demote` · `.add`

**ownerのみ**
`.mode`（public/self/private） · `.prefix` · `.limit`（10–2048MB） · `.update`

複数ファイル（IGカルーセル、Pinterest）は**プライベートチャット**に届きます。

</details>

---

## ⚙️ 設定

`config.json`は初回起動時に自動生成。必要なのはこれだけ：

```json
{ "owners": ["6281234567890"], "language": "id" }
```

番号を追加 → オーナーコマンドが開放。その他は[`config.example.json`](config.example.json)参照（`mode`、`prefixes`、`maxDownloadMB`、`stickerPack`…）。

<details>
<summary>応用</summary>

- `.ai`脳：無料・キー不要 — Pythonサイドカー（`native/ai`、`python3`＋`curl_cffi`が必要、`install.sh`が導入）、Poolsideフォールバック
- WhatsAppからライブ変更：`.setlang`、`.mode`、`.prefix`、`.limit` — or `.ai`に頼むだけ
- Env：`SESSION_DIR`（既定`sessions`）、`PAIRING_CODE=1`、`WAKAFY_API_KEY`（任意 — ベータ中はフリーキー内蔵）
- 更新：WhatsAppから`.update`（バックアップ→取得→再構築→再起動、失敗時はロールバック）

</details>

---

## ❓ 困ったら

<details>
<summary>2インスタンスが蹴り合う（440）？</summary>

`sessions/`の共有は厳禁。1フォルダ＝1ボット。

</details>

<details>
<summary>ログアウトされた？</summary>

`sessions/`を削除して再スキャン。

</details>

<details>
<summary>Termuxが寝る？</summary>

`termux-wake-lock`を実行。

</details>

---

## 🤝 コントリビュート

小さく怠惰なコードベース — そのままに。バグ・要望は[issueへ](https://github.com/salsabytes/Wakaru/issues)。PR歓迎。質問は[Discordへ](https://discord.gg/WXk69eF4A)。

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes) · [リリース](https://github.com/salsabytes/Wakaru/releases) · [Baileys](https://github.com/whiskeysockets/Baileys)＋TypeScript＋Node＋Rust

---

<div align="center">

## ⭐ スターください

Wakaruは無料で働きます。お礼はスターひとつだけ。<br>
スターなし＝ボットが`sessions/`で泣きます。泣かせたくないでしょ？🥺

</div>

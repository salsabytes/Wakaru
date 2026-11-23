<div align="center">

# Wakaru (分かる)

**「わかる。」** — [Baileys](https://github.com/whiskeysockets/Baileys) + TypeScript で作られた小さな WhatsApp ボット。

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-join-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

<p><a href="README.md">English</a> · <a href="README.id.md">Bahasa Indonesia</a> · <b>日本語</b></p>

<img src="https://media.giphy.com/media/pwkpuW7xF9BflrrYpB/giphy.gif" alt="Wakaru" width="480" />

</div>

Wakaru は Node.js 上で TypeScript を直接実行します（ビルド不要）。チャット、メディアダウンロード、ステッカー、グループ管理、そして bot コマンドを実行できる agentic `.ai` を備えています。オーナー向けには、このリポジトリを安全に確認・編集するモードもあります。

## 機能

- **Agentic AI (`.ai`)** — チャット、チャットごとの文脈保持、`@run:<cmd>` による bot コマンド実行。オーナーモードでは `@read/@ls/@grep/@write/@edit/@rm/@typecheck/@test/@done` を使い、`src/`・`test/`・docs に限定して repo を編集できます。検証失敗時は自動ロールバックします。
- **ダウンローダー** — YouTube (`.play`, `.ytmp3`, `.ytmp4`)、TikTok、Instagram、Facebook、Pinterest、SoundCloud、Spotify、X/Twitter。
- **ステッカー / メディア** — 写真/動画→ステッカー、ステッカー→画像、動画→音声、brat sticker、AI upscale (`.hd`)。
- **グループツール** — kick/promote/demote/add、hidetag、anti-link、anti-delete、welcome/goodbye。
- **ユーティリティ** — menu、Wikipedia、reminder、Family 100、AFK、stats など。最新一覧は WhatsApp で `.menu` を送信。
- **軽量** — Termux で動作（root 不要）。コア機能に yt-dlp/ffmpeg は不要。ステッカーは小さな Rust sidecar を使用。

## 必要環境

- **Node.js >= 23.6**（`.ts` を直接実行）
- npm
- Rust toolchain は sticker sidecar をビルドする場合のみ（`npm run build:sticker`）

## クイックスタート

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru
npm run start
```

WhatsApp の *設定 > リンク済みデバイス* から QR をスキャンしてください。セッションは `sessions/` に保存されます。

**Windows:** [`install.bat`](install.bat) を実行するか、手動セットアップを使ってください。

<details>
<summary><b>手動セットアップ / ペアリングコード</b></summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
npm install
npm run build:sticker   # 任意、初回のみ
npm run start           # QR
# または: npm run start:pairing
# または: PAIRING_CODE=1 npm run start
```

</details>

## 設定

初回起動時に `config.json` が作成されます（gitignored）。最小例:

```json
{
  "owners": ["6281234567890"],
  "language": "id"
}
```

| Key | 説明 |
|---|---|
| `owners` | owner 専用コマンドを使える番号/JID。空の場合は owner コマンド無効。 |
| `language` | 既定の返答言語（`id`, `en`, `ja` など）。 |
| `mode` | `public`, `self`, `private`。 |
| `prefixes` | コマンド prefix。 |
| `maxDownloadMB` | ダウンロードサイズ上限。 |
| `markOnline` | 接続時に bot をオンライン表示に保つ。 |

全オプションは [`config.example.json`](config.example.json) を参照。多くは WhatsApp から `.setlang`, `.mode`, `.prefix`, `.limit` または `.ai` で変更できます。

## コマンド

最新の一覧は WhatsApp で **`.menu`** を送信してください。

| カテゴリ | 例 |
|---|---|
| AI / chat | `.ai`, `.menu`, `.wiki`, `.setlang`, `.remind`, `.afk` |
| Media / sticker | `.sticker`, `.toimg`, `.brat`, `.toaudio`, `.hd` |
| Downloader | `.play`, `.ytmp3`, `.ytmp4`, `.tiktok`, `.instagram`, `.facebook`, `.pinterest`, `.soundcloud`, `.spotify`, `.twitter` |
| Group | `.kick`, `.promote`, `.demote`, `.add`, `.hidetag`, `.antilink`, `.antidelete`, `.welcome`, `.goodbye` |
| Game | `.family100` |
| Owner | `.mode`, `.prefix`, `.limit`, `.update`, `.eval`, `.aistatus` |

## AI メモ

- `.ai <message>` は通常チャット、または bot コマンド実行（`@run:<cmd>`）ができます。
- Owner repo mode はこの workspace 専用です。編集は `src/`、`test/`、docs に限定され、typecheck/test で検証され、失敗時はロールバックされます。
- `@repo ...` / `@chat ...` でモードを強制できます。
- Backend: Wakafy AI API。`WAKAFY_API_KEY` は任意（public key 内蔵）。`WAKARU_AI_MODEL`、`WAKARU_AI_FREE`、`aiFree` で挙動を調整できます。

## 開発

```bash
npm install
npm run typecheck
npm test
npm run start
npm run build:sticker
```

- app code はビルド不要。import は明示的な `.ts` 拡張子を使います。
- コマンドは `src/commands/<category>/<name>.ts` に置き、default export から自動登録されます。
- 共通ヘルパーは `src/lib/` に置きます。

## トラブルシューティング

- **2つのインスタンスが競合 (`440` / `connectionReplaced`)** — 同じ `sessions/` フォルダで 2 つ起動しないでください。
- **ログアウト / 再リンクが必要** — `sessions/` を削除して再スキャン。
- **リンク済みデバイスに返信が出ない** — 重複インスタンス確認、セッション再リンク、必要なら `config.json` の `markOnline: false` を試してください。
- **Termux がスリープする** — `termux-wake-lock` を実行。
- **ステッカー失敗** — `npm run build:sticker` で sidecar をビルド。`sharp` は意図的に未インストールです。
- **`.ai` が遅い/エラー** — LLM 呼び出しは約 120 秒でタイムアウト。backend 遅延/障害時はクラッシュせずエラーを返します。

## コントリビュート

変更は小さく実用的に。Issue / PR 歓迎です。

- [Issue を開く](https://github.com/salsabytes/Wakaru/issues)
- [WhatsApp グループ](https://chat.whatsapp.com/J3xJXknrXUA3kuWfVXXsyD)

## ライセンス

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes). Built on [Baileys](https://github.com/whiskeysockets/Baileys).

---

<div align="center">

Wakaruが役に立ったら、⭐ をもらえると嬉しいです。

</div>

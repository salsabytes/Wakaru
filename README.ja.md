<div align="center">

# ✨ Wakaru

**分かる — *「理解すること。」***

エージェント脳を持つ小さなWhatsAppボット。おしゃべりしたり、曲を取って
きたり、動画を保存したり、写真をステッカーに変えたり — 全部、自分で
増やせるコマンドリストから。

[![Version](https://img.shields.io/github/v/release/salsabytes/Wakaru?style=for-the-badge&color=F472B6)](https://github.com/salsabytes/Wakaru/releases)
[![License: MIT](https://img.shields.io/github/license/salsabytes/Wakaru?style=for-the-badge&color=94A3B8)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/salsabytes/Wakaru/install.yml?style=for-the-badge&label=install&color=818CF8)](https://github.com/salsabytes/Wakaru/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-7DD3FC?style=for-the-badge&logo=typescript&logoColor=0F172A)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1E293B?style=for-the-badge&logo=bun&logoColor=FDE68A)](https://bun.sh/)
[![Rust](https://img.shields.io/badge/Rust%20sidecar-D97706?style=for-the-badge&logo=rust&logoColor=white)](native/sticker)
[![CodeFactor](https://img.shields.io/codefactor/grade/github/salsabytes/wakaru/master?style=for-the-badge&logo=codefactor&logoColor=white&label=CodeFactor)](https://www.codefactor.io/repository/github/salsabytes/wakaru)

<p>🌐 <a href="README.md">English</a> · <a href="README.id.md">Bahasa Indonesia</a> · <b>日本語</b></p>

</div>

---

## 🧠 Wakaruとは？

[Baileys](https://github.com/whiskeysockets/Baileys)＋TypeScriptの**セルフホスト
WhatsAppボット** — yt-dlpなし、ffmpegなし、自前サーバーなし。Pure-TS
スクレイパー、小さなRustサイドカー、AI脳のPythonサイドカーだけで全部
解決。

1つのコード、3つのランタイム：デスクトップは**Bun**、Termuxは**Bunまたは
Node ≥ 23.6**、どの環境もワンライナーで導入。話しかけるもよし、仕事を
させるもよし。

<div align="center">

<img src="assets/wakaru-banner.gif" alt="Wakaru — anime banner" width="820" />

</div>

---

## ✨ 機能

- 🧠 **話が通じる** — `.ai`は自然に会話し、`@run:`でコマンドを自走、会話ごとに記憶
- 🎬 **メディア上手** — リンクから音声・動画を取得、YouTubeをクエリ検索、写真＆動画からステッカー作成（`.brat`ミーム、`.toimg`ステッカー→画像、`.toaudio`動画→音声、`.hd` AIアップスケール付き）
- 🧩 **拡張しやすい** — `src/commands/index.ts`に登録すれば`.menu`に自動表示
- 🔁 **落ちない** — 指数バックオフで自動再接続
- 🔐 **簡単ログイン** — QRコード or ペアリングコード
- 📱 **スマホで動く** — root不要の本格Termux対応
- 🎨 **ログが可愛い** — charmbracelet風コンソール出力、時刻のみタイムスタンプ
- ⚡ **速くて安い** — 全コマンド並列実行（グローバル単一スロットプール）、重いコマンドはユーザー毎クールダウン、DL上限を変更可（デフォルト100MB）、自前サーバー不要

---

## 📜 コマンド

ライブ一覧はWhatsAppで`.menu`を送信。括弧内はエイリアス。

| コマンド | エイリアス | 内容 |
|---|---|---|
| `.ai <msg>` | — | エージェント会話。`@run:`でコマンド実行、送信者ごとに記憶 |
| `.menu` | `.help` | 全コマンド一覧 |
| `.sticker` | `.st` | 引用した写真・動画 → 512×512 webpステッカー（`.sticker <pack>\|<author>`で名付け可） |
| `.toimg` | `.toimage` | 引用したステッカー → PNG画像 |
| `.brat <text>` | — | テキストから白brat風ミームステッカー |
| `.toaudio` | `.tomp3`、`.tomp4a`、`.toaud` | 引用した動画 → m4a音声（抽出、再エンコードなし） |
| `.hd` | `.remini`、`.upscale` | 引用した写真 → 2x AIアップスケール（iloveimg、Rustフォールバック） |
| `.ytmp3 <url>` | `.ytm`, `.music` | 任意の動画リンク → mp3音声 |
| `.ytmp4 <url>` | `.ytv`, `.video` | 任意の動画リンク → mp4動画 |
| `.play <query>` | `.yt`, `.song` | YouTube検索 → 結果をタップ → mp3/mp4選択 |
| `.tiktok <url>` | `.tt`, `.ttdl` | TikTok動画、透かしなし |
| `.instagram <url>` | `.ig`, `.igdl` | IGリール・動画・写真＆カルーセル、透かしなし |
| `.facebook <url>` | `.fb`, `.fbdl` | Facebook動画 or 写真 |
| `.pinterest <url\|query>` | `.pin`, `.pins` | ピンリンクから画像取得、or クエリ検索 |
| `.soundcloud <url>` | `.sc` | SoundCloudトラック → 音声（mp3）、透かしなし |
| `.spotify <url>` | `.sp` | Spotifyトラック／アルバム → YouTubeでマッチ → 音声 |
| `.twitter <url>` | `.x`, `.tw`, `.twdl` | X（Twitter）動画、透かしなし |
| `.kick` | `.tendang`, `.keluarkan` | メンバーをキック（タグ or 返信、グループ管理者／ownerのみ） |
| `.promote` | `.angkat` | メンバーを管理者に昇格（タグ or 返信、グループ管理者／ownerのみ） |
| `.demote` | `.turunkan` | 管理者をメンバーに降格（タグ or 返信、グループ管理者／ownerのみ） |
| `.add <number>` | `.tambah` | 電話番号でメンバー追加（グループ管理者／ownerのみ） |
| `.setlang <code>` | `.lang`, `.bahasa` | ボットの返信言語を切替、任意コード（`id`/`en`/`ja`/…） |
| `.wiki <query>` | `.wikipedia`、`.wk` | ボット言語のWikipediaを検索＋記事リンク |
| `.mode <public\|self\|private>` | `.self` | ボットの利用範囲：全員・このアカウントのみ・ownerのみ（ownerのみ） |
| `.prefix <chars\|none>` | — | コマンド接頭辞、複数可、bareモード可（ownerのみ） |
| `.limit <MB>` | — | メディアDL上限、10–2048MB（ownerのみ） |
| `.update` | — | 最新コードを取得・再構築・再起動（ownerのみ） |

複数ファイルの結果（IGカルーセル、Pinterest検索）はグループを荒らさない
よう**プライベートチャット**に届きます。

---

## 🚀 クイックスタート

### ワンライナー（全環境）

```bash
curl -fsSL https://raw.githubusercontent.com/salsabytes/Wakaru/master/install.sh | bash
cd wakaru && bun run start
```

インストーラーが環境を検出し、ランタイム・依存関係・ネイティブ
ステッカーエンジンを導入。再実行で**Bunを最新canaryに自動維持**
（`bun upgrade --canary`）。

### Windows

[`install.bat`](install.bat)をダウンロードしてダブルクリック（or `cmd`で
実行）。Git＋Bunを`winget`で入れ、clone・依存導入・ステッカーエンジンを
コンパイルして起動します。

### 手動（Bun）

<details>
<summary>手動セットアップを表示</summary>

```bash
git clone https://github.com/salsabytes/Wakaru.git
cd Wakaru
bun install
bun run build:sticker   # 初回のみ：Rustステッカーエンジンをコンパイル
                        # （WindowsではMinGW DLLもexeの隣に同梱）

bun run start            # スマホでQRをスキャン
bun run start:pairing    # or ペアリングコードを使う
```

</details>

### ログイン

1. ボットを起動 — 端末に**QRコード**が表示されます
2. WhatsAppを開く → *設定 → リンク済みデバイス → デバイスをリンク*
3. スキャン。セッションは`sessions/`に保存され再起動後も再利用

コード派？ `--use-pairing-code`付きで起動 or `PAIRING_CODE=1`を設定。

---

## 🔄 更新

- WhatsAppから**`.update`**（ownerのみ）を実行 — `config.json`＋
  `sessions/`をバックアップし、最新コードを取得・依存を再導入・
ステッカーエンジンを再構築・型検査して**自動再起動**。失敗時は前の
バージョンにロールバック。
- ボットは**起動ごとに更新をチェック**し、新版があればログに出します。
- チャンネル：`config.json`に`"updateChannel": "release"`を追加すると
  `master`（デフォルト）の代わりに最新リリースタグを追跡。

---

## ⚙️ 設定

| 変数 | デフォルト | 用途 |
|---|---|---|
| `SESSION_DIR` | `sessions` | ログインセッションの保存先 |
| `PAIRING_CODE` | — | `1`でペアリングコードログイン |
| `updateChannel` | `master` | `master`＝ブランチ追跡、`release`＝最新リリースタグ追跡 |
| `IG_SESSIONID` | — | snapsave不調時の`.instagram`ストーリー用予備IGセッションcookie（捨て垢推奨） |

**オーナーコマンド（`.ai`）：** 初回起動時に`config.example.json`から
`config.json`（gitignored）が自動生成 — `"owners"`に電話番号を追加するだけ
（`628123...`形式 or フルJID）。空リストだとオーナーコマンド無効。

ボットの返信言語も同じファイル：

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

`"language"`は任意コード — `id`（デフォルト）、`en`、`ja`など。WhatsApp
から`.setlang`でライブ切替も可 — or `.ai`に頼むだけ。

`.ai`脳は**chatgpt.com匿名 — 無料・設定不要**（`native/ai/chatgpt-anon.py`
サイドカー：リクエスト毎にランダムfresh device＋proof-of-work、APIキー
不要・ログイン不要）。`python3`＋`curl_cffi`が必要（`install.sh`が導入）、
なければPoolsideにフォールバック。会話記憶は（`src/lib/aiHistory.ts`、
chat:sender毎、再起動後も保持）側にあり、バックエンドには置きません。

`"mode"`は`public`（全員、デフォルト）、`self`（ボット自身のアカウント
からのコマンドのみ）、`private`（ownerのみ）。`.mode`でライブ切替 — or
`.ai`に頼む。

`"prefixes"`はコマンド接頭辞リスト（最大5、空白なし）。`.prefix <chars>`
でライブ切替（例`.prefix !`、複数：`.prefix ! /`）。`none`を追加すると
bareコマンドも受付（`.prefix ! / none`）— `none`単体で完全bareモード。
接頭辞のみの場合、bareの`menu`は2連続送信で発火（チャット誤爆防止）、
bare有効時は即発火。

`"maxDownloadMB"`はメディアDL上限（デフォルト100、10–2048に丸め）。
`.limit <MB>`でライブ切替 — or `.ai`に頼む。大容量はDL中にRAMを食う
（約2-3倍）ので非力なスマホは低めに。約64MB超はインライン再生不可 —
代わりにドキュメント送信（上限2GB、WhatsAppのハード上限）。

`"stickerPack"`／`"stickerAuthor"`はWhatsAppに表示されるデフォルトの
ステッカー名 — `.sticker <pack>|<author>`で上書き可（例
`.sticker rawr|buatan gweh`）。

---

## 🧰 技術スタック

<div align="center">

[![Skills](https://skillicons.dev/icons?i=ts,bun,nodejs,rust,py,githubactions)](https://skillicons.dev)

</div>

| 層 | 選択 | 理由 |
|---|---|---|
| ランタイム | **Bun**（canary）· Node ≥ 23.6フォールバック | TypeScriptを直接実行 — ビルド不要、`tsx`不要 |
| WhatsAppプロトコル | **Baileys** | 実績あるWeb APIクライアント |
| ステッカーエンジン | **Rustサイドカー** | 512×512 webp、アニメ対応、brat/toimg/hd、全コーデック内蔵 |
| オーディオエンジン | **Rustサイドカー** | iOS用にAAC-in-fMP4を標準M4Aへリマックス、ロスレス |
| AI脳 | **Pythonサイドカー**（`native/ai`、`python3`＋`curl_cffi`必須）＋Poolsideフォールバック | chatgpt.com匿名：毎回fresh device＋proof-of-work、キー・ログイン不要 |
| スクレイパー | **Pure TypeScript** | yt-dlp／ffmpegなし — 保守不要 |
| ロギング | **pino** | 高速・構造化・見やすい |
| CI | **GitHub Actions** | 実導入テスト：Ubuntu・macOS・Windows＋Termux模擬 |

---

## 📁 プロジェクト構成

<details>
<summary>ソースレイアウトを表示</summary>

```
src/
├── index.ts                 # エントリ：起動＋シグナル処理
├── socket.ts                # Baileys接続ライフサイクル（再接続・QR・ペアリング）
├── handlers/
│   └── messages.ts          # upsert → 除外規則 → dispatch
├── commands/
│   ├── index.ts             # 静的コマンド登録（登録＝import＋entries追加）
│   ├── main/                # ai/（prompt・tools・exchange）、menu、mode、prefix、limit、setlang、update
│   ├── downloader/          # ytmp3、ytmp4、play、tiktok、instagram、facebook、
│   │                        # pinterest、soundcloud、spotify、twitter
│   ├── converter/           # sticker、toimg、brat、toaudio、hd
│   └── group/               # kick、promote、demote、add
├── lib/
│   ├── scrapers/            # プラットフォーム毎モジュール＋共通http/curlヘルパー
│   ├── queue.ts             # グローバルスロットプール＋ユーザー毎クールダウン
│   ├── serialize.ts         # WAMessage → フラットSerialzedMessage（タップ解析含む）
│   ├── sender.ts            # reply/audio/video/sticker/react/list/buttons
│   ├── media.ts             # requireUrl、sendMedia（複数ファイル振分）
│   └── store · config · lang · llm · logger · aiHistory · factory ·
│       buttons · contributors · disk · updater · group
└── ../native/
    ├── sticker/             # Rust：webpエンジン（sticker/toimg/brat）
    ├── audio/               # Rust：iOS用fMP4 → M4Aリマックス
    └── ai/                  # Python：chatgpt-anonサイドカー（curl_cffi必須）
```

</details>

---

## 🤝 コントリビュート

PR歓迎！小さく怠惰なコードベース — そのままに。

- バグ？ [issueへ](https://github.com/salsabytes/Wakaru/issues)
- 機能要望？ 同じく
- [行動規範](CODE_OF_CONDUCT.md)を尊重

<div align="center">

[![Contributors](https://contrib.rocks/image?repo=salsabytes/Wakaru)](https://github.com/salsabytes/Wakaru/graphs/contributors)

</div>

---

## 📄 ライセンス

[MIT](LICENSE) © 2026 [Salsabila R.](https://github.com/salsabytes)

---

## ❓ FAQ

<details>
<summary>TermuxでBunは動く？</summary>

**はい。** `npm install -g bun`で強制導入（aarch64で動作確認済み）、最新
canaryに維持。万が一失敗してもNode ≥ 23.6に優雅にフォールバック — こちら
もTypeScriptファイルを直接実行できます。

</details>

<details>
<summary>なぜ<code>npm install</code>で<code>sharp</code>が入らない？</summary>

`sharp`（baileysのpeer）はAndroid向けprebuiltがなく、Termux上でlibvipsの
ソースコンパイルを試みて導入全体が失敗します。リポジトリの`.npmrc`で
`omit=peer`を設定して回避。代償：baileysのリンクプレビューサムネイルは
不動作、メディア機能はRustサイドカー使用。

</details>

<details>
<summary>2インスタンス同時起動できる？</summary>

同じ`sessions/`フォルダを共有する2インスタンスは厳禁 — 蹴り合います
（`status 440`、`connectionReplaced`）。

</details>

<details>
<summary>ログアウトされたら？</summary>

`sessions/`を削除してQRを再スキャン。認証情報がリポジトリに混入する
ことはありません — フォルダはgitignoredです。

</details>

<details>
<summary>Termuxホストで特記事項は？</summary>

`termux-wake-lock`でスマホを起こしたままに。`.facebook`はシステムの
`curl`依存 — Windows/Bunでは動作、Linuxホストでは一部バックエンドに
遮断される場合あり。シェアリンク（`facebook.com/share/…`）はfdown.world
フォールバックで解決。

</details>

---

## 🏷️ バージョニング

Wakaruは[セマンティックバージョニング](https://semver.org/)準拠 —
`major.minor.patch`（例`1.1.0`）。

| Bump | 条件 |
|---|---|
| `major` | 破壊的変更 |
| `minor` | 新機能（`1.1.0`、`1.2.0`、…） |
| `patch` | バグ修正（`1.1.1`、`1.1.2`、…） |

---

## 📦 Changelog

<details>
<summary>最近の変更</summary>

**未リリース**
- `.wiki`：ボット言語のWikipediaを検索（`ja` → ja.wikipedia.org、フォールバック`en`）＋記事リンク
- `.toaudio`：引用した動画 → Rustエンジンでm4a音声に（サンプルコピー、再エンコードなし）
- `.hd`：引用した写真 → iloveimgスクレイパーで2x AIアップスケール、Rustシャープ化フォールバック

**v1.2.0**
- `.prefix`コマンド：カスタム接頭辞、複数接頭辞（`.prefix ! /`）、bareモード（`.prefix none`） — `config.json`の`"prefixes"`からも設定可
- 接頭辞設定時のbareコマンドは2連続送信で発火（チャット誤爆防止）、bareモードでは即発火
- 修正：接頭辞直後の空白で`queryText`が1文字食われる（`. brat halo` → `t halo`）
- README同期：技術スタックにPython AIサイドカー、全27コマンド表、ライブのプロジェクトツリー

**v1.1.1**
- `.mode`コマンド：`public`（全員）／`self`（ボットアカウントのみ）／`private`（ownerのみ）返信ゲート、ライブ or `config.json`で切替
- `.brat`：Rustエンジン製の白brat風ミームステッカー（Arial Narrow・blur・case-sensitive）
- `.toimg`：引用ステッカー → PNG（Rustエンジン）
- `.facebook`のシェアリンクはfdown.worldフォールバックで対応（AyGemuy/api-wudysoft v8のフロー移植）
- コマンドは静的登録に戻す — 登録＝`src/commands/index.ts`にimport＋entry追加

**v1.1.0** — [semver](https://semver.org/)に復帰（短命の`YY.MM.R`リリースは廃止、同コードのクリーン再リリース）
- iPhone音声修正：ytmp3の「mp3」は断片化MP4内のAAC（iOSが再生拒否） — 新`native/audio` Rustエンジンが標準M4Aへリマックス（ロスレス、コーデック依存なし）
- `.play`結果が全環境で描画：quick_replyボタン＋番号付きテキスト（iOSで真っ白だった旧native-flowリストを修正） — `1 mp3`形式の返信も可
- `.play`キャンセル：リスト＆形式選択に`❌ Batal`ボタン、or `batal`/`gajadi`/`cancel`と入力、他雑談への誤返信スパムを停止
- `.add`はスペース・ダッシュ付き`+62`を受付
- 起動ログに`Wakaru v<version> (<commit>)`を出力し再起動を検証可能に
- グループ管理：`.kick @member`（タグ or 返信）と`.add <number>`（`+62`形式・複数番号可）
- `.kick`／`.add`をガード：グループ管理者／ownerのみ、ボットが管理者必須
- LID→PNをメッセージ境界で1回解決、メンションはrawのまま — 全jid形式にコマンド適合
- `commands/`からコマンド自動検出 — 新規コマンド＝静的`index.ts` entriesに登録（カテゴリはフォルダ名）
- ステッカー：透過レターボックスで512キャンバス端まで充填、24fps・7秒上限・≤500KBラダー
- ステッカーEXIFをWhatsApp現行読取のJSONペイロードに書換（パック名が再表示）
- Windows：`sticker.exe`にMinGW DLL同梱 — クリーンPATHでの無言`code 53`クラッシュ修正

**v1.0.0**
- マルチタスク：全コマンド並列実行 — グローバル単一スロットプール、コマンド毎フラグなし
- 重いコマンド（ダウンローダー＋ステッカー）にユーザー毎5秒クールダウン
- メディアDL上限30MB（ピークRAM低減）
- AIが実DL結果を報告：タイトル · 長さ · サイズ
- 返信言語を`config.json`／`.setlang`／`.ai`で変更可
- 深いモジュール化：`lib/scrapers/*`、`socket.ts`、`ai/`、`queue`＋`serialize`＋`sender`＋`media`
- `.play`二段階選択：検索 → 結果タップ → MP3/MP4ボタン（native-flowリスト）
- 新ダウンローダー：`.facebook`（HD）と`.pinterest`（ピンリンク or クエリ）
- 複数ファイル結果はグループではなくプライベートチャットへ
- タップ／ボタン解析を統一 — 全インタラクティブ形状に対応
- Termuxインストーラー：npm経由Bun強制・canary自動更新・Termux模擬CI

**それ以前**
- 性能改善：チャット毎並列キュー、全体同時実行上限、LID→PNキャッシュ、AI履歴TTL、ytmp3 cookieキャッシュ
- フルInstagramダウンローダー（リール・カルーセル・ストーリー）＋snapsaveフォールバック
- 透かしなしTikTokダウンローダー（本物タイトル、単発POST）
- `@run:`ツール実行＋送信者毎記憶のエージェント`.ai`
- アニメーションwebp対応のRustステッカーエンジン

</details>

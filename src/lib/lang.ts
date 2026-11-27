import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const CFG_PATH = join(ROOT, 'config.json')
const LANG_DIR = join(ROOT, 'data', 'lang')

export type Lang = string

let lang: Lang = (() => {
  try {
    const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8')) as { language?: unknown }
    const l = typeof cfg.language === 'string' ? cfg.language.trim().toLowerCase() : ''
    return /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(l) ? l : 'id'
  } catch {
    return 'id'
  }
})()

export const language = (): Lang => lang

export const LANG_NAMES: Record<string, string> = {
  id: 'Indonesian',
  en: 'English',
  ja: 'Japanese',
  jv: 'Javanese',
  su: 'Sundanese',
  ms: 'Malay',
  zh: 'Chinese',
  ko: 'Korean',
  th: 'Thai',
  vi: 'Vietnamese',
  ar: 'Arabic',
  hi: 'Hindi',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  nl: 'Dutch',
  it: 'Italian',
  ru: 'Russian',
  tr: 'Turkish',
}

export const langName = (code: string): string => LANG_NAMES[code.toLowerCase()] ?? code

// persisted to config.json so it survives restarts; in-memory only if the write fails
export const setLanguage = (next: string): Lang => {
  const l = next.trim().toLowerCase()
  lang = /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(l) ? l : 'id'
  try {
    const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'))
    cfg.language = lang
    writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n')
  } catch {
    // keep in-memory change
  }
  return lang
}

type Vars = Record<string, string | number>
const fill = (s: string, vars?: Vars): string => {
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export const t = (key: string, vars?: Vars): string =>
  fill(STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? STRINGS.id[key] ?? key, vars)

const mem = new Map<string, Record<string, string>>()

const loadCache = (l: string): Record<string, string> => {
  const hit = mem.get(l)
  if (hit) return hit
  let d: Record<string, string> = {}
  try {
    d = JSON.parse(readFileSync(join(LANG_DIR, `${l}.json`), 'utf8')) as Record<string, string>
  } catch {
    d = {}
  }
  mem.set(l, d)
  return d
}

// pivot id/en stay static; any other code reads data/lang/<code>.json
// (a plain { key: translation } file, placeholders intact). missing file
// or key falls back to the pivot so the bot never breaks.
export const tx = async (key: string, vars?: Vars): Promise<string> => {
  if (lang === 'id' || lang === 'en') return t(key, vars)
  const hit = loadCache(lang)[key]
  return fill(typeof hit === 'string' ? hit : (STRINGS.en[key] ?? STRINGS.id[key] ?? key), vars)
}

const STRINGS: Record<string, Record<string, string>> = {
  id: {
    cooldown: 'sabar dulu {s} detik ya 😅',
    noOwners: 'no owners in config.json — owner commands disabled 🔒',
    stalePlay: 'pilihannya udah keburu basi 😅 ketik ulang `.play <judul>` dulu ya',
    cmdFailed: '❌ {name} failed: {msg}',
    aiUsage: 'usage: {prefix}ai <pesan> — chat/jalankan command; bisa reply/kirim file (gambar/PDF/dokumen, best-effort)',
    aiCheckTitle: '🧪 agentic mode',
    aiCheckRunning: 'sik, aku tes kodenya dulu ya…',
    aiCheckFixing: 'ada yang error nih, aku benerin dulu…',
    aiCheckDone: 'udah aman, kodenya lolos ✨',
    aiProcessTitle: 'sebentar ya~',
    aiThinking: 'hmm, aku pikir dulu ya…',
    aiTools: 'bentar, aku {name} dulu ya…',
    aiDone: 'udah beres ✨',
    aiEmpty: 'hmm, aku belum ada jawaban buat itu — coba tanya lagi ya 🙏',
    requestUsage: 'pakai: {prefix}request <fitur yang kamu mau>',
    docReceived: 'dokumen *{name}* udah aku simpan ya. tanya apa aja soal isinya, mis. {prefix}ai ringkas file ini',
    reportUsage: 'pakai: {prefix}report <masalah yang kamu alami>',
    feedbackSent: 'makasih! udah aku kirim ke owner ya ✨',
    feedbackFailed: 'gagal kirim, coba lagi nanti ya 😔',
    usage: 'usage: {prefix}{name} {usage}',
    processing: '⏳ lagi diproses…',
    sentToDm: '📩 {n} file dikirim ke chat pribadimu ya',
    playUsage:
      'usage: {prefix}play <judul lagu/video> — nanti balas pake nomor + format, mis. *1 mp3* atau *1 mp4*',
    noResults: '❌ play: nggak nemu hasil buat query itu 😢',
    resultList: '🎵 hasil cari *"{query}"* — ketuk salah satu:',
    listTitle: 'Pilih hasil 🎵',
    listFooter: 'nanti pilih format mp3/mp4, atau langsung balas nomor + format (mis. 2 mp4). 3 menit aja ya 😉',
    playCancelled: 'oke, dibatalin 👍 — ketik `.play <judul>` kapan aja buat cari lagi',
    outOfRange: 'nomornya cuma 1–5 aja ya 😉',
    pickFormat: 'pilih format buat *{title}*',
    footer3min: '3 menit aja ya 😉',
    playFailed: '❌ play failed: {msg}',
    playUnavailable:
      '😖 sumbernya nggak bisa kasih file itu sekarang. Daftar hasilnya masih aktif — balas nomor lain ya, mis. *2 mp3*.',
    stickerUsage: 'reply ke foto/video/gif, atau kirim langsung pake .sticker 🛸 — nama pack optional: .sticker <pack>|<author> (mis. .sticker rawr|buatan gweh)',
    soundstickerUsage:
      '🔊 soundsticker: kirim foto/video (atau reply ke foto/video) pake caption .ss — nanti bot minta suaranya. maksimal 10 detik (5 detik kalau dari video)',
    soundstickerAskAudio:
      '🖼️ oke, fotonya udah aku pegang. sekarang kirim voice note / audio-nya ya — balas di chat ini, 1 menit ⏳',
    soundstickerPickSound: '🎬 video-nya udah aku pegang. mau pake suara dari video itu, atau kirim audio sendiri?',
    soundstickerUseVideo: '🔊 Suara video',
    soundstickerSendAudio: '🎵 Kirim audio',
    soundstickerAskSeparate: '🎵 siap, kirim voice note / file audio-nya ya — 1 menit ⏳',
    soundstickerFooter: '1 menit aja ya 😉',
    soundstickerTimeout: '⏰ waktunya habis (1 menit) — kirim ulang foto/video pake .ss ya',
    soundstickerStale: 'sesinya udah keburu habis ⏰ ketik `.ss` lagi ya',
    soundstickerNotYours: 'ini sesi punya @{who} — bikin sendiri pake `.ss` ya 😉',
    soundstickerCancelled: 'oke, dibatalin 👍 — `.ss` kapan aja buat mulai lagi',
    soundstickerNotBuilt:
      'engine audio belum dibuild — jalanin: npm run build:sticker 🔧 (atau `cargo build --release` di native/audio)',
    soundstickerFailed: 'soundsticker gagal 😢 — coba lagi, atau pastiin suaranya nggak kosong/di-mute',
    toimgUsage: 'reply sticker, atau kirim sticker pake caption .toimg 🖼️',
    toimgFailed: 'toimg gagal 😢 — stickernya mungkin rusak atau formatnya aneh',
    toaudioUsage: 'reply video, atau kirim video pake caption .toaudio 🎧',
    toaudioFailed: 'toaudio gagal 😢 — videonya mungkin rusak atau nggak ada suaranya',
    hdUsage: 'reply foto, atau kirim foto pake caption .hd 📸',
    hdFailed: 'hd gagal 😢 — fotonya mungkin rusak atau formatnya aneh',
    bratUsage: 'kasih teksnya dong — mis. .brat halo dunia 🐸',
    bratFailed: 'brat gagal 😢 — coba teks yang lebih pendek',
    wikiUsage: 'kasih katanya dong — mis. {prefix}wiki soekarno 📖',
    wikiNotFound: 'nggak nemu artikel buat "{query}" 😢 coba kata kunci lain',
    wikiFailed: 'wiki gagal 😢 — coba lagi ntar ya',
    groupOnly: 'command ini khusus grup ya 📛',
    toggleOn: 'ON ✅',
    toggleOff: 'OFF ⛔',
    enableButton: '✅ Aktifkan',
    disableButton: '⛔ Matikan',
    statusLine: 'Status : {status}',
    antilinkTitle: '🛡️ *Anti-Link*',
    antilinkKickOn: 'Kick   : ON — kick setelah {n}x pelanggaran',
    antilinkKickOff: 'Kick   : OFF — hanya hapus pesan',
    antilinkHint: 'Ketuk tombol buat ngatur. Owner, admin grup, dan bot sendiri nggak kena.',
    antilinkKickButtonOn: '👢 Kick: ON',
    antilinkKickButtonOff: '👢 Kick: OFF',
    antilinkMaxButton: '⚠️ Maks warn: {n}',
    antilinkMaxPrompt: 'Ketik angka {min}-{max} untuk batas maksimal warn sebelum kick.\nKetik "batal" buat berhenti.',
    antilinkMaxInvalid: 'Masukkan angka {min}-{max} ya. Ketik "batal" buat berhenti.',
    antilinkMaxCancelled: 'Dibatalkan. Maks warn tidak diubah.',
    antideleteTitle: '🛡️ *Anti-Delete*',
    antideleteBodyOn: 'Pesan yang dihapus bakal dikirim ulang ke grup ini.',
    antideleteBodyOff: 'Nyalakan biar pesan yang dihapus dikirim ulang.',
    antideleteNote: 'Hanya pesan setelah fitur dinyalakan. View-once tidak dipulihkan.',
    antideleteHint: 'Ketuk tombol buat ngatur. Bisa juga: {prefix}antidelete on|off',
    antideleteNotice: '⚠️ Anti-delete: pesan dari {who} dihapus:',
    welcomeTitle: '👋 Welcome grup',
    goodbyeTitle: '👋 Goodbye grup',
    templateLine: 'Template: {template}',
    welcomePlaceholders: 'Placeholder: `pp` (foto profil), `mention`, `desc`, `gcname`',
    welcomeHint: 'Ketuk tombol buat on/off. Ubah teks: {prefix}welcome <teks> | Reset: {prefix}welcome reset',
    goodbyeHint: 'Ketuk tombol buat on/off. Ubah teks: {prefix}goodbye <teks> | Reset: {prefix}goodbye reset',
    welcomeSaved: 'Template welcome disimpan & ON.',
    welcomeReset: 'Template welcome direset ke default.',
    goodbyeSaved: 'Template goodbye disimpan & ON.',
    goodbyeReset: 'Template goodbye direset ke default.',
    addUsage: 'usage: {prefix}add <nomor> — mis. {prefix}add 6288218292156 (bisa beberapa sekaligus)',
    addAdminOnly: 'khusus admin grup aja ya 👮',
    addBotNotAdmin: 'bot-nya nggak admin — jadikan admin dulu ya 🤖',
    addDone: '✅ {n} member ditambahkan',
    addFailed: '❌ add gagal: {msg}',
    kickUsage: 'usage: {prefix}kick @orang — atau reply pesan orangnya',
    kickNotFound: 'orangnya nggak ketemu di grup ini 🤔',
    kickAdminOnly: 'khusus admin grup aja ya 👮',
    kickBotNotAdmin: 'bot-nya nggak admin — jadikan admin dulu ya 🤖',
    kickDone: '✅ {n} member dikeluarkan',
    kickFailed: '❌ kick gagal: {msg}',
    promoteUsage: 'usage: {prefix}promote @orang — atau reply pesan orangnya',
    promoteDone: '✅ {n} member jadi admin',
    promoteFailed: '❌ promote gagal: {msg}',
    demoteUsage: 'usage: {prefix}demote @orang — atau reply pesan orangnya',
    demoteDone: '✅ {n} admin diturunkan',
    demoteFailed: '❌ demote gagal: {msg}',
    notBuilt: 'engine sticker belum dibuild — jalanin: npm run build:sticker 🔧',
    stickerFailed: 'sticker gagal 😢',
    mediaExpired: 'medianya udah kedaluwarsa 😅 kirim ulang / reply pesan yang baru ya',
    tiktokHeavy: 'video ini resolusinya kegedean buat player WA (1080p60/format berat) — dikirim sebagai file .mp4 ya, tinggal tap buat play di pemutar eksternal 📦',
    menuFooter: 'ketik {prefix}menu buat liat lagi',
    menuOwnerLink: '👑 Owner',
    menuGroupLink: '💬 Original Group',
    menuStats: '⚡ {n} perintah · {ms}ms',
    menuRoleOwner: '👑 Owner',
    menuRoleUser: '👤 User',
    langUsage: 'usage: {prefix}setlang <kode> — sekarang: {lang} — mis. {prefix}setlang ja',
    modeUsage: 'usage: {prefix}mode <public|all|self|private> — sekarang: {mode}',
    modeSet: '✅ mode: {mode} — public: semua orang bisa pake · all: semua orang + nomor bot sendiri · self: cuma perintah dari akun ini · private: cuma owner',
    prefixUsage: 'usage: {prefix}prefix <..> — sekarang: {prefixes} — mis. {prefix}prefix ! / buat multi, tambah none biar tanpa prefix juga jalan ({prefix}prefix ! / none)',
    prefixSet: '✅ prefix: {prefixes}',
    prefixNone: '(tanpa prefix)',
    limitUsage: 'usage: {prefix}limit <MB> — sekarang: {limit}MB (default {def}, {min}–{max}) — mis. {prefix}limit 150',
    limitSet: '✅ limit download: {limit}MB ({min}–{max})',
    langSet: '✅ bahasa: {lang}',
    scraperErrPrivate: '❌ konten ini private/butuh login',
    scraperErrNotFound: '❌ kontennya nggak ditemukan atau sudah dihapus',
    scraperErrRateLimited: '❌ terlalu banyak permintaan — coba lagi nanti',
    scraperErrBlocked: '❌ konten diblokir/terbatas wilayah',
    scraperErrNetwork: '❌ koneksi ke sumber gagal — coba lagi',
    scraperErrUnsupported: '❌ link/format ini belum didukung',
    scraperErrUnknown: '❌ download gagal — coba link lain',
    updateStart: '⏳ updating… brb ✨',
    updateNone: '✅ udah versi terbaru kok',
    updateConflict: '❌ update dibatalin — ada file lokal yang beda sama GitHub (stash/commit dulu ya)',
    updateDone: '✅ updated ke {head} — restarting…',
    updateFailed: '❌ update gagal, di-rollback: {msg}',
    updateRestartFail: '⚠️ update oke, tapi restart otomatis gagal — start manual ya',
  },
  en: {
    cooldown: 'hold on {s} seconds 😅',
    noOwners: 'no owners in config.json — owner commands disabled 🔒',
    stalePlay: 'that pick already expired 😅 re-run `.play <title>` first',
    cmdFailed: '❌ {name} failed: {msg}',
    aiUsage: 'usage: {prefix}ai <message> — chat/run commands; can read replied/attached files (images/PDF/docs, best-effort)',
    aiCheckTitle: '🧪 agentic mode',
    aiCheckRunning: 'one sec, let me test the code…',
    aiCheckFixing: 'oops, something broke — fixing it…',
    aiCheckDone: 'all good, checks passed ✨',
    aiProcessTitle: 'one sec~',
    aiThinking: 'hmm, let me think…',
    aiTools: 'brb, running {name}…',
    aiDone: 'all done ✨',
    aiEmpty: "hmm, I don't have an answer for that — try asking again 🙏",
    requestUsage: 'usage: {prefix}request <feature you want>',
    docReceived: 'got the document *{name}*. ask anything about it, e.g. {prefix}ai summarize this file',
    reportUsage: 'usage: {prefix}report <what went wrong>',
    feedbackSent: 'thanks! I sent it to the owner ✨',
    feedbackFailed: "couldn't send it, try again later 😔",
    usage: 'usage: {prefix}{name} {usage}',
    processing: '⏳ processing…',
    sentToDm: '📩 {n} files sent to your private chat',
    playUsage: 'usage: {prefix}play <song/video title> — reply with number + format, e.g. *1 mp3* or *1 mp4*',
    noResults: '❌ play: no results for that query 😢',
    resultList: '🎵 results for *"{query}"* — tap one:',
    listTitle: 'Pick a result 🎵',
    listFooter: 'then pick mp3/mp4 format, or reply number + format (e.g. 2 mp4). 3 minutes only 😉',
    playCancelled: 'ok, cancelled 👍 — run `.play <title>` anytime to search again',
    outOfRange: 'numbers are only 1–5 😉',
    pickFormat: 'pick a format for *{title}*',
    footer3min: '3 minutes only 😉',
    playFailed: '❌ play failed: {msg}',
    playUnavailable:
      '😖 the source can\'t serve that file right now. The result list is still active — reply with another number, e.g. *2 mp3*.',
    stickerUsage: 'reply to a photo/video/gif, or send one directly with .sticker 🛸 — optional pack name: .sticker <pack>|<author> (e.g. .sticker rawr|made by me)',
    soundstickerUsage:
      '🔊 soundsticker: send a photo/video (or reply to one) with the .ss caption — the bot then asks for the sound. max 10 seconds (5 when it comes from a video)',
    soundstickerAskAudio:
      '🖼️ got the photo. now send the voice note / audio — just answer in this chat, 1 minute ⏳',
    soundstickerPickSound: '🎬 got the video. use the sound from that video, or send your own audio?',
    soundstickerUseVideo: '🔊 Video sound',
    soundstickerSendAudio: '🎵 Send audio',
    soundstickerAskSeparate: '🎵 alright, send the voice note / audio file — 1 minute ⏳',
    soundstickerFooter: '1 minute only 😉',
    soundstickerTimeout: '⏰ time is up (1 minute) — send the photo/video again with .ss',
    soundstickerStale: 'that session already expired ⏰ type `.ss` again',
    soundstickerNotYours: 'that session belongs to @{who} — start your own with `.ss` 😉',
    soundstickerCancelled: 'ok, cancelled 👍 — use `.ss` whenever you want to start again',
    soundstickerNotBuilt:
      'audio engine not built — run: npm run build:sticker 🔧 (or `cargo build --release` in native/audio)',
    soundstickerFailed: 'soundsticker failed 😢 — try again, or make sure the sound is not empty/muted',
    toimgUsage: 'reply to a sticker, or send a sticker with .toimg caption 🖼️',
    toimgFailed: 'toimg failed 😢 — that sticker may be corrupt or an odd format',
    toaudioUsage: 'reply to a video, or send a video with .toaudio caption 🎧',
    toaudioFailed: 'toaudio failed 😢 — that video may be corrupt or have no audio',
    hdUsage: 'reply to a photo, or send a photo with .hd caption 📸',
    hdFailed: 'hd failed 😢 — that photo may be corrupt or an odd format',
    bratUsage: 'give me some text — e.g. .brat hello world 🐸',
    bratFailed: 'brat failed 😢 — try shorter text',
    wikiUsage: 'give me a query — e.g. {prefix}wiki soekarno 📖',
    wikiNotFound: 'no article found for "{query}" 😢 try another keyword',
    wikiFailed: 'wiki failed 😢 — try again later',
    groupOnly: 'this command works in groups only 📛',
    toggleOn: 'ON ✅',
    toggleOff: 'OFF ⛔',
    enableButton: '✅ Enable',
    disableButton: '⛔ Disable',
    statusLine: 'Status : {status}',
    antilinkTitle: '🛡️ *Anti-Link*',
    antilinkKickOn: 'Kick   : ON — kick after {n} warnings',
    antilinkKickOff: 'Kick   : OFF — delete only',
    antilinkHint: 'Tap a button to manage. Owners, group admins, and the bot are immune.',
    antilinkKickButtonOn: '👢 Kick: ON',
    antilinkKickButtonOff: '👢 Kick: OFF',
    antilinkMaxButton: '⚠️ Max warns: {n}',
    antilinkMaxPrompt: 'Type a number {min}-{max} for the max warnings before a kick.\nType "cancel" to stop.',
    antilinkMaxInvalid: 'Enter a number {min}-{max}. Type "cancel" to stop.',
    antilinkMaxCancelled: 'Cancelled. Max warns unchanged.',
    antideleteTitle: '🛡️ *Anti-Delete*',
    antideleteBodyOn: 'Deleted messages are reposted to this group.',
    antideleteBodyOff: 'Turn it on to repost deleted messages.',
    antideleteNote: 'Only messages sent after it was enabled. View-once is not restored.',
    antideleteHint: 'Tap a button to manage. You can also use: {prefix}antidelete on|off',
    antideleteNotice: '⚠️ Anti-delete: message from {who} was deleted:',
    welcomeTitle: '👋 Group welcome',
    goodbyeTitle: '👋 Group goodbye',
    templateLine: 'Template: {template}',
    welcomePlaceholders: 'Placeholders: `pp` (profile pic), `mention`, `desc`, `gcname`',
    welcomeHint: 'Tap the button to toggle. Set text: {prefix}welcome <text> | Reset: {prefix}welcome reset',
    goodbyeHint: 'Tap the button to toggle. Set text: {prefix}goodbye <text> | Reset: {prefix}goodbye reset',
    welcomeSaved: 'Welcome template saved & ON.',
    welcomeReset: 'Welcome template reset to default.',
    goodbyeSaved: 'Goodbye template saved & ON.',
    goodbyeReset: 'Goodbye template reset to default.',
    addUsage: 'usage: {prefix}add <number> — e.g. {prefix}add 6288218292156 (multiple allowed)',
    addAdminOnly: 'group admins only 👮',
    addBotNotAdmin: "bot isn't an admin — make it admin first 🤖",
    addDone: '✅ added {n} member(s)',
    addFailed: '❌ add failed: {msg}',
    kickUsage: 'usage: {prefix}kick @member — or reply to their message',
    kickNotFound: "member not found in this group 🤔",
    kickAdminOnly: 'group admins only 👮',
    kickBotNotAdmin: "bot isn't an admin — make it admin first 🤖",
    kickDone: '✅ kicked {n} member(s)',
    kickFailed: '❌ kick failed: {msg}',
    promoteUsage: 'usage: {prefix}promote @member — or reply to their message',
    promoteDone: '✅ {n} member(s) promoted',
    promoteFailed: '❌ promote failed: {msg}',
    demoteUsage: 'usage: {prefix}demote @member — or reply to their message',
    demoteDone: '✅ {n} admin(s) demoted',
    demoteFailed: '❌ demote failed: {msg}',
    notBuilt: 'sticker engine not built — run: npm run build:sticker 🔧',
    stickerFailed: 'sticker failed 😢',
    mediaExpired: 'that media already expired 😅 send it again / reply a fresh message',
    tiktokHeavy: 'this video is too heavy for the WA player (1080p60/heavy format) — sent as .mp4 file instead, tap to play in an external player 📦',
    menuFooter: 'type {prefix}menu to show this again',
    menuOwnerLink: '👑 Owner',
    menuGroupLink: '💬 Original Group',
    menuStats: '⚡ {n} commands · {ms}ms',
    menuRoleOwner: '👑 Owner',
    menuRoleUser: '👤 User',
    langUsage: 'usage: {prefix}setlang <code> — current: {lang} — e.g. {prefix}setlang ja',
    modeUsage: 'usage: {prefix}mode <public|all|self|private> — current: {mode}',
    modeSet: '✅ mode: {mode} — public: everyone · all: everyone + the bot’s own number · self: this account only · private: owners only',
    prefixUsage: 'usage: {prefix}prefix <..> — current: {prefixes} — e.g. {prefix}prefix ! / for multi, add none so bare works too ({prefix}prefix ! / none)',
    prefixSet: '✅ prefix: {prefixes}',
    prefixNone: '(bare, no prefix)',
    limitUsage: 'usage: {prefix}limit <MB> — current: {limit}MB (default {def}, {min}–{max}) — e.g. {prefix}limit 150',
    limitSet: '✅ download limit: {limit}MB ({min}–{max})',
    langSet: '✅ language: {lang}',
    scraperErrPrivate: '❌ this content is private / needs login',
    scraperErrNotFound: '❌ content not found or already deleted',
    scraperErrRateLimited: '❌ too many requests — try again later',
    scraperErrBlocked: '❌ content is blocked or region-restricted',
    scraperErrNetwork: '❌ could not reach the source — try again',
    scraperErrUnsupported: '❌ this link/format is not supported yet',
    scraperErrUnknown: '❌ download failed — try another link',
    updateStart: '⏳ updating… brb ✨',
    updateNone: '✅ already up to date',
    updateConflict: '❌ update aborted — local changes conflict with GitHub (stash or commit first)',
    updateDone: '✅ updated to {head} — restarting…',
    updateFailed: '❌ update failed, rolled back: {msg}',
    updateRestartFail: '⚠️ update ok but auto-restart failed — start manually',
  },
}

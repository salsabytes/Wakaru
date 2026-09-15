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
    ownerOnly: 'owner only 🔒 (detected: {who})',
    stalePlay: 'pilihannya udah keburu basi 😅 ketik ulang `.play <judul>` dulu ya',
    cmdFailed: '❌ {name} failed: {msg}',
    aiUsage: 'usage: {prefix}ai <pesan> — mis. "sticker", "kick budi", atau ngobrol aja',
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
    stickerUsage: 'reply ke foto/video/gif, atau kirim langsung pake .sticker 🛸 — nama pack optional: .sticker <pack>|<author> (mis. .sticker rawr|buatan gweh)',
    toimgUsage: 'reply sticker, atau kirim sticker pake caption .toimg 🖼️',
    toimgFailed: 'toimg gagal 😢 — stickernya mungkin rusak atau formatnya aneh',
    togifUsage: 'reply sticker (animasi), atau kirim sticker pake caption .togif 🎞️',
    togifFailed: 'togif gagal 😢 — stickernya mungkin bukan animasi atau formatnya aneh',
    toaudioUsage: 'reply video, atau kirim video pake caption .toaudio 🎧',
    toaudioFailed: 'toaudio gagal 😢 — videonya mungkin rusak atau nggak ada suaranya',
    hdUsage: 'reply foto, atau kirim foto pake caption .hd 📸',
    hdFailed: 'hd gagal 😢 — fotonya mungkin rusak atau formatnya aneh',
    bratUsage: 'kasih teksnya dong — mis. .brat halo dunia 🐸',
    bratFailed: 'brat gagal 😢 — coba teks yang lebih pendek',
    groupOnly: 'command ini khusus grup ya 📛',
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
    notBuilt: 'engine sticker belum dibuild — jalanin: bun run build:sticker 🔧',
    stickerFailed: 'sticker gagal 😢',
    mediaExpired: 'medianya udah kedaluwarsa 😅 kirim ulang / reply pesan yang baru ya',
    menuFooter: 'ketik {prefix}menu buat liat lagi',
    menuStats: '⚡ {n} perintah · {ms}ms',
    menuRoleOwner: '👑 Owner',
    menuRoleUser: '👤 User',
    langUsage: 'usage: {prefix}setlang <kode> — sekarang: {lang} — mis. {prefix}setlang ja',
    modeUsage: 'usage: {prefix}mode <public|self|private> — sekarang: {mode}',
    modeSet: '✅ mode: {mode} — public: semua orang bisa pake · self: cuma perintah dari akun ini · private: cuma owner',
    prefixUsage: 'usage: {prefix}prefix <..> — sekarang: {prefixes} — mis. {prefix}prefix ! / buat multi, tambah none biar tanpa prefix juga jalan ({prefix}prefix ! / none)',
    prefixSet: '✅ prefix: {prefixes}',
    prefixNone: '(tanpa prefix)',
    limitUsage: 'usage: {prefix}limit <MB> — sekarang: {limit}MB (default {def}, {min}–{max}) — mis. {prefix}limit 150',
    limitSet: '✅ limit download: {limit}MB ({min}–{max})',
    langSet: '✅ bahasa: {lang}',
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
    ownerOnly: 'owner only 🔒 (detected: {who})',
    stalePlay: 'that pick already expired 😅 re-run `.play <title>` first',
    cmdFailed: '❌ {name} failed: {msg}',
    aiUsage: 'usage: {prefix}ai <message> — e.g. "sticker", "kick budi", or just chat',
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
    stickerUsage: 'reply to a photo/video/gif, or send one directly with .sticker 🛸 — optional pack name: .sticker <pack>|<author> (e.g. .sticker rawr|made by me)',
    toimgUsage: 'reply to a sticker, or send a sticker with .toimg caption 🖼️',
    toimgFailed: 'toimg failed 😢 — that sticker may be corrupt or an odd format',
    togifUsage: 'reply to an (animated) sticker, or send a sticker with .togif caption 🎞️',
    togifFailed: 'togif failed 😢 — that sticker may not be animated or is an odd format',
    toaudioUsage: 'reply to a video, or send a video with .toaudio caption 🎧',
    toaudioFailed: 'toaudio failed 😢 — that video may be corrupt or have no audio',
    hdUsage: 'reply to a photo, or send a photo with .hd caption 📸',
    hdFailed: 'hd failed 😢 — that photo may be corrupt or an odd format',
    bratUsage: 'give me some text — e.g. .brat hello world 🐸',
    bratFailed: 'brat failed 😢 — try shorter text',
    groupOnly: 'this command works in groups only 📛',
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
    notBuilt: 'sticker engine not built — run: bun run build:sticker 🔧',
    stickerFailed: 'sticker failed 😢',
    mediaExpired: 'that media already expired 😅 send it again / reply a fresh message',
    menuFooter: 'type {prefix}menu to show this again',
    menuStats: '⚡ {n} commands · {ms}ms',
    menuRoleOwner: '👑 Owner',
    menuRoleUser: '👤 User',
    langUsage: 'usage: {prefix}setlang <code> — current: {lang} — e.g. {prefix}setlang ja',
    modeUsage: 'usage: {prefix}mode <public|self|private> — current: {mode}',
    modeSet: '✅ mode: {mode} — public: everyone · self: this account only · private: owners only',
    prefixUsage: 'usage: {prefix}prefix <..> — current: {prefixes} — e.g. {prefix}prefix ! / for multi, add none so bare works too ({prefix}prefix ! / none)',
    prefixSet: '✅ prefix: {prefixes}',
    prefixNone: '(bare, no prefix)',
    limitUsage: 'usage: {prefix}limit <MB> — current: {limit}MB (default {def}, {min}–{max}) — e.g. {prefix}limit 150',
    limitSet: '✅ download limit: {limit}MB ({min}–{max})',
    langSet: '✅ language: {lang}',
    updateStart: '⏳ updating… brb ✨',
    updateNone: '✅ already up to date',
    updateConflict: '❌ update aborted — local changes conflict with GitHub (stash or commit first)',
    updateDone: '✅ updated to {head} — restarting…',
    updateFailed: '❌ update failed, rolled back: {msg}',
    updateRestartFail: '⚠️ update ok but auto-restart failed — start manually',
  },
}

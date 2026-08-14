import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const CFG_PATH = join(ROOT, 'config.json')

export type Lang = 'id' | 'en'

let lang: Lang = (() => {
  try {
    const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8')) as { language?: unknown }
    return cfg.language === 'en' ? 'en' : 'id'
  } catch {
    return 'id'
  }
})()

export const language = (): Lang => lang

// persisted to config.json so it survives restarts; in-memory only if the write fails
export const setLanguage = (next: string): Lang => {
  lang = next === 'en' ? 'en' : 'id'
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
export const t = (key: string, vars?: Vars): string => {
  let s = STRINGS[lang][key] ?? STRINGS.id[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

const STRINGS: Record<Lang, Record<string, string>> = {
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
    stickerUsage: 'reply ke foto/video, atau kirim langsung pake .sticker 🛸 — nama pack optional: .sticker <pack>|<author> (mis. .sticker rawr|buatan gweh)',
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
    notBuilt: 'engine sticker belum dibuild — jalanin: bun run build:sticker 🔧',
    stickerFailed: 'sticker gagal 😢',
    menuFooter: 'ketik {prefix}menu buat liat lagi',
    menuStats: '⚡ {n} perintah · {ms}ms',
    langUsage: 'usage: {prefix}setlang <id|en> — sekarang: {lang}',
    langSetEn: '✅ language set to English',
    langSetId: '✅ bahasa diubah ke Indonesia',
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
    stickerUsage: 'reply to a photo/video, or send one directly with .sticker 🛸 — optional pack name: .sticker <pack>|<author> (e.g. .sticker rawr|made by me)',
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
    notBuilt: 'sticker engine not built — run: bun run build:sticker 🔧',
    stickerFailed: 'sticker failed 😢',
    menuFooter: 'type {prefix}menu to show this again',
    menuStats: '⚡ {n} commands · {ms}ms',
    langUsage: 'usage: {prefix}setlang <id|en> — current: {lang}',
    langSetEn: '✅ language set to English',
    langSetId: '✅ bahasa diubah ke Indonesia',
    updateStart: '⏳ updating… brb ✨',
    updateNone: '✅ already up to date',
    updateConflict: '❌ update aborted — local changes conflict with GitHub (stash or commit first)',
    updateDone: '✅ updated to {head} — restarting…',
    updateFailed: '❌ update failed, rolled back: {msg}',
    updateRestartFail: '⚠️ update ok but auto-restart failed — start manually',
  },
}

import type { WAMessageKey } from 'baileys'
import { sendRichMulti, type RichPart } from './wa/richmsg.ts'
import { wakafy } from './api/wakafy.ts'
import { askLLM } from './ai/llm.ts'

type Q = { soal: string; jawaban: string[] }
type Game = {
  chat: string
  q: Q
  open: boolean[]
  by: (string | null)[]
  at: number
  lastReactKey?: WAMessageKey
  judge: Map<string, number>
  hints: number[]
  hintTarget?: number
}
const games = new Map<string, Game>()
const TTL = 3 * 60_000
const GAMES_MAX = 500
const AI_TIMEOUT = 6000


const pruneGames = (): void => {
  const now = Date.now()
  for (const [chat, g] of games) if (now - g.at > TTL) games.delete(chat)
  while (games.size > GAMES_MAX) games.delete(games.keys().next().value!)
}

type ApiQ = { ok: boolean; total: number; id: number; soal: string; jawaban: string[] }

const isGoodQuestion = async (q: Q): Promise<boolean> => {
  const prompt = [
    'Nilai apakah soal ini cocok untuk game Family 100 versi survei jawaban umum.',
    'Tolak jika soal kependekan/tidak jelas, terlalu spesifik, trivia angka/fakta langka, biografi/detail niche, terlalu sulit, atau tidak alami sebagai pertanyaan survei.',
    'Soal harus bisa dipahami orang awam dan menghasilkan beberapa jawaban umum.',
    `Soal: ${q.soal}`,
    `Jumlah jawaban: ${q.jawaban.length}`,
    'Balas JSON saja: {"ok":true} atau {"ok":false}',
  ].join('\n')
  try {
    const raw = await Promise.race([
      askLLM([{ role: 'user', content: prompt }]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('f100 quality timeout')), AI_TIMEOUT)),
    ])
    const m = String(raw).match(/\{[\s\S]*\}/)
    const obj = JSON.parse(m?.[0] ?? String(raw)) as { ok?: unknown }
    return obj.ok === true
  } catch {
    return true
  }
}

const curateAnswers = async (q: Q): Promise<Q> => {
  const prompt = [
    'Kamu kurator Family 100 Indonesia.',
    'Soal WAJIB tetap sama persis, jangan diubah. Kamu hanya boleh memperbaiki/menyusun ulang jawabannya.',
    'Buat jawaban jadi realistis, umum, dan sesuai survei orang awam Indonesia. Urutkan dari paling top/umum ke paling bawah.',
    'Hapus jawaban fiksi/mitos/fantasi/tidak relevan kecuali soal memang meminta itu. Jangan pakai trivia niche.',
    'Pertahankan jumlah jawaban sama persis dengan input. Jangan tambahkan penjelasan.',
    `Soal: ${q.soal}`,
    `Jawaban DB: ${JSON.stringify(q.jawaban)}`,
    'Balas JSON saja: {"jawaban":["..."]}',
  ].join('\n')
  try {
    const raw = await Promise.race([
      askLLM([{ role: 'user', content: prompt }]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('f100 curate timeout')), AI_TIMEOUT)),
    ])
    const m = String(raw).match(/\{[\s\S]*\}/)
    const obj = JSON.parse(m?.[0] ?? String(raw)) as { jawaban?: unknown }
    const arr = Array.isArray(obj.jawaban) ? obj.jawaban.map((x) => String(x).trim()).filter(Boolean) : []
    const uniq: string[] = []
    const seen = new Set<string>()
    for (const a of arr) {
      const k = norm(a)
      if (!k || seen.has(k)) continue
      seen.add(k)
      uniq.push(a)
    }
    return uniq.length === q.jawaban.length ? { ...q, jawaban: uniq } : q
  } catch {
    return q
  }
}

const fetchQuestion = async (): Promise<Q> => {
  let last: Q | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await wakafy.json<ApiQ>('/v1/ext/salsabytes/family100')
    const soal = String(res.soal ?? '').trim()
    const jawaban = (res.jawaban ?? []).map((a) => String(a).trim()).filter(Boolean)
    if (!res.ok || !soal || !jawaban.length) throw new Error('respon API tidak valid')
    let q = { soal, jawaban }
    last = q
    if (q.jawaban.length < 2) continue
    if (q.soal.replace(/\s+/g, ' ').trim().length < 8) continue
    if (!(await isGoodQuestion(q))) continue
    return curateAnswers(q)
  }
  if (!last) throw new Error('respon API tidak valid')
  return curateAnswers(last)
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const nick = (jid: string, push?: string) => push || jid.split(/[@:]/)[0]
const maskWord = (w: string, reveal: number): string => [...w].map((ch, i) => (i < reveal ? ch.toUpperCase() : '_')).join('')
const hintOf = (a: string, reveal = 1): string => a.split(/\s+/).filter(Boolean).map((w) => maskWord(w, reveal)).join(' ')
const pickHintTarget = (g: Game): number => {
  const closed = g.q.jawaban.map((_, i) => i).filter((i) => !g.open[i])
  if (!closed.length) return -1
  if (g.hintTarget !== undefined && !g.open[g.hintTarget]) return g.hintTarget
  g.hintTarget = closed[Math.floor(Math.random() * closed.length)]
  return g.hintTarget
}

export const pendingF100 = (chat: string) => {
  const g = games.get(chat)
  if (!g) return
  if (Date.now() - g.at > TTL) { games.delete(chat); return }
  return g
}

const boardHtml = (g: Game, note = '') => {
  const rows = g.q.jawaban.map((a, i) => {
    const ok = g.open[i]
    const bg = ok ? '#14532d' : '#111827'
    const fg = ok ? '#86efac' : '#64748b'
    const txt = ok ? esc(a) : '• • • • • • • •'
    const who = ok && g.by[i] ? `<span style="font-size:10px;color:#94a3b8;margin-left:6px">${esc(g.by[i]!)}</span>` : ''
    return `<div style="display:flex;align-items:center;gap:8px;background:${bg};border:1px solid #1f2937;border-radius:10px;padding:8px 10px;margin-top:6px"><div style="width:24px;height:24px;border-radius:8px;background:#1f2937;color:#cbd5e1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:0 0 auto">${i + 1}</div><div style="flex:1;color:${fg};font-weight:${ok ? 700 : 500};font-size:13px">${txt}${who}</div></div>`
  }).join('')
  const left = g.open.filter(Boolean).length
  return `<style>html,body{margin:0;padding:0}</style><div style="font-family:system-ui;padding:10px;border-radius:14px;background:linear-gradient(160deg,#0f172a,#111827);color:#f8fafc;border:1px solid #1f2937;width:100%;max-width:320px;box-sizing:border-box"><div style="font-size:10px;color:#c4b5fd;letter-spacing:.12em;font-weight:700">FAMILY 100</div><div style="font-size:16px;font-weight:800;line-height:1.2;margin-top:2px">${esc(g.q.soal)}</div><div style="font-size:11px;color:#94a3b8;margin-top:2px">Terjawab ${left}/${g.q.jawaban.length} · ketik jawaban langsung · \`.f100 hint\`</div>${rows}${note ? `<div style="margin-top:8px;font-size:12px;color:#fde68a;font-weight:600">${esc(note)}</div>` : ''}</div>`
}

export const renderF100 = async (ctx: Pick<CommandContext, 'sock' | 'chat'>, g: Game, note = '') => {
  const rows = g.q.jawaban.map((a, i) => [String(i + 1), g.open[i] ? a : '???', g.open[i] ? (g.by[i] ?? '-') : '-'])
  const left = g.open.filter(Boolean).length
  const parts: RichPart[] = [
    { type: 'text', text: `*${g.q.soal}*\nTerjawab ${left}/${g.q.jawaban.length} · ketik jawaban langsung · \`.f100 hint\`${note ? `\n_${note}_` : ''}` },
    { type: 'table', title: 'Jawaban', rows: [['#', 'Jawaban', 'Dijawab oleh'], ...rows] },
  ]
  await sendRichMulti(ctx.sock, ctx.chat, boardHtml(g, note), parts, { title: 'Family 100', mirrorSections: true })
}

type Match = { kind: 'hit' | 'already' | 'miss'; index: number }

const exactMatch = (g: Game, text: string): number => {
  const t = norm(text)
  if (!t) return -1
  for (let i = 0; i < g.q.jawaban.length; i++) {
    if (norm(g.q.jawaban[i]) === t) return i
  }
  return -1
}

const aiMatchIdx = async (g: Game, text: string): Promise<number> => {
  const candidates = g.q.jawaban.map((a, i) => ({ i, a }))
  if (!candidates.length || text.trim().length < 2) return -1
  const prompt = [
    'Kamu juri Family 100 Indonesia. Tentukan apakah tebakan pemain maksudnya sama dengan salah satu jawaban di papan.',
    'Fokus pada maksud/inti jawaban, bukan kemiripan string.',
    'Terima jika: sinonim, istilah sehari-hari, kata umum yang mencakup jawaban, jawaban yang mencakup tebakan, singkatan, ejaan salah/typo, kata gaul, bahasa daerah umum, jamak/tunggal, atau penjelasan singkat yang jelas menunjuk jawaban itu.',
    'Contoh: "hp" cocok "handphone/ponsel", "cerita" bisa cocok "curhat/curhat cerita" jika konteks soal soal curhat, "nyamok" cocok "nyamuk".',
    'Jangan tolak hanya karena kata berbeda. Tolak hanya jika maknanya jelas beda atau terlalu umum sampai tidak menunjuk jawaban tertentu.',
    `Soal: ${g.q.soal}`,
    `Jawaban papan: ${JSON.stringify(candidates.map((c) => ({ index: c.i + 1, jawaban: c.a, status: g.open[c.i] ? 'sudah_terbuka' : 'belum_terbuka' })))}`,
    `Tebakan pemain: ${text}`,
    'Balas JSON saja: {"index":0} jika tidak cocok, atau {"index":N} jika maksudnya sama dengan jawaban N.',
  ].join('\n')
  try {
    const raw = await Promise.race([
      askLLM([{ role: 'user', content: prompt }]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('f100 ai timeout')), AI_TIMEOUT)),
    ])
    const m = String(raw).match(/\{[\s\S]*\}/)
    const obj = JSON.parse(m?.[0] ?? String(raw)) as { index?: unknown }
    const idx = Number(obj.index)
    if (!Number.isInteger(idx) || idx <= 0) return -1
    const real = idx - 1
    return real >= 0 && real < g.q.jawaban.length ? real : -1
  } catch {
    return -1
  }
}

const reactAnswer = async (g: Game, ctx: Pick<CommandContext, 'sock' | 'chat'> & { msgKey?: WAMessageKey }, emoji: string) => {
  if (g.lastReactKey) await ctx.sock.sendMessage(ctx.chat, { react: { text: '', key: g.lastReactKey } }).catch(() => {})
  if (ctx.msgKey) {
    await ctx.sock.sendMessage(ctx.chat, { react: { text: emoji, key: ctx.msgKey } }).catch(() => {})
    g.lastReactKey = ctx.msgKey
  } else g.lastReactKey = undefined
}

export const handleF100Answer = async (
  ctx: Pick<CommandContext, 'sock' | 'chat' | 'reply'> & { msgKey?: WAMessageKey },
  sender: string,
  text: string,
  push?: string,
): Promise<boolean> => {
  const g = pendingF100(ctx.chat)
  if (!g) return false
  const guess = norm(text)
  if (guess.length < 2) return false
  const cached = g.judge.get(guess)
  let match: Match
  if (cached !== undefined) {
    match = cached === -1
      ? { kind: 'miss', index: -1 }
      : g.open[cached] ? { kind: 'already', index: cached } : { kind: 'hit', index: cached }
  } else {
    const exact = exactMatch(g, text)
    if (exact >= 0) {
      match = { kind: g.open[exact] ? 'already' : 'hit', index: exact }
    } else {
      const ai = await aiMatchIdx(g, text)
      match = ai >= 0 ? { kind: g.open[ai] ? 'already' : 'hit', index: ai } : { kind: 'miss', index: -1 }
    }
    g.judge.set(guess, match.kind === 'hit' || match.kind === 'already' ? match.index : -1)
  }
  g.at = Date.now()
  if (match.kind !== 'hit') {
    await reactAnswer(g, ctx, match.kind === 'already' ? '♻️' : '❌')
    return true
  }
  g.open[match.index] = true
  g.by[match.index] = nick(sender, push)
  await reactAnswer(g, ctx, '✅')
  if (g.open.every(Boolean)) {
    games.delete(ctx.chat)
    await renderF100(ctx, g, `Semua terjawab! 🎉`)
    return true
  }
  await renderF100(ctx, g, `Benar: ${g.q.jawaban[match.index]} (+${nick(sender, push)})`)
  return true
}

export const startF100 = async (ctx: CommandContext): Promise<void> => {
  const g = pendingF100(ctx.chat)
  if (g) { await ctx.reply('Masih ada ronde aktif. Jawab langsung, `.f100 stop` untuk mengakhiri, atau `.f100 surrender` untuk menyerah dan buka jawaban.'); return }
  await ctx.react('⏳').catch(() => {})
  let q: Q
  try {
    q = await fetchQuestion()
  } catch (err) {
    await ctx.reply(`❌ Gagal ambil soal Family 100: ${(err as Error).message}`)
    return
  }
  const ng: Game = { chat: ctx.chat, q, open: q.jawaban.map(() => false), by: q.jawaban.map(() => null), at: Date.now(), judge: new Map(), hints: q.jawaban.map(() => 0) }
  pruneGames()
  games.set(ctx.chat, ng)
  try {
    await renderF100(ctx, ng, 'Mulai! Ketik jawabanmu langsung (tanpa perintah).')
  } catch (err) {
    games.delete(ctx.chat)
    await ctx.reply(`❌ Gagal kirim papan Family 100: ${(err as Error).message}`)
  }
}

export const hintF100 = async (ctx: CommandContext): Promise<void> => {
  const g = pendingF100(ctx.chat)
  if (!g) { await ctx.reply('Tidak ada game Family 100 aktif.'); return }
  const i = pickHintTarget(g)
  if (i < 0) { await ctx.reply('Semua jawaban sudah terbuka.'); return }
  const level = (g.hints[i] ?? 0) + 1
  g.hints[i] = level
  g.at = Date.now()
  await ctx.reply(`Hint #${i + 1}: ${hintOf(g.q.jawaban[i], level)}`)
}

export const stopF100 = async (ctx: CommandContext): Promise<void> => {
  const g = games.get(ctx.chat)
  if (!g) { await ctx.reply('Tidak ada game Family 100 aktif.'); return }
  games.delete(ctx.chat)
  await renderF100(ctx, { ...g, open: g.open.map(() => true) }, 'Ronde dihentikan. Jawaban dibuka.')
}

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
  reactKeys: WAMessageKey[]
  reactSeq: number
  judge: Map<string, number>
  hints: number[]
  hintTarget?: number
  // kapan terakhir kita bilang "juri belum jawab" — biar gak spam pas AI ngadat
  busyAt: number
}
const games = new Map<string, Game>()
const TTL = 3 * 60_000
const GAMES_MAX = 500
const AI_TIMEOUT = 6000
// juri butuh lebih napas daripada gerbang soal: kalau dia keliru, pemain yang kena
const JUDGE_TIMEOUT = 10_000
const JUDGE_CACHE_MAX = 200
// gak ada verdict: kasih jeda sebelum orang yang sama diomelin "sabar" lagi
const BUSY_NOTICE_MS = 8000


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

const MIN_ANSWERS = 4
const MAX_ANSWERS = 10
const QUALITY_ATTEMPTS = 3
const FETCH_BUDGET = 15_000 // total waktu maksimal ambil kandidat bersih (ms)
const API_TIMEOUT = 10_000 // default wakafy 60s: satu call hang bisa makan seluruh budget
const POOL_MAX = 20

// soal yang pernah lolos gerbang 4-10 — cadangan terakhir kalau API ngadat,
// biar bot gak pernah diam total gara-gara sumber soal mati
const pool: Q[] = []
const keepPool = (q: Q): void => {
  const k = norm(q.soal)
  if (pool.some((p) => norm(p.soal) === k)) return
  pool.push(q)
  if (pool.length > POOL_MAX) pool.shift()
}
const fromPool = (): Q | undefined => (pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined)

// gerbang non-LLM (bentuk respon + jumlah jawaban 4-10 + panjang soal).
// Berbasis budget waktu, bukan jumlah attempt: API cepat = dapat banyak kandidat,
// API lemot = berhenti tanpa bikin pemain nunggu kelamaan
const fetchClean = async (deadline: number): Promise<Q | undefined> => {
  let errors = 0
  while (Date.now() < deadline) {
    const left = deadline - Date.now()
    let res: ApiQ
    try {
      // timeout dipotong sisa budget biar satu call lemot gak lewat deadline
      res = await wakafy.json<ApiQ>('/v1/ext/salsabytes/family100', {}, { timeout: Math.min(API_TIMEOUT, left) })
    } catch {
      // API keliatan mati dan pool ada isinya: jangan tunggu budget habis
      if (++errors >= 2 && pool.length) return
      continue
    }
    errors = 0
    const soal = String(res.soal ?? '').trim()
    const jawaban = (res.jawaban ?? []).map((a) => String(a).trim()).filter(Boolean)
    if (!res.ok || !soal || !jawaban.length) continue
    // syarat keras: papan cuma boleh 4-10 baris
    if (jawaban.length < MIN_ANSWERS || jawaban.length > MAX_ANSWERS) continue
    if (soal.replace(/\s+/g, ' ').trim().length < 8) continue
    const q: Q = { soal, jawaban }
    keepPool(q)
    return q
  }
  return
}

// gerbang LLM terpisah: verdict "jelek" cuma berarti ambil kandidat baru, jadi
// budget ambil kandidat tidak termakan. Habis = pakai kandidat terakhir, dan
// kalau API benar-benar mati, pakai soal dari pool (fail-open sejauh mungkin)
const fetchQuestion = async (): Promise<Q | undefined> => {
  const deadline = Date.now() + FETCH_BUDGET
  let q = await fetchClean(deadline)
  for (let attempt = 1; attempt < QUALITY_ATTEMPTS && q; attempt++) {
    if (await isGoodQuestion(q)) break
    const next = await fetchClean(deadline)
    if (!next) break
    q = next
  }
  q ??= fromPool()
  return q ? curateAnswers(q) : undefined
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

// true kalau beda cuma satu edit (sisip/hapus/ganti), tanpa alokasi matrix
const oneEditApart = (a: string, b: string): boolean => {
  if (a === b) return true
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  if (l.length - s.length > 1) return false
  let i = 0
  while (i < s.length && s[i] === l[i]) i++
  // panjang sama = satu huruf ketuker, beda satu = satu huruf nyelip
  return s.length === l.length ? s.slice(i + 1) === l.slice(i + 1) : s.slice(i) === l.slice(i + 1)
}

const FUZZY_MIN = 5

// Lapis 1: prefilter lokal yang HANYA punya hak menerima.
// Ini pernah bikin jawaban bener nyangkut karena lokal dikasih hak menolak.
// Sekarang tiap hasil "gak yakin" wajib balik undefined → diteruskan ke juri AI,
// dan yang boleh bilang "salah" cuma AI.
const localMatch = (g: Game, text: string): number | undefined => {
  const t = norm(text)
  if (!t) return undefined
  const tw = t.split(' ').filter(Boolean)
  if (!tw.length) return undefined
  // dua pass: baris yang belum kebuka didahulukan biar gak jadi ♻️ padahal ada yang baru
  for (const skipOpen of [true, false]) {
    for (let i = 0; i < g.q.jawaban.length; i++) {
      if (skipOpen && g.open[i]) continue
      const a = norm(g.q.jawaban[i])
      if (!a) continue
      const aw = a.split(' ').filter(Boolean)
      if (aw.length !== 1) continue
      // jawaban satu kata muncul utuh di kalimat tebakan: "bakso" ⊂ "makan bakso"
      if (aw[0].length >= 3 && tw.includes(aw[0])) return i
      // typo satu huruf pada kata tunggal yang cukup panjang: "nyamok" → "nyamuk"
      if (tw.length === 1 && aw[0].length >= FUZZY_MIN && oneEditApart(aw[0], t)) return i
    }
  }
  return undefined
}

// index >= 0 = cocok, -1 = AI bilang jelas gak cocok, undefined = belum ada verdict
const aiMatchIdx = async (g: Game, text: string): Promise<number | undefined> => {
  const candidates = g.q.jawaban.map((a, i) => ({ i, a }))
  if (!candidates.length || text.trim().length < 2) return undefined
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
  // abort beneran: request yang kalah timeout dulu tetep hidup 120s dan numpuk
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), JUDGE_TIMEOUT)
  try {
    const raw = await askLLM([{ role: 'user', content: prompt }], [], undefined, ac.signal)
    const m = String(raw).match(/\{[\s\S]*\}/)
    const obj = JSON.parse(m?.[0] ?? String(raw)) as { index?: unknown }
    const idx = Number(obj.index)
    // jawaban ngaco/gak kebaca = belum ada verdict, bukan "salah"
    if (!Number.isInteger(idx)) return undefined
    if (idx <= 0) return -1
    const real = idx - 1
    return real >= 0 && real < g.q.jawaban.length ? real : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

const reactAnswer = async (g: Game, ctx: Pick<CommandContext, 'sock' | 'chat'> & { msgKey?: WAMessageKey }, emoji: string) => {
  const key = ctx.msgKey
  // swap is sync (sebelum await) biar jawaban yang masuk bersamaan gak saling nimpa
  const seq = ++g.reactSeq
  const prev = g.reactKeys
  g.reactKeys = key ? [key] : []
  await Promise.all(prev.map((k) => ctx.sock.sendMessage(ctx.chat, { react: { text: '', key: k } }).catch(() => {})))
  if (key) await ctx.sock.sendMessage(ctx.chat, { react: { text: emoji, key } }).catch(() => {})
  // udah ada jawaban lebih baru: unreact-nya bisa kelewat sebelum react ini kekirim, jadi bersihin lagi
  if (key && seq !== g.reactSeq) await ctx.sock.sendMessage(ctx.chat, { react: { text: '', key } }).catch(() => {})
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

  const verdict = (i: number): Match => ({ kind: g.open[i] ? 'already' : 'hit', index: i })
  const remember = (i: number): Match => {
    const m = verdict(i)
    // cap cache per ronde: grup rame bisa numbuh tanpa batas
    if (g.judge.size >= JUDGE_CACHE_MAX) g.judge.delete(g.judge.keys().next().value!)
    g.judge.set(guess, i)
    return m
  }

  const cached = g.judge.get(guess)
  let match: Match | undefined
  if (cached !== undefined) {
    match = cached === -1 ? { kind: 'miss', index: -1 } : verdict(cached)
  } else {
    const exact = exactMatch(g, text)
    if (exact >= 0) match = remember(exact)
    else {
      const local = localMatch(g, text)
      if (local !== undefined) match = remember(local)
      else {
        const ai = await aiMatchIdx(g, text)
        if (ai === undefined) {
          // gak ada verdict: JANGAN react ❌ dan JANGAN cache. Dulu di sini miss
          // permanen dicap sekali timeout, jadi jawaban bener gak pernah dicek lagi.
          g.at = Date.now()
          // reaksi selalu dikasih (per pesan, murah); teksnya di-gate biar grup
          // ramai gak kebanjiran "sabar" tiap kali juri ngadat
          await reactAnswer(g, ctx, '⏳')
          if (!g.busyAt || Date.now() - g.busyAt > BUSY_NOTICE_MS) {
            g.busyAt = Date.now()
            await ctx.reply('Juri AI lagi sibuk, belum bisa nilai. Coba kirim lagi bentar.').catch(() => {})
          }
          return true
        }
        match = ai === -1 ? { kind: 'miss', index: -1 } : remember(ai)
        // cuma "jelas gak cocok" versi AI yang layak di-cache
        if (ai === -1 && !g.judge.has(guess)) g.judge.set(guess, -1)
      }
    }
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
  const q = await fetchQuestion()
  if (!q) {
    // sumber soal lagi ngadat: lepas ⏳ dan diem, jangan lempar error ke chat
    await ctx.react('').catch(() => {})
    return
  }
  const ng: Game = { chat: ctx.chat, q, open: q.jawaban.map(() => false), by: q.jawaban.map(() => null), at: Date.now(), reactKeys: [], reactSeq: 0, judge: new Map(), hints: q.jawaban.map(() => 0), busyAt: 0 }
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

// probe pipeline soal tanpa socket/key WA: F100_SELFTEST=1 bun src/lib/f100.ts
// tambah F100_SELFTEST_DEGRADE=1 buat buktiin fallback pool saat API mati
if (process.env.F100_SELFTEST) {
  for (let i = 0; i < 5; i++) {
    const q = await fetchQuestion()
    console.log(q ? `ok ${q.jawaban.length} jawaban | ${q.soal}` : 'gagal: tidak dapat soal')
  }
  if (process.env.F100_SELFTEST_DEGRADE) {
    wakafy.base = 'http://127.0.0.1:9' // API dimatikan
    const t = Date.now()
    const q = await fetchQuestion()
    console.log(q ? `pool fallback ok (${Date.now() - t}ms) ${q.jawaban.length} jawaban | ${q.soal}` : 'pool fallback gagal: kosong')
  }
  await new Promise((r) => setTimeout(r, 200))
  process.exit(0)
}

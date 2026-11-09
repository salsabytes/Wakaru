import { sendRichMulti, type RichPart } from '../../lib/richmsg.ts'
import { wakafy } from '../../lib/wakafy.ts'

type Q = { soal: string; jawaban: string[] }
type Game = { chat: string; q: Q; open: boolean[]; by: (string | null)[]; at: number }
const games = new Map<string, Game>()
const TTL = 3 * 60_000

type ApiQ = { ok: boolean; total: number; id: number; soal: string; jawaban: string[] }

// soal bank lives on the wakafy API (salsabytes/family100), not in this repo
const fetchQuestion = async (): Promise<Q> => {
  const res = await wakafy.json<ApiQ>('/v1/ext/salsabytes/family100')
  const soal = String(res.soal ?? '').trim()
  const jawaban = (res.jawaban ?? []).map((a) => String(a).trim()).filter(Boolean)
  if (!res.ok || !soal || !jawaban.length) throw new Error('respon API tidak valid')
  return { soal, jawaban }
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const nick = (jid: string, push?: string) => push || jid.split(/[@:]/)[0]

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
  return `<style>html,body{margin:0;padding:0}</style><div style="font-family:system-ui;padding:10px;border-radius:14px;background:linear-gradient(160deg,#0f172a,#111827);color:#f8fafc;border:1px solid #1f2937;width:100%;max-width:320px;box-sizing:border-box"><div style="font-size:10px;color:#c4b5fd;letter-spacing:.12em;font-weight:700">FAMILY 100</div><div style="font-size:16px;font-weight:800;line-height:1.2;margin-top:2px">${esc(g.q.soal)}</div><div style="font-size:11px;color:#94a3b8;margin-top:2px">Terjawab ${left}/${g.q.jawaban.length} · ketik jawaban langsung</div>${rows}${note ? `<div style="margin-top:8px;font-size:12px;color:#fde68a;font-weight:600">${esc(note)}</div>` : ''}</div>`
}

export const renderF100 = async (ctx: Pick<CommandContext, 'sock' | 'chat'>, g: Game, note = '') => {
  // 1 bubble: HTML visual (atas) + tabel native penjawab (bawah), tanpa bubble terpisah
  const rows = g.q.jawaban.map((a, i) => [String(i + 1), g.open[i] ? a : '???', g.open[i] ? (g.by[i] ?? '-') : '-'])
  const left = g.open.filter(Boolean).length
  const parts: RichPart[] = [
    { type: 'text', text: `*${g.q.soal}*\nTerjawab ${left}/${g.q.jawaban.length} · ketik jawaban langsung${note ? `\n_${note}_` : ''}` },
    { type: 'table', title: 'Jawaban', rows: [['#', 'Jawaban', 'Dijawab oleh'], ...rows] },
  ]
  await sendRichMulti(ctx.sock, ctx.chat, boardHtml(g, note), parts, { title: 'Family 100', mirrorSections: true })
}

const matchIdx = (g: Game, text: string): number => {
  const t = norm(text)
  if (t.length < 2) return -1
  for (let i = 0; i < g.q.jawaban.length; i++) {
    if (g.open[i]) continue
    const a = norm(g.q.jawaban[i])
    if (!a) continue
    if (t === a || a.includes(t) || t.includes(a)) return i
  }
  return -1
}

export const handleF100Answer = async (ctx: Pick<CommandContext, 'sock' | 'chat' | 'reply'>, sender: string, text: string, push?: string): Promise<boolean> => {
  const g = pendingF100(ctx.chat)
  if (!g) return false
  const i = matchIdx(g, text)
  if (i < 0) return false
  g.open[i] = true
  g.by[i] = nick(sender, push)
  g.at = Date.now()
  if (g.open.every(Boolean)) {
    games.delete(ctx.chat)
    await renderF100(ctx, g, `Semua terjawab! 🎉`)
    return true
  }
  await renderF100(ctx, g, `Benar: ${g.q.jawaban[i]} (+${nick(sender, push)})`)
  return true
}

export default {
  name: 'family100',
  aliases: ['f100', 'fam100'],
  desc: 'game Family 100 (survei) — jawab langsung di chat, 1 ronde per grup/chat',
  run: async (ctx: CommandContext) => {
    const sub = ctx.args[0]?.toLowerCase()
    if (sub === 'stop' || sub === 'nyerah' || sub === 'skip') {
      const g = games.get(ctx.chat)
      if (!g) return ctx.reply('Tidak ada game Family 100 aktif.')
      games.delete(ctx.chat)
      await renderF100(ctx, { ...g, open: g.open.map(() => true) }, 'Ronde dihentikan. Jawaban dibuka.')
      return
    }
    if (pendingF100(ctx.chat)) return ctx.reply('Masih ada ronde aktif. Jawab langsung, atau `.f100 stop` untuk mengakhiri.')
    let q: Q
    try {
      q = await fetchQuestion()
    } catch (err) {
      return ctx.reply(`❌ Gagal ambil soal Family 100: ${(err as Error).message}`)
    }
    const g: Game = { chat: ctx.chat, q, open: q.jawaban.map(() => false), by: q.jawaban.map(() => null), at: Date.now() }
    games.set(ctx.chat, g)
    await renderF100(ctx, g, 'Mulai! Ketik jawabanmu langsung (tanpa perintah).')
  },
} satisfies Command
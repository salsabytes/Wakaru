import type { WAMessage } from 'baileys'
import { download, searchYouTube, type YtResult } from '../../lib/scrapers/index.ts'
import { withSlot } from '../../lib/queue.ts'
import { logger } from '../../lib/logger.ts'
import type { SerializedMessage } from '../../lib/serialize.ts'
import type { Sender } from '../../lib/sender.ts'

export interface PendingPlay {
  results: YtResult[]
  at: number
}

const TTL = 3 * 60_000
const pending = new Map<string, PendingPlay>()

export const pendingPlay = (chat: string, sender: string): PendingPlay | undefined => {
  const p = pending.get(`${chat}:${sender}`)
  if (!p) return undefined
  if (Date.now() - p.at > TTL) {
    pending.delete(`${chat}:${sender}`)
    return undefined
  }
  return p
}

export const dropPlay = (chat: string, sender: string): boolean => pending.delete(`${chat}:${sender}`)

export function parsePick(text: string): { index: number; mode?: 'audio' | 'video' } | undefined {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})\s*(mp3|mp4|audio|video)?$/)
  if (!m) return undefined
  return { index: Number(m[1]) - 1, mode: m[2] === 'mp4' || m[2] === 'video' ? 'video' : m[2] ? 'audio' : undefined }
}

export function parseButtonPick(id: string): { index: number; mode?: 'audio' | 'video' } | undefined {
  const m = id.match(/^play:(\d{1,2})(?::(mp3|mp4))?$/)
  if (!m) return undefined
  return { index: Number(m[1]) - 1, mode: m[2] === 'mp4' ? 'video' : m[2] ? 'audio' : undefined }
}

export async function handlePlayPick(
  msg: WAMessage,
  m: SerializedMessage,
  sender: string,
  send: Sender,
): Promise<void> {
  const pick = pendingPlay(m.chat, sender)
  if (!pick) return
  const choice = parseButtonPick(m.button?.id ?? '') ?? parsePick(m.text)
  if (!choice) return send.text('hmm, gak kebaca nih 😅 coba balas pake *nomor + format* (mis. *1 mp3*) atau ketuk tombolnya')
  const hit = pick.results[choice.index]
  if (!hit) return send.text('nomornya cuma 1–5 aja ya 😉')
  const mode = choice.mode
  if (!mode) {
    pick.at = Date.now()
    return send.buttons(
      [
        { id: `play:${choice.index + 1}:mp3`, text: '🎵 MP3' },
        { id: `play:${choice.index + 1}:mp4`, text: '🎬 MP4' },
      ],
      `pilih format buat *${hit.title.slice(0, 80)}*`,
      '3 menit aja ya 😉',
    )
  }
  if (!dropPlay(m.chat, sender)) return // pick already consumed by another concurrent pick
  await send.react('⏳', msg.key).catch(() => {})
  try {
    await withSlot(async () => {
      const media = await download(`https://youtu.be/${hit.id}`, mode)
      if (mode === 'audio') await send.audio(media.buf)
      else await send.video(media.buf, hit.title)
    })
    await send.react('✅', msg.key).catch(() => {})
  } catch (err) {
    logger.error('play download error:', err)
    await send.react('❌', msg.key).catch(() => {})
    await send.text(`❌ play failed: ${(err as Error).message.slice(0, 300)}`)
  }
}

export default {
  name: 'play',
  desc: 'search YouTube by query, pick a result, download mp3/mp4',
  aliases: ['yt', 'song'],
  run: async (ctx: CommandContext) => {
    const query = ctx.text.trim()
    if (!query) return ctx.reply(`usage: ${ctx.prefix}play <judul lagu/video> — nanti balas pake nomor + format, mis. *1 mp3* atau *1 mp4*`)

    const results = await searchYouTube(query)
    if (!results.length) return ctx.reply('❌ play: nggak nemu hasil buat query itu 😢')
    pending.set(`${ctx.chat}:${ctx.sender}`, { results, at: Date.now() })

    await ctx.sendList({
      text: `🎵 hasil cari *"${query.slice(0, 80)}"* — ketuk salah satu:`,
      title: 'Pilih hasil 🎵',
      footer: 'nanti pilih format mp3/mp4, atau langsung balas nomor + format (mis. 2 mp4). 3 menit aja ya 😉',
      sections: [
        {
          rows: results.map((r, i) => ({ header: String(i + 1), title: r.title.slice(0, 60), id: `play:${i + 1}` })),
        },
      ],
    })
  },
}

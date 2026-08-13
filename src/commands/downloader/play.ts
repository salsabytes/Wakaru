import type { WAMessage } from 'baileys'
import { download, searchYouTube, type YtResult } from '../../lib/scrapers/index.ts'
import { withSlot, cooldownLeft } from '../../lib/queue.ts'
import { t } from '../../lib/lang.ts'
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

// true = consumed (pick/cancel); false = let the message fall through to normal handling
export async function handlePlayPick(
  msg: WAMessage,
  m: SerializedMessage,
  sender: string,
  send: Sender,
): Promise<boolean> {
  const pick = pendingPlay(m.chat, sender)
  if (!pick) return false
  if (m.button?.id === 'play:cancel') {
    dropPlay(m.chat, sender)
    await send.text(t('playCancelled'))
    return true
  }
  const choice = parseButtonPick(m.button?.id ?? '') ?? parsePick(m.text)
  if (!choice) {
    if (/^(batal|cancel|gajadi|gak jadi|nggak jadi)$/i.test(m.text.trim())) {
      dropPlay(m.chat, sender)
      await send.text(t('playCancelled'))
      return true // consumed — don't also feed the cancel word to the AI
    }
    return false // not a pick — let the message flow normally, no badPick spam
  }
  const hit = pick.results[choice.index]
  if (!hit) {
    await send.text(t('outOfRange'))
    return true
  }
  const mode = choice.mode
  if (!mode) {
    pick.at = Date.now()
    await send.buttons(
      [
        { id: `play:${choice.index + 1}:mp3`, text: '🎵 MP3' },
        { id: `play:${choice.index + 1}:mp4`, text: '🎬 MP4' },
        { id: 'play:cancel', text: '❌ Batal' },
      ],
      t('pickFormat', { title: hit.title.slice(0, 80) }),
      t('footer3min'),
    )
    return true
  }
  const left = cooldownLeft(`${sender}:play`, 5)
  if (left) {
    await send.text(`sabar dulu ${left} detik ya 😅`)
    return true
  }
  if (!dropPlay(m.chat, sender)) return true // pick already consumed by another concurrent pick
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
    await send.text(t('playFailed', { msg: (err as Error).message.slice(0, 300) }))
  }
  return true
}

export default {
  name: 'play',
  desc: 'search YouTube by query, pick a result, download mp3/mp4',
  aliases: ['yt', 'song'],
  run: async (ctx: CommandContext) => {
    const query = ctx.text.trim()
    if (!query) return ctx.reply(t('playUsage', { prefix: ctx.prefix }))

    const results = await searchYouTube(query)
    if (!results.length) return ctx.reply(t('noResults'))
    pending.set(`${ctx.chat}:${ctx.sender}`, { results, at: Date.now() })

    // quick_reply buttons (not single_select — that renders blank on iOS); body stays replyable as "1 mp3"
    const numbered = results.map((r, i) => `${i + 1}. ${r.title.slice(0, 60)}`).join('\n')
    await ctx.sendButtons(
      [{ id: 'play:cancel', text: '❌ Batal' }],
      `${t('resultList', { query: query.slice(0, 80) })}\n${numbered}`,
      t('listFooter'),
    )
  },
}

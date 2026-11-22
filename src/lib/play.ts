import type { WAMessage } from 'baileys'
import { searchYouTube, type YtResult } from './download/scrapers/index.ts'
import { downloadYouTube } from './download/youtube-dl.ts'
import { oversizedDoc } from './wa/media.ts'
import { withSlot, cooldownLeft } from './queue.ts'
import { tx } from './lang.ts'
import { logger } from './logger.ts'
import { getSock } from '../socket.ts'
import { makeSender, type Sender } from './wa/sender.ts'
import type { SerializedMessage } from './wa/serialize.ts'

export interface PendingPlay {
  results: YtResult[]
  at: number
  // Tracks which result already showed format buttons, so repeat taps don't spam.
  selected?: number
}

const TTL = 3 * 60_000
const PENDING_MAX = 500
// Active play sessions keyed by chat:sender.
const pending = new Map<string, PendingPlay>()
// One stale notice per chat:sender within the TTL window.
const staleNotified = new Map<string, number>()
const keyFor = (chat: string, sender: string): string => `${chat}:${sender}`

const prunePending = (): void => {
  const now = Date.now()
  for (const [key, p] of pending) if (now - p.at > TTL) pending.delete(key)
  while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value!)
}

export const pendingPlay = (chat: string, sender: string): PendingPlay | undefined => {
  const key = keyFor(chat, sender)
  const p = pending.get(key)
  if (!p) {
    // WA can switch between LID/PN sender IDs; recover by the same numeric identity.
    const num = sender.split(/[:@]/)[0]
    for (const [k, v] of pending) {
      if (!k.startsWith(`${chat}:`)) continue
      if (Date.now() - v.at > TTL) { pending.delete(k); continue }
      if (k.slice(chat.length + 1).split(/[:@]/)[0] !== num) continue
      pending.delete(k)
      pending.set(key, v)
      return v
    }
    return undefined
  }
  if (Date.now() - p.at > TTL) {
    pending.delete(key)
    return undefined
  }
  return p
}

export const pendingPlayOwner = (chat: string): string | undefined => {
  const now = Date.now()
  for (const [key, p] of pending) {
    if (!key.startsWith(`${chat}:`)) continue
    if (now - p.at > TTL) { pending.delete(key); continue }
    return key.slice(chat.length + 1)
  }
}

const STALE_TTL = 10 * 60_000
const staleKey = (chat: string, sender: string): string => `${chat}:${sender}`

const noteStale = (chat: string, sender: string): boolean => {
  const key = staleKey(chat, sender)
  const now = Date.now()
  for (const [k, at] of staleNotified) if (now - at > STALE_TTL) staleNotified.delete(k)
  if (staleNotified.has(key)) return false
  staleNotified.set(key, now)
  return true
}

export const clearStalePlayNotice = (chat: string, sender: string): void => {
  staleNotified.delete(staleKey(chat, sender))
}

export const dropPlay = (chat: string, sender: string): boolean => {
  staleNotified.delete(staleKey(chat, sender))
  return pending.delete(keyFor(chat, sender))
}

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
): Promise<boolean> {
  const pick = pendingPlay(m.chat, sender)
  const isPlayButton = !!m.button?.id?.startsWith('play:')
  const pickText = m.text.trim()
  const textChoice = parsePick(pickText)
  const textCancel = /^(batal|cancel|gajadi|gak jadi|nggak jadi)$/i.test(pickText)
  if (!pick) {
    if (isPlayButton) {
      const owner = pendingPlayOwner(m.chat)
      if (owner && owner !== sender) {
        const sock = getSock()
        if (sock) await makeSender(sock, m.chat, msg).text(`Tombol ini cuma buat @${owner.split(/[:@]/)[0]}.`)
        return true
      }
      // Expired play button: warn once, then stay quiet.
      if (noteStale(m.chat, sender)) await send.text(await tx('stalePlay'))
      return true
    }
    if (textChoice || textCancel) {
      // Plain "1"/cancel after expiry: warn once to avoid spam loops.
      if (noteStale(m.chat, sender)) {
        logger.warn(`play stale: chat=${m.chat} sender=${sender} keys=${[...pending.keys()].join('|')}`)
        await send.text(await tx('stalePlay'))
      }
      return true
    }
    return false
  }
  if (m.button?.id === 'play:cancel') {
    dropPlay(m.chat, sender)
    await send.text(await tx('playCancelled'))
    return true
  }
  const choice = parseButtonPick(m.button?.id ?? '') ?? parsePick(m.text)
  if (!choice) {
    if (textCancel) {
      dropPlay(m.chat, sender)
      await send.text(await tx('playCancelled'))
      return true
    }
    return false
  }
  const hit = pick.results[choice.index]
  if (!hit) {
    await send.text(await tx('outOfRange'))
    return true
  }
  const mode = choice.mode
  if (!mode) {
    // Same number again should not resend the format buttons.
    if (pick.selected === choice.index) return true
    pick.selected = choice.index
    pick.at = Date.now()
    await send.buttons(
      [
        { id: `play:${choice.index + 1}:mp3`, text: '🎵 MP3' },
        { id: `play:${choice.index + 1}:mp4`, text: '🎬 MP4' },
        { id: 'play:cancel', text: '❌ Batal' },
      ],
      await tx('pickFormat', { title: hit.title.slice(0, 80) }),
      await tx('footer3min'),
    )
    return true
  }
  const left = cooldownLeft(`${sender}:play`, 5)
  if (left) {
    await send.text(`sabar dulu ${left} detik ya ⏳`)
    return true
  }
  if (!dropPlay(m.chat, sender)) return true
  await send.react('⏳', msg.key).catch(() => {})
  try {
    await withSlot(async () => {
      const media = await downloadYouTube(`https://youtu.be/${hit.id}`, mode)
      const doc = oversizedDoc({ type: mode === 'audio' ? 'audio' : 'video', buf: media.buf, caption: hit.title })
      if (doc) await send.document(doc.buf, doc.name, doc.mime)
      else if (mode === 'audio') await send.audio(media.buf)
      else await send.video(media.buf, hit.title)
    })
    await send.react('✅', msg.key).catch(() => {})
  } catch (err) {
    logger.error('play download error:', err)
    prunePending()
    pending.set(`${m.chat}:${sender}`, { results: pick.results, at: Date.now() })
    await send.react('❌', msg.key).catch(() => {})
    const why = (err as Error).message
    const unavailable = /tidak tersedia|no disponible|not available|unsupported|422/i.test(why)
    if (unavailable && mode === 'audio') {
      await send.buttons(
        [
          { id: `play:${choice.index + 1}:mp4`, text: '🎬 Coba MP4' },
          { id: 'play:cancel', text: '❌ Batal' },
        ],
        await tx('playUnavailable'),
        await tx('footer3min'),
      )
      return true
    }
    await send.text(
      unavailable ? await tx('playUnavailable') : await tx('playFailed', { msg: why.slice(0, 300) }),
    )
  }
  return true
}

export async function startPlay(ctx: CommandContext): Promise<void> {
  const query = ctx.text.trim()
  if (!query) { await ctx.reply(await tx('playUsage', { prefix: ctx.prefix })); return }
  const results = await searchYouTube(query)
  if (!results.length) { await ctx.reply(await tx('noResults')); return }
  prunePending()
  clearStalePlayNotice(ctx.chat, ctx.sender)
  pending.set(`${ctx.chat}:${ctx.sender}`, { results, at: Date.now() })
  const numbered = results.map((r, i) => `${i + 1}. ${r.title.slice(0, 60)}`).join('\n')
  await ctx.sendButtons(
    [{ id: 'play:cancel', text: '❌ Batal' }],
    `${await tx('resultList', { query: query.slice(0, 80) })}\n${numbered}`,
    await tx('listFooter'),
  )
}

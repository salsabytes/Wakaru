import type { GroupParticipant } from 'baileys'
import { getSock } from '../socket.ts'
import { goodbyeConfig, welcomeConfig } from '../lib/wa/groupSettings.ts'
import { recentByChat } from '../lib/wa/store.ts'
import { logger } from '../lib/logger.ts'

const numOf = (id: string) => id.split(/[:@]/)[0]
const isDigits = (s: string) => /^\+?\d[\d\s-]*$/.test(s) || /^[\d:@.]+$/.test(s)

const render = (tpl: string, data: { mention: string; name: string; desc: string; gcname: string }): { text: string; withPp: boolean } => {
  let withPp = false
  let text = tpl.replace(/`pp`/gi, () => {
    withPp = true
    return ''
  })
  text = text
    .replace(/`mention`/gi, data.mention)
    .replace(/`name`/gi, data.name)
    .replace(/`desc`/gi, data.desc)
    .replace(/`gcname`/gi, data.gcname)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, withPp }
}

const defaultPp = (_name: string) =>
  'https://www.its.ac.id/tki/wp-content/uploads/sites/53/2025/08/pp-kosong-wa-default.jpg'

const getPpUrl = async (sock: any, p: string | GroupParticipant): Promise<string | undefined> => {
  const obj = typeof p === 'string' ? {} : (p as any)
  const candidates = [typeof p === 'string' ? p : null, obj.phoneNumber, obj.id, obj.lid].filter(Boolean) as string[]
  const seen = new Set<string>()
  for (const jid of candidates) {
    if (seen.has(jid)) continue
    seen.add(jid)
    try {
      const url = await sock.profilePictureUrl(jid, 'image')
      if (url) return url
    } catch {}
  }
}

const nameFromMessages = (chat: string, ids: Set<string>): string | undefined => {
  for (const msg of recentByChat(chat, 30).slice().reverse()) {
    const sender = String(msg.key?.participant ?? msg.key?.remoteJid ?? '')
    const senderNum = numOf(sender)
    if (![...ids].some((id) => id === sender || numOf(id) === senderNum)) continue
    const n = String(msg.pushName ?? '').trim()
    if (n && !isDigits(n)) return n
  }
}

const pickName = (p: string | GroupParticipant, jid: string, chat: string, meta?: { participants?: GroupParticipant[] }): string => {
  const obj = typeof p === 'string' ? undefined : (p as any)
  const candidates = [obj?.notify, obj?.name, obj?.verifiedName]
  const ids = new Set([jid, obj?.id, obj?.phoneNumber, obj?.lid, typeof p === 'string' ? p : undefined].filter(Boolean) as string[])
  for (const mp of meta?.participants ?? []) {
    const m = mp as any
    if ([m.id, m.phoneNumber, m.lid].some((x: string) => x && ids.has(x))) candidates.push(m.notify, m.name, m.verifiedName)
  }
  for (const c of candidates) {
    const s = typeof c === 'string' ? c.trim() : ''
    if (s && !isDigits(s)) return s
  }
  return nameFromMessages(chat, ids) ?? numOf(jid)
}

// Greet new members and say goodbye to leavers (per-group toggle + template).
export async function handleGroupParticipantsUpdate(update: {
  id: string
  participants: (string | GroupParticipant)[]
  action: string
}): Promise<void> {
  if (update.action !== 'add' && update.action !== 'remove') return
  const sock = getSock()
  if (!sock) return
  const cfg = update.action === 'add' ? welcomeConfig(update.id) : goodbyeConfig(update.id)
  if (!cfg.on) return

  let gcname = 'grup ini'
  let desc = '-'
  let meta: any
  try {
    meta = await sock.groupMetadata(update.id)
    gcname = meta.subject || gcname
    desc = String(meta.desc || '').trim() || '-'
  } catch {}

  for (const p of update.participants) {
    const obj = typeof p === 'string' ? undefined : (p as any)
    const jid = obj?.phoneNumber || obj?.id || (typeof p === 'string' ? p : '')
    if (!jid) continue
    const name = pickName(p, jid, update.id, meta)
    const mention = `@${numOf(jid)}`
    const { text, withPp } = render(cfg.msg, { mention, name, desc, gcname })
    const caption = text || (update.action === 'add' ? `halo ${mention}` : `bye ${mention}`)

    try {
      if (withPp) {
        const url = (await getPpUrl(sock, p)) || defaultPp(name)
        await sock.sendMessage(update.id, { image: { url }, caption, mentions: [jid] })
      } else {
        await sock.sendMessage(update.id, { text: caption, mentions: [jid] })
      }
    } catch (err) {
      logger.warn(update.action === 'add' ? 'welcome: send failed' : 'goodbye: send failed', err)
    }
  }
}

import type { GroupParticipant } from 'baileys'
import { getSock } from '../socket.ts'
import { goodbyeConfig, welcomeConfig } from '../lib/wa/groupSettings.ts'
import { logger } from '../lib/logger.ts'

const numOf = (id: string) => id.split(/[:@]/)[0]

const render = (tpl: string, data: { mention: string; desc: string; gcname: string }): { text: string; withPp: boolean } => {
  let withPp = false
  let text = tpl.replace(/`pp`/gi, () => {
    withPp = true
    return ''
  })
  text = text
    .replace(/`mention`/gi, data.mention)
    .replace(/`desc`/gi, data.desc)
    .replace(/`gcname`/gi, data.gcname)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, withPp }
}

const defaultPp = 'https://www.its.ac.id/tki/wp-content/uploads/sites/53/2025/08/pp-kosong-wa-default.jpg'

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
    const mention = `@${numOf(jid)}`
    const { text, withPp } = render(cfg.msg, { mention, desc, gcname })
    const caption = text || (update.action === 'add' ? `halo ${mention}` : `bye ${mention}`)

    try {
      if (withPp) {
        const url = (await getPpUrl(sock, p)) || defaultPp
        await sock.sendMessage(update.id, { image: { url }, caption, mentions: [jid] })
      } else {
        await sock.sendMessage(update.id, { text: caption, mentions: [jid] })
      }
    } catch (err) {
      logger.warn(update.action === 'add' ? 'welcome: send failed' : 'goodbye: send failed', err)
    }
  }
}

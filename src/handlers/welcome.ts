import type { GroupParticipant } from 'baileys'
import { getSock } from '../socket.ts'
import { welcomeConfig } from '../lib/groupSettings.ts'
import { logger } from '../lib/logger.ts'

const numOf = (id: string) => id.split(/[:@]/)[0]

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

const defaultPp = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=e5e7eb&color=374151&size=512&bold=true`

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

export async function handleGroupParticipantsUpdate(update: {
  id: string
  participants: (string | GroupParticipant)[]
  action: string
}): Promise<void> {
  if (update.action !== 'add') return
  const sock = getSock()
  if (!sock) return
  const cfg = welcomeConfig(update.id)
  if (!cfg.on) return

  let gcname = 'grup ini'
  let desc = '-'
  try {
    const meta = await sock.groupMetadata(update.id)
    gcname = meta.subject || gcname
    desc = String((meta as any).desc || '').trim() || '-'
  } catch {}

  for (const p of update.participants) {
    const jid = typeof p === 'string' ? p : ((p as any).phoneNumber || (p as any).id)
    const name =
      typeof p === 'string'
        ? numOf(p)
        : ((p as any).notify || (p as any).name || numOf(jid))
    const mention = `@${numOf(jid)}`
    const { text, withPp } = render(cfg.msg, { mention, name, desc, gcname })
    const caption = text || `halo ${mention}`

    try {
      if (withPp) {
        const url = (await getPpUrl(sock, p)) || defaultPp(name)
        await sock.sendMessage(update.id, { image: { url }, caption, mentions: [jid] })
      } else {
        await sock.sendMessage(update.id, { text: caption, mentions: [jid] })
      }
    } catch (err) {
      logger.warn('welcome: send failed', err)
    }
  }
}

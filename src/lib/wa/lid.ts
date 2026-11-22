import type { WASocket } from 'baileys'
import { participantMaps } from './group.ts'

const CACHE_MAX = 1000
const cache = new Map<string, string>()

export const isLid = (jid: string): boolean => !!jid && (jid.endsWith('@lid') || jid.endsWith('@hosted.lid'))

// Resolve a @lid to the phone-number JID. The signalRepository map is preferred;
// when it's cold, fall back to the group roster (participants carry both ids).
export const resolveJid = async (sock: WASocket | undefined, jid: string, chat?: string | null): Promise<string> => {
  if (!jid || !isLid(jid) || !sock) return jid
  const cached = cache.get(jid)
  if (cached) return cached
  let pn = await sock.signalRepository.lidMapping.getPNForLID(jid).catch(() => null)
  if (!pn && chat?.endsWith('@g.us')) {
    const met = await sock.groupMetadata(chat).catch(() => undefined)
    if (met) {
      const p = participantMaps(met).byPart.get(jid.split(/[:@]/)[0])
      pn = p?.phoneNumber ?? (p?.id && !isLid(p.id) ? p.id : null)
    }
  }
  if (pn) {
    cache.set(jid, pn)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  }
  return pn ?? jid
}

// A stanza sometimes carries the PN alternative; prefer it when the LID map is
// cold, otherwise fall back to the lookup above.
export const resolveLid = async (
  sock: WASocket | undefined,
  jid: string,
  alt?: string | null,
  chat?: string | null,
): Promise<string> => {
  if (!jid || !isLid(jid)) return jid
  if (alt?.endsWith('@s.whatsapp.net')) return alt
  return resolveJid(sock, jid, chat)
}

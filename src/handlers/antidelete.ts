import { WAMessageStubType, type BaileysEventMap, type WAMessage, type WASocket } from 'baileys'
import { antideleteConfig } from '../lib/groupSettings.ts'
import { tx } from '../lib/lang.ts'
import { logger } from '../lib/logger.ts'
import { messageStore } from '../lib/store.ts'

const RESTORED_TTL = 5 * 60_000
const RESTORED_MAX = 1000
const restored = new Map<string, number>()

const alreadyRestored = (id: string): boolean => {
  const now = Date.now()
  const last = restored.get(id)
  if (last !== undefined && now - last < RESTORED_TTL) return true
  if (restored.size >= RESTORED_MAX) {
    for (const [key, at] of restored) if (now - at >= RESTORED_TTL) restored.delete(key)
    if (restored.size >= RESTORED_MAX) restored.delete(restored.keys().next().value!)
  }
  restored.set(id, now)
  return false
}

const isViewOnce = (msg: WAMessage): boolean =>
  !!(msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2 || msg.message?.viewOnceMessageV2Extension)

const who = (msg: WAMessage): string => {
  const name = String(msg.pushName ?? '').trim().slice(0, 40)
  if (name) return name
  const jid = msg.key?.participant ?? msg.key?.remoteJid ?? ''
  return jid.split(/[:@]/)[0] || 'anggota'
}

export async function handleMessagesUpdate(
  updates: BaileysEventMap['messages.update'],
  sock: WASocket | undefined,
): Promise<void> {
  if (!sock) return

  for (const update of updates) {
    if (update.update?.messageStubType !== WAMessageStubType.REVOKE) continue
    const chat = update.key?.remoteJid
    // Baileys puts the revoked message id on the outer key; the inner key is the revoke event itself
    const id = update.key?.id
    if (!chat?.endsWith('@g.us') || !id) continue

    const cfg = antideleteConfig(chat)
    if (!cfg.on) continue
    if (update.key.fromMe) continue

    const stored = messageStore.get(id)
    const msg = stored?.message
    if (!stored || !msg) continue
    if (stored.key?.fromMe) continue
    if (msg.protocolMessage || msg.reactionMessage) continue
    if (isViewOnce(stored)) continue
    if (cfg.since && Number(stored.messageTimestamp ?? 0) < cfg.since) continue
    if (alreadyRestored(id)) continue

    try {
      await sock.sendMessage(chat, { text: await tx('antideleteNotice', { who: who(stored) }) })
      await sock.sendMessage(chat, { forward: stored })
    } catch (err) {
      logger.warn('antidelete: restore failed', (err as Error)?.message ?? err)
    }
  }
}

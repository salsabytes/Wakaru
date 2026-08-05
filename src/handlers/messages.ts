import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../index.ts'
import { messageStore } from '../store.ts'

const textOf = (msg: WAMessage) =>
  msg.message?.conversation || msg.message?.extendedTextMessage?.text

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) messageStore.set(msg.key.id, msg)
  }

  if (upsert.type !== 'notify') return

  for (const msg of upsert.messages) {
    const text = textOf(msg)
    const jid = msg.key?.remoteJid
    if (!text || !jid) continue
    console.log(`${msg.key.fromMe ? '📤' : '📥'} ${jid}: ${text}`)
  }
}
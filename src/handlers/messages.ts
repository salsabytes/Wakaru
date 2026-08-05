import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../index.ts'
import { messageStore } from '../store.ts'
import { getCommand, PREFIX, listCommands } from '../commands/index.ts'
import { logger } from '../logger.ts'
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
    if (!text || !jid || msg.key?.fromMe) continue
    logger.info(`${msg.key.fromMe ? '📤' : '📥'} ${jid}: ${text}`)
    await maybeRunCommand(msg, text, jid)
  }
}

async function maybeRunCommand(msg: WAMessage, text: string, jid: string): Promise<void> {
  if (!text.startsWith(PREFIX)) return
  const [rawName, ...args] = text.slice(PREFIX.length).trim().split(/\s+/)
  const cmd = getCommand(rawName.toLowerCase())
  if (!cmd) return

  const ctx: CommandContext = {
    sock: waka,
    msg,
    prefix: PREFIX,
    args,
    text: text.slice(PREFIX.length + rawName.length).trim(),
    reply: async (replyText) => {
      await waka.sendMessage(jid, { text: replyText })
    },
    listCommands,
  }

  try {
    await cmd.run(ctx)
  } catch (err) {
    logger.error(`Command "${cmd.name}" error:`, err)
  }
}
import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../index.ts'
import { messageStore } from '../lib/store.ts'
import { getCommand, PREFIX, listCommands } from '../commands/index.ts'
import { serializeMessage, textOfMessage } from '../lib/simple.ts'
import { logger } from '../lib/logger.ts'
import { OWNERS, isOwner } from '../lib/config.ts'

const resolveJid = async (sender: string) => {
  if (!sender.endsWith('@lid') && !sender.endsWith('@hosted.lid')) return sender
  return (await waka.signalRepository.lidMapping.getPNForLID(sender)) ?? sender
}

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) messageStore.set(msg.key.id, msg)
  }

  if (upsert.type !== 'notify') return

  for (const msg of upsert.messages) {
    const text = textOfMessage(msg)
    const jid = msg.key?.remoteJid
    if (!text || !jid || msg.key?.fromMe) continue
    logger.info(`📥 ${jid}: ${text}`)
    await maybeRunCommand(msg, text, jid)
  }
}

async function maybeRunCommand(msg: WAMessage, text: string, jid: string): Promise<void> {
  if (!text.startsWith(PREFIX)) return
  const [rawName, ...args] = text.slice(PREFIX.length).trim().split(/\s+/)
  const cmd = getCommand(rawName.toLowerCase())
  if (!cmd) return

  const m = serializeMessage(waka, msg)
  const ctx: CommandContext = {
    sock: waka,
    prefix: PREFIX,
    args,
    text: text.slice(PREFIX.length + rawName.length).trim(),
    chat: m.chat,
    sender: await resolveJid(m.sender),
    isGroup: m.isGroup,
    fromMe: m.fromMe,
    mtype: m.mtype,
    download: m.download,
    quoted: m.quoted,
    reply: async (replyText) => {
      await waka.sendMessage(jid, { text: replyText })
    },
    react: async (emoji) => {
      await waka.sendMessage(jid, { react: { text: emoji, key: msg.key } })
    },
    sendSticker: async (buffer) => {
      await waka.sendMessage(jid, { sticker: buffer })
    },
    sendImage: async (buffer, caption) => {
      await waka.sendMessage(jid, { image: buffer, caption })
    },
    sendVideo: async (buffer, caption) => {
      await waka.sendMessage(jid, { video: buffer, caption })
    },
    listCommands,
  }

  try {

    if (cmd.ownerOnly && !isOwner(ctx.sender)) {
      await ctx.reply(!OWNERS.length ? 'no owners in config.json — owner commands disabled 🔒' : `owner only 🔒 (detected: ${ctx.sender.split(/[@:]/)[0]})`)
      return
    }
    await cmd.run(ctx)
  } catch (err) {
    logger.error(`Command "${cmd.name}" error:`, err)
    await ctx.reply(`❌ ${cmd.name} failed: ${(err as Error).message.slice(0, 300)}`)
  }
}
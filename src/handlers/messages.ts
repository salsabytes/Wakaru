import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../index.ts'
import { messageStore } from '../lib/store.ts'
import { getCommand, PREFIX } from '../commands/index.ts'
import { makeSender, serializeMessage, textOfMessage } from '../lib/simple.ts'
import { logger } from '../lib/logger.ts'
import { OWNERS, isOwner } from '../lib/config.ts'
import { aiHasHistory } from '../lib/aiHistory.ts'

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
  const m = serializeMessage(msg)
  const sender = await resolveJid(m.sender)

  let cmd: ReturnType<typeof getCommand> | undefined
  let queryText = text
  let args: string[] = []

  if (text.startsWith(PREFIX)) {
    const [rawName, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/)
    cmd = getCommand(rawName.toLowerCase())
    queryText = text.slice(PREFIX.length + rawName.length).trim()
    args = rest
  } else {
    // the AI also runs without a prefix: a reply to the bot, or a sender with an active AI chat, continues it
    const isReplyToBot =
      !!m.quoted?.sender &&
      !!waka.user?.id &&
      (await resolveJid(m.quoted.sender)).split(':')[0].split('@')[0] ===
        waka.user.id.split(':')[0].split('@')[0]
    if (!isReplyToBot && !aiHasHistory(`${m.chat}:${sender}`)) return
    if (!text.trim()) return
    cmd = getCommand('ai')
    queryText = text.trim()
    args = queryText.split(/\s+/)
  }
  if (!cmd) return

  const send = makeSender(waka, jid, msg)
  const ctx: CommandContext = {
    sock: waka,
    prefix: PREFIX,
    args,
    text: queryText,
    chat: m.chat,
    sender,
    pushName: msg.pushName ?? undefined,
    isGroup: m.isGroup,
    mtype: m.mtype,
    download: m.download,
    quoted: m.quoted,
    reply: send.text,
    react: (emoji) => send.react(emoji, msg.key),
    sendSticker: send.sticker,
    sendImage: send.image,
    sendVideo: send.video,
    sendAudio: send.audio,
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
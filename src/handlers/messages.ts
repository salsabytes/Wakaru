import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../socket.ts'
import { messageStore } from '../lib/store.ts'
import { getCommand, PREFIX } from '../commands/index.ts'
import { serializeMessage, type SerializedMessage } from '../lib/serialize.ts'
import { makeSender } from '../lib/sender.ts'
import { withSlot } from '../lib/queue.ts'
import { logger } from '../lib/logger.ts'
import { OWNERS, isOwner } from '../lib/config.ts'
import { aiHasHistory } from '../lib/aiHistory.ts'
import { pendingPlay, handlePlayPick } from '../commands/downloader/play.ts'

// every command runs concurrently (slot-capped globally) — no per-command flags,
// so a slow downloader never blocks other commands in the same chat
const dispatch = (msg: WAMessage, m: SerializedMessage, jid: string): void => {
  void maybeRunCommand(msg, m, jid).catch((err) => logger.error('command error:', err))
}

const lidCache = new Map<string, string>()
const resolveJid = async (sender: string) => {
  if (!sender.endsWith('@lid') && !sender.endsWith('@hosted.lid')) return sender
  const cached = lidCache.get(sender)
  if (cached) return cached
  const pn = await waka.signalRepository.lidMapping.getPNForLID(sender)
  if (pn) lidCache.set(sender, pn)
  return pn ?? sender
}

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) messageStore.set(msg.key.id, msg)
  }

  if (upsert.type !== 'notify') {

    for (const msg of upsert.messages) {
      const jid = msg.key?.remoteJid
      if (!jid || msg.key?.fromMe) continue
      const m = serializeMessage(msg)
      if (!m.button) continue
      logger.info(`🔘 ${jid} [append]: ${m.button.text || m.button.id}`)
      dispatch(msg, m, jid)
    }
    return
  }

  for (const msg of upsert.messages) {
    const jid = msg.key?.remoteJid
    if (!jid || msg.key?.fromMe) continue
    const m = serializeMessage(msg)

    if (!m.text && !m.button) continue
    logger.info(m.button ? `🔘 ${jid}: ${m.button.text || m.button.id}` : `📥 ${jid}: ${m.text}`)
    dispatch(msg, m, jid)
  }
}

async function maybeRunCommand(msg: WAMessage, m: SerializedMessage, jid: string): Promise<void> {
  const sender = await resolveJid(m.sender)
  const text = m.text
  const send = makeSender(waka, jid, msg)

  const pick = !text.startsWith(PREFIX) ? pendingPlay(m.chat, sender) : undefined
  if (pick) return handlePlayPick(msg, m, sender, send)

  if (m.button?.id.startsWith('play:')) {
    return send.text('pilihannya udah keburu basi 😅 ketik ulang `.play <judul>` dulu ya')
  }

  let cmd: ReturnType<typeof getCommand> | undefined
  let queryText = text
  let args: string[] = []

  if (text.startsWith(PREFIX)) {
    const [rawName, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/)
    cmd = getCommand(rawName.toLowerCase())
    queryText = text.slice(PREFIX.length + rawName.length).trim()
    args = rest
  } else {

    const isReplyToBot =
      !!m.quoted?.sender &&
      !!waka.user?.id &&
      (await resolveJid(m.quoted.sender)).split(':')[0].split('@')[0] ===
        waka.user.id.split(':')[0].split('@')[0]
    const isLink = /(?:https?:\/\/|www\.)/i.test(text)
    if (!isReplyToBot && !(isLink && aiHasHistory(`${m.chat}:${sender}`))) return
    if (!text.trim()) return
    cmd = getCommand('ai')
    queryText = text.trim()
    args = queryText.split(/\s+/)
  }
  if (!cmd) return

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
    button: m.button,
    quoted: m.quoted,
    reply: send.text,
    react: (emoji) => send.react(emoji, msg.key),
    sendSticker: send.sticker,
    sendImage: send.image,
    sendVideo: send.video,
    sendAudio: send.audio,
    sendButtons: (buttons, text, footer) => send.buttons(buttons, text, footer),
    sendList: (o) => send.list(o),
  }

  try {
    await withSlot(async () => {
      if (cmd.ownerOnly && !isOwner(ctx.sender)) {
        await ctx.reply(!OWNERS.length ? 'no owners in config.json — owner commands disabled 🔒' : `owner only 🔒 (detected: ${ctx.sender.split(/[@:]/)[0]})`)
        return
      }
      await cmd.run(ctx)
    })
  } catch (err) {
    logger.error(`Command "${cmd.name}" error:`, err)
    await ctx.reply(`❌ ${cmd.name} failed: ${String((err as Error)?.message ?? err).slice(0, 300)}`)
  }
}

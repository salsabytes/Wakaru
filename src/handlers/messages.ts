import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../socket.ts'
import { messageStore } from '../lib/store.ts'
import { getCommand, PREFIX } from '../commands/index.ts'
import { serializeMessage, type SerializedMessage } from '../lib/serialize.ts'
import { makeSender, type Sender } from '../lib/sender.ts'
import { withSlot, cooldownLeft } from '../lib/queue.ts'
import { logger } from '../lib/logger.ts'
import { t } from '../lib/lang.ts'
import { OWNERS, isOwner } from '../lib/config.ts'
import { aiHasHistory } from '../lib/aiHistory.ts'
import { pendingPlay, handlePlayPick } from '../commands/downloader/play.ts'

// commands run concurrently (globally slot-capped) so a slow downloader never blocks other chats
const dispatch = (msg: WAMessage, m: SerializedMessage, jid: string): void => {
  void maybeRunCommand(msg, m, jid).catch((err) => logger.error('command error:', err))
}

const lidCache = new Map<string, string>()
const resolveJid = async (jid: string) => {
  if (!jid.endsWith('@lid') && !jid.endsWith('@hosted.lid')) return jid
  const cached = lidCache.get(jid)
  if (cached) return cached
  const pn = await waka.signalRepository.lidMapping.getPNForLID(jid)
  if (pn) lidCache.set(jid, pn)
  return pn ?? jid
}

// LID→PN resolved once at the boundary; mentionedJid stays raw — WhatsApp sends mentions as-is
const serialize = async (msg: WAMessage): Promise<SerializedMessage> => {
  const m = serializeMessage(msg)
  m.sender = await resolveJid(m.sender)
  if (m.quoted?.sender) m.quoted.sender = await resolveJid(m.quoted.sender)
  return m
}

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) messageStore.set(msg.key.id, msg)
  }

  if (upsert.type !== 'notify') {

    for (const msg of upsert.messages) {
      const jid = msg.key?.remoteJid
      if (!jid || msg.key?.fromMe) continue
      const m = await serialize(msg)
      if (!m.button) continue
      logger.info(`🔘 ${jid} [append]: ${m.button.text || m.button.id}`)
      dispatch(msg, m, jid)
    }
    return
  }

  for (const msg of upsert.messages) {
    const jid = msg.key?.remoteJid
    if (!jid || msg.key?.fromMe) continue
    const m = await serialize(msg)

    if (!m.text && !m.button) continue
    logger.info(m.button ? `🔘 ${jid}: ${m.button.text || m.button.id}` : `📥 ${jid}: ${m.text}`)
    dispatch(msg, m, jid)
  }
}

type Parsed = { cmd: Awaited<ReturnType<typeof getCommand>>; queryText: string; args: string[] }

const parseCommand = async (m: SerializedMessage, sender: string, text: string): Promise<Parsed> => {
  if (text.startsWith(PREFIX)) {
    const [rawName, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/)
    return {
      cmd: await getCommand(rawName.toLowerCase()),
      queryText: text.slice(PREFIX.length + rawName.length).trim(),
      args: rest,
    }
  }
  const isReplyToBot =
    !!m.quoted?.sender &&
    !!waka.user?.id &&
    m.quoted.sender.split(':')[0].split('@')[0] === waka.user.id.split(':')[0].split('@')[0]
  const isLink = /(?:https?:\/\/|www\.)/i.test(text)
  const queryText = text.trim()
  if (!isReplyToBot && !(isLink && aiHasHistory(`${m.chat}:${sender}`))) return { cmd: undefined, queryText, args: [] }
  if (!queryText) return { cmd: undefined, queryText, args: [] }
  return { cmd: await getCommand('ai'), queryText, args: queryText.split(/\s+/) }
}

const blockedByCooldown = async (sender: string, cmd: Command, send: Sender): Promise<boolean> => {
  if (!cmd.cooldown || isOwner(sender)) return false
  const left = cooldownLeft(`${sender}:${cmd.name}`, cmd.cooldown)
  if (!left) return false
  await send.text(t('cooldown', { s: left }))
  return true
}

const blockedByOwner = async (ctx: CommandContext, cmd: Command): Promise<boolean> => {
  if (!cmd.ownerOnly || isOwner(ctx.sender)) return false
  await ctx.reply(t(!OWNERS.length ? 'noOwners' : 'ownerOnly', { who: ctx.sender.split(/[@:]/)[0] }))
  return true
}

async function maybeRunCommand(msg: WAMessage, m: SerializedMessage, jid: string): Promise<void> {
  const sender = m.sender
  const text = m.text
  const send = makeSender(waka, jid, msg)

  // only pick-shaped messages are consumed; anything else falls through below
  const pick = !text.startsWith(PREFIX) ? pendingPlay(m.chat, sender) : undefined
  if (pick && (await handlePlayPick(msg, m, sender, send))) return
  if (m.button?.id.startsWith('play:')) return send.text(t('stalePlay'))

  const { cmd, queryText, args } = await parseCommand(m, sender, text)
  if (!cmd) return
  if (await blockedByCooldown(sender, cmd, send)) return

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
    mentionedJid: m.mentionedJid,
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
      if (await blockedByOwner(ctx, cmd)) return
      await cmd.run(ctx)
    })
  } catch (err) {
    logger.error(`Command "${cmd.name}" error:`, err)
    await ctx.reply(t('cmdFailed', { name: cmd.name, msg: String((err as Error)?.message ?? err).slice(0, 300) }))
  }
}

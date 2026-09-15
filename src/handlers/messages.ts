import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../socket.ts'
import { messageStore } from '../lib/store.ts'
import { getCommand } from '../commands/index.ts'
import { serializeMessage, type SerializedMessage } from '../lib/serialize.ts'
import { makeSender, type Sender } from '../lib/sender.ts'
import { withSlot, cooldownLeft } from '../lib/queue.ts'
import { logger } from '../lib/logger.ts'
import { tx } from '../lib/lang.ts'
import { OWNERS, botBare, botMode, botPrefixes, isOwner, prefixBody, usedPrefix } from '../lib/config.ts'
import { aiHasHistory } from '../lib/aiHistory.ts'
import { pendingPlay, handlePlayPick } from '../commands/downloader/play.ts'
import { participantMaps } from '../lib/group.ts'

// commands run concurrently (globally slot-capped) so a slow downloader never blocks other chats
const dispatch = (msg: WAMessage, m: SerializedMessage, jid: string): void => {
  void maybeRunCommand(msg, m, jid).catch((err) => logger.error('command error:', err))
}

const lidCache = new Map<string, string>()
const LID_CACHE_MAX = 1000

const resolveJid = async (jid: string) => {
  if (!jid.endsWith('@lid') && !jid.endsWith('@hosted.lid')) return jid
  const cached = lidCache.get(jid)
  if (cached) return cached
  const pn = await waka.signalRepository.lidMapping.getPNForLID(jid)
  if (pn) {
    lidCache.set(jid, pn)
    if (lidCache.size > LID_CACHE_MAX) {
      lidCache.delete(lidCache.keys().next().value!)
    }
  }
  return pn ?? jid
}

// LID→PN resolved once at the boundary; mentionedJid stays raw — WhatsApp sends mentions as-is
const serialize = async (msg: WAMessage): Promise<SerializedMessage> => {
  const m = serializeMessage(msg)
  m.sender = await resolveJid(m.sender)
  if (m.quoted?.sender) m.quoted.sender = await resolveJid(m.quoted.sender)
  return m
}

// WA server backfills missed messages as fresh 'notify' upserts after reconnect —
// without an age check the AI answers hours-old chats. 90s grace absorbs clock jitter.
const isStale = (msg: WAMessage): boolean => {
  const ts = Number(msg.messageTimestamp ?? 0)
  return ts > 0 && Date.now() / 1000 - ts > 90
}

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) messageStore.set(msg.key.id, msg)
  }

  if (upsert.type !== 'notify') {

    for (const msg of upsert.messages) {
      const jid = msg.key?.remoteJid
      if (!jid || isStale(msg)) continue
      const m = await serialize(msg)
      if (m.fromMe && botMode() !== 'self') continue
      if (!m.button) continue
      logger.info(`🔘 ${jid} [append]: ${m.button.text || m.button.id}`)
      dispatch(msg, m, jid)
    }
    return
  }

  for (const msg of upsert.messages) {
    const jid = msg.key?.remoteJid
    if (!jid || isStale(msg)) continue
    const m = await serialize(msg)
    if (m.fromMe && botMode() !== 'self') continue

    if (!m.text && !m.button) continue
    logger.info(m.button ? `🔘 ${jid}: ${m.button.text || m.button.id}` : `📥 ${jid}: ${m.text}`)
    dispatch(msg, m, jid)
  }
}

type Parsed = { cmd: Awaited<ReturnType<typeof getCommand>>; queryText: string; args: string[] }

// second identical bare command within the window = deliberate, not chat
const BARE_WINDOW_MS = 60_000
const bareSeen = new Map<string, number>()

const aiFallback = async (m: SerializedMessage, sender: string, text: string): Promise<Parsed> => {
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

const parseCommand = async (m: SerializedMessage, sender: string, text: string): Promise<Parsed> => {
  const direct = prefixBody(text)
  if (direct !== undefined) {
    const [rawName, ...rest] = direct.split(/\s+/)
    if (!rawName) return { cmd: undefined, queryText: '', args: [] }
    const cmd = await getCommand(rawName.toLowerCase())
    if (cmd) {
      return {
        cmd,
        queryText: direct.slice(rawName.length).trim(),
        args: rest,
      }
    }
    // unknown word with a prefix (or bare attempt) — still let reply-to-bot and link follow-ups reach the AI
    if (botPrefixes().length) return aiFallback(m, sender, text)
  }
  const noPrefix = (direct ?? text).trim()
  const guess = noPrefix.split(/\s+/)[0]?.toLowerCase() ?? ''
  const bareCmd = await getCommand(guess)
  if (bareCmd) {
    const key = `${sender}:${bareCmd.name}`
    const now = Date.now()
    if (bareSeen.size > 2000) bareSeen.clear()
    const last = bareSeen.get(key) ?? 0
    bareSeen.set(key, now)
    // prefixes only: same bare command twice in a row = deliberate, once = chat.
    // bare on (flag or empty list): fire right away — the owner asked for it.
    if (!botBare() && botPrefixes().length && now - last > BARE_WINDOW_MS) return aiFallback(m, sender, text)
    const after = noPrefix.slice(guess.length).trim()
    return { cmd: bareCmd, queryText: after, args: after ? after.split(/\s+/) : [] }
  }
  return aiFallback(m, sender, text)
}

const blockedByCooldown = async (sender: string, cmd: Command, send: Sender): Promise<boolean> => {
  if (!cmd.cooldown || isOwner(sender)) return false
  const left = cooldownLeft(`${sender}:${cmd.name}`, cmd.cooldown)
  if (!left) return false
  await send.text(await tx('cooldown', { s: left }))
  return true
}

// unknown-to-users owner commands fail silent; empty owners = setup hint stays visible
const blockedByOwner = async (ctx: CommandContext, cmd: Command): Promise<boolean> => {
  if (!cmd.ownerOnly || isOwner(ctx.sender)) return false
  if (!OWNERS.length) await ctx.reply(await tx('noOwners'))
  return true
}

async function maybeRunCommand(msg: WAMessage, m: SerializedMessage, jid: string): Promise<void> {
  const sender = m.sender
  const text = m.text
  const send = makeSender(waka, jid, msg)

  // only pick-shaped messages are consumed; anything else falls through below
  const pick = !usedPrefix(text) ? pendingPlay(m.chat, sender) : undefined
  if (pick && (await handlePlayPick(msg, m, sender, send))) return
  if (m.button?.id.startsWith('play:')) return send.text(await tx('stalePlay'))

  const { cmd, queryText, args } = await parseCommand(m, sender, text)
  if (!cmd) return
  if (await blockedByCooldown(sender, cmd, send)) return
  const mode = botMode()
  if (mode !== 'public' && !m.fromMe && !isOwner(sender)) return

  let isAdmin = false
  let isBotAdmin = false
  if (m.isGroup) {
    const met = await waka.groupMetadata(m.chat).catch(() => undefined)
    if (met) {
      const { byPart } = participantMaps(met)
      isAdmin = !!byPart.get(sender.split(/[@:]/)[0])?.admin
      const botNum = waka.user?.id?.split(':')[0].split('@')[0]
      isBotAdmin = !!botNum && !!byPart.get(botNum)?.admin
    }
  }

  const ctx: CommandContext = {
    sock: waka,
    prefix: botPrefixes()[0] ?? '',
    args,
    text: queryText,
    chat: m.chat,
    sender,
    pushName: msg.pushName ?? undefined,
    isGroup: m.isGroup,
    isAdmin,
    isBotAdmin,
    isOwner: isOwner(sender),
    mtype: m.mtype,
    mimetype: m.mimetype,
    mentionedJid: m.mentionedJid,
    download: m.download,
    button: m.button,
    quoted: m.quoted,
    reply: send.text,
    react: (emoji) => send.react(emoji, msg.key),
    fromMe: m.fromMe,
    sendSticker: send.sticker,
    sendImage: send.image,
    sendVideo: send.video,
    sendGif: send.gif,
    sendAudio: send.audio,
    sendDocument: send.document,
    sendButtons: (buttons, text, footer) => send.buttons(buttons, text, footer),
    sendList: (o) => send.list(o),
  }

  try {
    await withSlot(async () => {
      if (cmd.groupOnly && !ctx.isGroup) return ctx.reply(await tx('groupOnly'))
      if (cmd.adminOnly && !ctx.isOwner && !ctx.isAdmin) return ctx.reply(await tx('kickAdminOnly'))
      if (cmd.botAdmin && !ctx.isBotAdmin) return ctx.reply(await tx('kickBotNotAdmin'))
      if (await blockedByOwner(ctx, cmd)) return
      await cmd.run(ctx)
    })
  } catch (err) {
    logger.error(`Command "${cmd.name}" error:`, err)
    await ctx.reply(await tx('cmdFailed', { name: cmd.name, msg: String((err as Error)?.message ?? err).slice(0, 300) }))
  }
}

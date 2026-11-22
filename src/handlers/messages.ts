import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../socket.ts'
import { messageStore } from '../lib/wa/store.ts'
import { getCommand } from '../commands/index.ts'
import { serializeMessage, type SerializedMessage } from '../lib/wa/serialize.ts'
import { makeSender, type Sender } from '../lib/wa/sender.ts'
import { withSlot, cooldownLeft } from '../lib/queue.ts'
import { logger } from '../lib/logger.ts'
import { tx } from '../lib/lang.ts'
import { OWNERS, botBare, botMode, botPrefixes, isOwner, prefixBody, usedPrefix } from '../lib/config.ts'
import { aiHasHistory } from '../lib/ai/aiHistory.ts'
import { rememberAiMedia } from '../lib/ai/aiMediaMemory.ts'
import { pendingPlay, handlePlayPick, parsePick } from '../lib/play.ts'
import { pendingF100, handleF100Answer } from '../lib/f100.ts'
import { handleAntilinkMaxInput } from '../commands/group/antilink.ts'
import { participantMaps } from '../lib/wa/group.ts'
import { resolveJid, resolveLid } from '../lib/wa/lid.ts'
import { addAntilinkWarn, antilinkConfig, autodlConfig, resetAntilinkWarns } from '../lib/wa/groupSettings.ts'
import { clearAfk, getAfk, setAfk, shouldNotifyAfk } from '../lib/afk.ts'
import { formatDuration } from '../lib/time.ts'
import { maybeAutoDownload } from '../lib/autodl.ts'

// commands run concurrently (globally slot-capped) so a slow downloader never blocks other chats
const dispatch = (msg: WAMessage, m: SerializedMessage, jid: string): void => {
  void maybeRunCommand(msg, m, jid).catch((err) => logger.error('command error:', err))
}

const LINK_RE = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/)/i

const adminNums = async (chat: string): Promise<Set<string> | undefined> => {
  const met = await waka.groupMetadata(chat).catch(() => undefined)
  if (!met) return undefined
  const { byPart } = participantMaps(met)
  const out = new Set<string>()
  for (const [num, p] of byPart) if (p.admin) out.add(num)
  return out
}

const checkAntilink = async (msg: WAMessage, m: SerializedMessage, jid: string): Promise<boolean> => {
  if (!m.isGroup) return false
  // never police the bot's own account (its own replies / owner typing from the
  // linked phone). Missing this deleted the bot's own link-laden replies.
  if (msg.key?.fromMe || m.fromMe) return false
  const cfg = antilinkConfig(m.chat)
  if (!cfg.on) return false
  if (isOwner(m.sender)) return false
  if (!m.text || !LINK_RE.test(m.text)) return false
  // admins and the bot are immune
  const botNum = waka.user?.id?.split(':')[0].split('@')[0]
  const senderNum = m.sender.split(/[@:]/)[0]
  if (botNum && senderNum === botNum) return false
  const admins = await adminNums(m.chat)
  if (admins?.has(senderNum)) return false

  try {
    await waka.sendMessage(m.chat, { delete: msg.key as any })
  } catch (e) {
    logger.warn('antilink: delete failed (bot not admin?)', e)
  }
  // delete silently. replying would surface the link again
  // kick is per group. off = delete only
  if (!cfg.kick) return true
  const strikes = addAntilinkWarn(m.chat, senderNum)
  if (strikes >= cfg.maxWarn) {
    try {
      await waka.groupParticipantsUpdate(m.chat, [m.sender], 'remove')
      resetAntilinkWarns(m.chat, senderNum)
    } catch (e) {
      logger.warn('antilink: kick failed (bot not admin?)', e)
    }
  }
  return true
}

// Every JID is resolved once at the boundary so no @lid leaks into commands.
const serialize = async (msg: WAMessage): Promise<SerializedMessage> => {
  const m = serializeMessage(msg)
  const chat = msg.key?.remoteJid
  m.sender = await resolveLid(waka, m.sender, msg.key?.participantAlt, chat)
  m.chat = await resolveLid(waka, m.chat, msg.key?.remoteJidAlt)
  m.mentionedJid = await Promise.all((m.mentionedJid ?? []).map((j) => resolveLid(waka, j, undefined, chat)))
  if (m.quoted) {
    m.quoted.sender = await resolveLid(waka, m.quoted.sender, undefined, chat)
    m.quoted.chat = await resolveLid(waka, m.quoted.chat)
  }
  // own group messages arrive with a @lid participant when the LID mapping is
  // cold, so fromMe=false slipped past the filter and antilink removed them.
  if (!m.fromMe && m.isGroup && waka.user?.id) {
    const botNum = waka.user.id.split(':')[0].split('@')[0]
    if (m.sender.split(/[@:]/)[0] === botNum) m.fromMe = true
  }
  return m
}

// WA server backfills missed messages as fresh 'notify' upserts after reconnect â€”
// without an age check the AI answers hours-old chats. 90s grace absorbs clock jitter.
const isStale = (msg: WAMessage): boolean => {
  const ts = Number(msg.messageTimestamp ?? 0)
  return ts > 0 && Date.now() / 1000 - ts > 90
}

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) {
      const chat = await resolveLid(waka, msg.key.remoteJid ?? '', msg.key.remoteJidAlt)
      messageStore.set(msg.key.id, msg, chat)
    }
  }

  if (upsert.type !== 'notify') {

    for (const msg of upsert.messages) {
      const jid = msg.key?.remoteJid
      if (!jid || isStale(msg)) continue
      const m = await serialize(msg)
      // Notify upsert = incoming messages only, so fromMe=true here is always the Baileys LID bug
      if (m.fromMe && !m.isGroup) {
        const botId = waka?.user?.id
        if (botId && m.sender.split(':')[0] !== botId.split(':')[0]) {
          m.fromMe = false
        }
      }
      if (m.fromMe && !isOwner(m.sender) && botMode() !== 'self') continue
      if (await checkAntilink(msg, m, m.chat)) continue
      if (!m.button) continue
      logger.info(`ðŸ”˜ ${m.chat} [append]: ${m.button.text || m.button.id}`)
      dispatch(msg, m, m.chat)
    }
    return
  }

  for (const msg of upsert.messages) {
    const jid = msg.key?.remoteJid
    if (!jid || isStale(msg)) continue
    const m = await serialize(msg)
    if (m.fromMe && !isOwner(m.sender) && botMode() !== 'self') continue

    const sender = m.fromMe ? (waka.user?.id ?? m.sender) : m.sender
    // Media-only message (no text/button): stash it so `.ai` can use it later
    if (!m.text && !m.button) {
      void rememberAiMedia(m, sender).catch((err) => logger.warn('ai media remember error:', err))
      // Silent stashing looks like "documents aren't supported".
      // Confirm receipt for documents sent in DMs.
      if (!m.isGroup && m.mtype === 'documentMessage') {
        const name = m.fileName || 'file'
        const prefix = botPrefixes()[0] ?? '.'
        void (async () => {
          await makeSender(waka, m.chat, msg).text(await tx('docReceived', { name, prefix }))
        })().catch(() => {})
      }
      continue
    }
    if (await checkAntilink(msg, m, m.chat)) continue
    logger.info(m.button ? `ðŸ”˜ ${m.chat}: ${m.button.text || m.button.id}` : `ðŸ’¬ ${m.chat}: ${m.text}`)
    dispatch(msg, m, m.chat)
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
  // A caption on a document ("baca ini") is meant for the AI even without a prefix.
  const hasDoc = m.mtype === 'documentMessage'
  const queryText = text.trim()
  const hasPendingPlay = !!pendingPlay(m.chat, sender)
  if (hasPendingPlay && (isReplyToBot || !!parsePick(queryText) || /^(batal|cancel|gajadi|gak jadi|nggak jadi)$/i.test(queryText))) {
    return { cmd: undefined, queryText, args: [] }
  }
  if (!isReplyToBot && !hasDoc && !(isLink && aiHasHistory(`${m.chat}:${sender}`))) return { cmd: undefined, queryText, args: [] }
  if (!queryText) return { cmd: undefined, queryText, args: [] }
  return { cmd: await getCommand('ai'), queryText, args: queryText.split(/\s+/) }
}

const parseCommand = async (m: SerializedMessage, sender: string, text: string): Promise<Parsed> => {
  // tolerate a leading punctuation the user *thinks* is the prefix (".ai", "!play")
  // so a configured prefix like "w" doesn't make the command silently vanish
  const cmdName = (token: string): string => token.replace(/^[^a-z0-9_]+/i, '').toLowerCase()
  // button taps go back to the command that owns them
  const bid = m.button?.id
  if (bid?.startsWith('antilink:')) {
    const parts = bid.slice('antilink:'.length).split(':').filter(Boolean)
    return { cmd: await getCommand('antilink'), queryText: parts.join(' '), args: parts }
  }
  if (bid?.startsWith('antidelete:')) {
    const parts = bid.slice('antidelete:'.length).split(':').filter(Boolean)
    return { cmd: await getCommand('antidelete'), queryText: parts.join(' '), args: parts }
  }
  if (bid?.startsWith('welcome:')) {
    const parts = bid.slice('welcome:'.length).split(':').filter(Boolean)
    return { cmd: await getCommand('welcome'), queryText: parts.join(' '), args: parts }
  }
  if (bid?.startsWith('goodbye:')) {
    const parts = bid.slice('goodbye:'.length).split(':').filter(Boolean)
    return { cmd: await getCommand('goodbye'), queryText: parts.join(' '), args: parts }
  }
  const direct = prefixBody(text)
  if (direct !== undefined) {
    const [rawName, ...rest] = direct.split(/\s+/)
    if (!rawName) return { cmd: undefined, queryText: '', args: [] }
    const cmd = await getCommand(cmdName(rawName))
    if (cmd) {
      return {
        cmd,
        queryText: direct.slice(rawName.length).trim(),
        args: rest,
      }
    }
    // Unknown word with a prefix (or bare attempt) â€” still let reply-to-bot and
    // link follow-ups reach the AI.
    if (botPrefixes().length) return aiFallback(m, sender, text)
  }
  const noPrefix = (direct ?? text).trim()
  const guess = noPrefix.split(/\s+/)[0]?.toLowerCase() ?? ''
  // someone typed ".ai"/"!play": an explicit punctuation prefix, not a bare word
  const punctPrefixed = guess !== cmdName(guess)
  const bareCmd = await getCommand(cmdName(guess))
  if (bareCmd) {
    const key = `${sender}:${bareCmd.name}`
    const now = Date.now()
    if (bareSeen.size > 2000) bareSeen.clear()
    const last = bareSeen.get(key) ?? 0
    bareSeen.set(key, now)
    // prefixes only: same bare command twice in a row = deliberate, once = chat.
    // bare on (flag or empty list) or a punctuation prefix: fire right away.
    if (!punctPrefixed && !botBare() && botPrefixes().length && now - last > BARE_WINDOW_MS) {
      return aiFallback(m, sender, text)
    }
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

// Build a minimal CommandContext for non-command flows (e.g. autodl).
const ctxFallback = (text: string, m: SerializedMessage, sender: string, msg: WAMessage, send: Sender): CommandContext => ({
  sock: waka,
  prefix: botPrefixes()[0] ?? '',
  args: [],
  text,
  chat: m.chat,
  sender,
  pushName: m.pushName ?? msg.pushName ?? undefined,
  isGroup: m.isGroup,
  isAdmin: false,
  isBotAdmin: false,
  isOwner: isOwner(sender),
  mtype: m.mtype,
  mimetype: m.mimetype,
  fileName: m.fileName,
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
})

async function maybeRunCommand(msg: WAMessage, m: SerializedMessage, jid: string): Promise<void> {
  // When fromMe=true, sender is the chat partner's JID (not the bot's), so isOwner fails
  const sender = m.fromMe ? (waka.user?.id ?? m.sender) : m.sender
  const text = m.text
  const send = makeSender(waka, jid, msg)

  // only active play sessions/buttons are consumed; plain "1" with no session falls through
  const playBtn = !!m.button?.id?.startsWith('play:')
  const pick = !usedPrefix(text) ? pendingPlay(m.chat, sender) : undefined
  if (pick || playBtn) {
    try {
      if (await handlePlayPick(msg, m, sender, send)) return
    } catch (err) {
      logger.error('play handler error:', err)
      return send.text(await tx('playFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  }

  if (pendingF100(m.chat) && !m.fromMe && !usedPrefix(text) && text.trim()) {
    if (await handleF100Answer({ sock: waka, chat: m.chat, reply: send.text, msgKey: msg.key }, sender, text, m.pushName ?? msg.pushName ?? undefined)) return
  }

    // "max warn" input: eat the next text from the admin who tapped
  if (!m.fromMe && text.trim() && !usedPrefix(text)) {
    if (await handleAntilinkMaxInput(m.chat, sender, text, send)) return
  }

  // Clear own AFK on any real activity.
  if (!m.fromMe && text.trim()) {
    const mine = getAfk(sender)
    if (mine) {
      clearAfk(sender)
      await send.text(`Welcome back${msg.pushName ? `, ${msg.pushName}` : ''}! AFK ${formatDuration(Date.now() - mine.since)}${mine.reason ? `: ${mine.reason}` : ''}`)
    }
  }

  // Notify if someone mentions/replies to an AFK user. contextInfo.mentionedJid
  // is sometimes empty in LID groups, so also read the @number out of the text.
  const textMentions = [...text.matchAll(/@(\d{5,})/g)].map((x) => `${x[1]}@s.whatsapp.net`)
  const targets = new Set<string>([
    ...(m.mentionedJid || []),
    ...(m.quoted?.sender ? [m.quoted.sender] : []),
    ...textMentions,
  ])
  let afkMeta: Awaited<ReturnType<typeof waka.groupMetadata>> | undefined
  let afkMetaLoaded = false
  for (const raw of targets) {
    // AFK may have been stored under the PN or the LID, so try every id.
    let key = await resolveJid(waka, raw, m.chat)
    let info = getAfk(key)
    if (!info && m.isGroup) {
      if (!afkMetaLoaded) {
        afkMeta = await waka.groupMetadata(m.chat).catch(() => undefined)
        afkMetaLoaded = true
      }
      if (afkMeta) {
        const p = participantMaps(afkMeta).byPart.get(raw.split(/[:@]/)[0])
        for (const id of p ? [p.id, p.phoneNumber, p.lid] : []) {
          if (!id) continue
          const found = getAfk(id)
          if (found) {
            info = found
            key = id
            break
          }
        }
      }
    }
    if (!info || key === sender || !shouldNotifyAfk(m.chat, key)) continue
    const who = (await resolveJid(waka, key, m.chat)).split(/[:@]/)[0]
    await send.text(`@${who} lagi AFK (${formatDuration(Date.now() - info.since)})${info.reason ? `: ${info.reason}` : ''}`)
  }

  const { cmd, queryText, args } = await parseCommand(m, sender, text)
  if (!cmd) {
    if (!m.fromMe && !m.button && autodlConfig(m.chat).on && text.trim() && !usedPrefix(text)) {
      await maybeAutoDownload(ctxFallback(text, m, sender, msg, send))
    }
    return
  }
  if (await blockedByCooldown(sender, cmd, send)) return
  const mode = botMode()
  // DMs are inherently targeted at the bot, mode filter should ONLY apply in groups
  if (m.isGroup && mode !== 'public' && !m.fromMe && !isOwner(sender)) return

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
  pushName: m.pushName ?? msg.pushName ?? undefined,
    isGroup: m.isGroup,
    isAdmin,
    isBotAdmin,
    isOwner: isOwner(sender),
    mtype: m.mtype,
    mimetype: m.mimetype,
    fileName: m.fileName,
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

import type { BaileysEventMap, WAMessage } from 'baileys'
import { waka } from '../index.ts'
import { messageStore } from '../lib/store.ts'
import { getCommand, PREFIX } from '../commands/index.ts'
import { makeSender, serializeMessage, type SerializedMessage } from '../lib/simple.ts'
import { logger } from '../lib/logger.ts'
import { OWNERS, isOwner } from '../lib/config.ts'
import { aiHasHistory } from '../lib/aiHistory.ts'

// LID → PN mapping barely changes within a session; cache it (misses are not cached, retried next msg)
const lidCache = new Map<string, string>()
const resolveJid = async (sender: string) => {
  if (!sender.endsWith('@lid') && !sender.endsWith('@hosted.lid')) return sender
  const cached = lidCache.get(sender)
  if (cached) return cached
  const pn = await waka.signalRepository.lidMapping.getPNForLID(sender)
  if (pn) lidCache.set(sender, pn)
  return pn ?? sender
}

// per-chat serial queue: preserves reply order within a chat, chats run in parallel
const chatQueues = new Map<string, Promise<void>>()
function enqueueChat(chat: string, task: () => Promise<void>): void {
  const prev = chatQueues.get(chat) ?? Promise.resolve()
  const next = prev.then(task).catch((err) => logger.error('queue task error:', err))
  chatQueues.set(chat, next)
  void next.finally(() => {
    if (chatQueues.get(chat) === next) chatQueues.delete(chat)
  })
}

// global concurrency caps — heavy commands (media downloads) buffer whole files in RAM;
// 3 light (chat, menu, sticker) or 2 heavy at once keeps a low-end phone safe
// ponytail: two independent pools (max 5 total); tighten light to 2 if the device struggles
const SLOT_LIMITS = { light: 3, heavy: 2 } as const
const running = { light: 0, heavy: 0 }
const waiters: (() => void)[] = []
async function withSlot(weight: 'light' | 'heavy', fn: () => Promise<void>): Promise<void> {
  while (running[weight] >= SLOT_LIMITS[weight]) {
    await new Promise<void>((r) => waiters.push(r))
  }
  running[weight]++
  try {
    await fn()
  } finally {
    running[weight]--
    waiters.shift()?.()
  }
}

export async function handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert']): Promise<void> {
  for (const msg of upsert.messages) {
    if (msg.key?.id) messageStore.set(msg.key.id, msg)
  }

  if (upsert.type !== 'notify') return

  for (const msg of upsert.messages) {
    const jid = msg.key?.remoteJid
    if (!jid || msg.key?.fromMe) continue
    const m = serializeMessage(msg)
    if (!m.text) continue
    logger.info(`📥 ${jid}: ${m.text}`)
    enqueueChat(jid, () => maybeRunCommand(msg, m, jid))
  }
}

async function maybeRunCommand(msg: WAMessage, m: SerializedMessage, jid: string): Promise<void> {
  const sender = await resolveJid(m.sender)
  const text = m.text

  let cmd: ReturnType<typeof getCommand> | undefined
  let queryText = text
  let args: string[] = []

  if (text.startsWith(PREFIX)) {
    const [rawName, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/)
    cmd = getCommand(rawName.toLowerCase())
    queryText = text.slice(PREFIX.length + rawName.length).trim()
    args = rest
  } else {
    // prefix-less AI: bot replies or follow-up links from an active AI chat continue it
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
    await withSlot(cmd.heavy ? 'heavy' : 'light', async () => {
      if (cmd.ownerOnly && !isOwner(ctx.sender)) {
        await ctx.reply(!OWNERS.length ? 'no owners in config.json — owner commands disabled 🔒' : `owner only 🔒 (detected: ${ctx.sender.split(/[@:]/)[0]})`)
        return
      }
      await cmd.run(ctx)
    })
  } catch (err) {
    logger.error(`Command "${cmd.name}" error:`, err)
    await ctx.reply(`❌ ${cmd.name} failed: ${(err as Error).message.slice(0, 300)}`)
  }
}
import type { WAMessage, WAMessageKey, WASocket } from 'baileys'
import { downloadMediaMessage } from 'baileys'

export interface MediaMeta {
  mtype: string
  chat: string
  sender: string
  text: string
  download: () => Promise<Buffer>
}

export interface SerializedMessage {
  chat: string
  sender: string
  isGroup: boolean
  mtype: string
  text: string
  download: () => Promise<Buffer>
  quoted?: MediaMeta
}

const bodyOf = (msg: WAMessage): [string, any] => {
  const mtype = msg.message ? Object.keys(msg.message)[0] : ''
  return [mtype, (msg.message as any)?.[mtype] ?? {}]
}

export const textOfMessage = (msg: WAMessage): string => {
  const [, content] = bodyOf(msg)
  return content.text || content.caption || msg.message?.conversation || ''
}

export const makeSender = (sock: WASocket, chat: string, quoted?: WAMessage) => {
  const opts = quoted ? { quoted } : undefined
  const send = (content: Parameters<typeof sock.sendMessage>[1]) => sock.sendMessage(chat, content, opts)
  return {
    text: async (text: string) => { await send({ text }) },
    react: async (emoji: string, key?: WAMessageKey) => { await sock.sendMessage(chat, { react: { text: emoji, key } }) },
    sticker: async (buffer: Buffer) => { await send({ sticker: buffer }) },
    image: async (buffer: Buffer, caption?: string) => { await send({ image: buffer, caption }) },
    video: async (buffer: Buffer, caption?: string) => { await send({ video: buffer, caption }) },
    audio: async (buffer: Buffer) => { await send({ audio: buffer, mimetype: 'audio/mpeg' }) },
  }
}

// shared opener for link-based commands: replies usage when empty, reacts ⏳ when it has a link
const requireUrl = async (ctx: CommandContext, name: string, usage: string): Promise<string | undefined> => {
  const url = ctx.text.trim()
  if (!url) {
    await ctx.reply(`usage: ${ctx.prefix}${name} ${usage}`)
    return undefined
  }
  await ctx.react('⏳')
  return url
}

export { requireUrl }

export function serializeMessage(msg: WAMessage): SerializedMessage {
  const chat = msg.key?.remoteJid ?? ''
  const sender = msg.key?.participant || chat
  const [mtype, content] = bodyOf(msg)
  const text = textOfMessage(msg)


  const download = () => downloadMediaMessage(msg, 'buffer', {}) as unknown as Promise<Buffer>

  const s: SerializedMessage = {
    chat,
    sender,
    isGroup: chat.endsWith('@g.us'),
    mtype,
    text,
    download,
  }

  const ctxt = content.contextInfo
  const q = ctxt?.quotedMessage
  if (q) {
    const qtype = Object.keys(q)[0]
    const qc = (q as any)?.[qtype] ?? {}
    s.quoted = {
      mtype: qtype,
      chat: ctxt.remoteJid ?? chat,
      sender: ctxt.participant ?? '',
      text: qc.text || qc.caption || '',
      download: () =>
        downloadMediaMessage(
          {
            key: { id: ctxt.stanzaId, remoteJid: ctxt.remoteJid, participant: ctxt.participant },
            message: q,
          } as WAMessage,
          'buffer',
          {},
        ) as unknown as Promise<Buffer>,
    }
  }

  return s
}
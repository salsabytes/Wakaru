import type { WAMessage, WAMessageKey, WASocket } from 'baileys'
import { sendButtons, sendList, type Button, type ListContent } from './buttons.ts'

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
    buttons: async (buttons: Button[], text: string, footer?: string) => { await sendButtons(sock, chat, { text, footer, buttons }) },
    list: async (o: ListContent) => { await sendList(sock, chat, o) },
  }
}

export type Sender = ReturnType<typeof makeSender>

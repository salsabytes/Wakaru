import type { WASocket } from 'baileys'
import type { MediaMeta } from '../lib/simple.ts'

declare global {
  interface Command {
    name: string
    desc?: string
    aliases?: string[]
    ownerOnly?: boolean
    run: (ctx: CommandContext) => Promise<void> | void
  }


  interface CommandContext {
    sock: WASocket
    prefix: string
    args: string[]
    text: string
    chat: string
    sender: string
    isGroup: boolean
    fromMe: boolean
    mtype: string
    download: () => Promise<Buffer>
    quoted?: MediaMeta
    reply: (text: string) => Promise<void>
    react: (emoji: string) => Promise<void>
    sendSticker: (buffer: Buffer) => Promise<void>
    sendImage: (buffer: Buffer, caption?: string) => Promise<void>
    sendVideo: (buffer: Buffer, caption?: string) => Promise<void>
    listCommands: () => { name: string; category: string; desc?: string }[]
  }
}

export {}
import type { WASocket } from 'baileys'
import type { MediaMeta } from '../lib/serialize.ts'
import type { ListContent } from '../lib/buttons.ts'

declare global {
  interface Command {
    name: string
    desc?: string
    aliases?: string[]
    ownerOnly?: boolean
    cooldown?: number // per-user cooldown in seconds (heavy commands)

    run: (ctx: CommandContext) => Promise<void> | void
  }

  interface CommandContext {
    sock: WASocket
    prefix: string
    args: string[]
    text: string
    chat: string
    sender: string
    pushName?: string
    isGroup: boolean
    mtype: string
    download: () => Promise<Buffer>

    button?: { id: string; text: string }
    quoted?: MediaMeta
    reply: (text: string) => Promise<void>
    react: (emoji: string) => Promise<void>
    sendSticker: (buffer: Buffer) => Promise<void>
    sendImage: (buffer: Buffer, caption?: string) => Promise<void>
    sendVideo: (buffer: Buffer, caption?: string) => Promise<void>
    sendAudio: (buffer: Buffer, title?: string) => Promise<void>

    sendButtons: (buttons: { id: string; text: string }[], text: string, footer?: string) => Promise<void>

    sendList: (o: ListContent) => Promise<void>
  }
}

export {}
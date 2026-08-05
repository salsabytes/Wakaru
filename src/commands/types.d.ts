import type { WAMessage, WASocket } from 'baileys'

declare global {
  interface Command {
    name: string
    desc?: string
    aliases?: string[]
    run: (ctx: CommandContext) => Promise<void> | void
  }

  interface CommandContext {
    sock: WASocket
    msg: WAMessage
    prefix: string
    args: string[]
    text: string
    reply: (text: string) => Promise<void>
    listCommands: () => { name: string; category: string; desc?: string }[]
  }
}

export {}
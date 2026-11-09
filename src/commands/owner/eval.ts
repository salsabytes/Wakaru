import { inspect } from 'node:util'
import { getCommand } from '../index.ts'
import { wakafy } from '../../lib/wakafy.ts'
import { fetchBuffer, UA } from '../../lib/http.ts'
import { sendHtml, sendRichParts } from '../../lib/richmsg.ts'
import { sendCarousel, sendButtons } from '../../lib/buttons.ts'
import { sendMediaOrCarousel } from '../../lib/media.ts'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>

const fmt = (v: unknown): string => {
  if (typeof v === 'string') return v
  return inspect(v, { depth: 4, colors: false, maxArrayLength: 50, breakLength: 100 })
}

export default {
  name: 'eval',
  desc: 'evaluate code (owner only)',
  aliases: ['ev', '>'],
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const code = ctx.text.trim()
    if (!code) return ctx.reply('usage: .eval <code>')

    // run another command with optional text, reusing the current context
    const cmd = async (name: string, text = '') => {
      const c = await getCommand(name)
      if (!c) throw new Error(`unknown command: ${name}`)
      return c.run({ ...ctx, text, args: text.trim() ? text.trim().split(/\s+/) : [] })
    }

    try {
      const fn = new AsyncFunction(
        'ctx', 'sock', 'chat', 'sender', 'reply', 'cmd', 'getCommand',
        'wakafy', 'fetchBuffer', 'UA', 'sendHtml', 'sendRichParts', 'sendCarousel', 'sendButtons', 'sendMediaOrCarousel',
        'require', 'process', 'Buffer', 'console', 'fetch', 'URL',
        `"use strict"; return (async () => {\n${code}\n})()`,
      )
      const out = await fn(
        ctx, ctx.sock, ctx.chat, ctx.sender, ctx.reply, cmd, getCommand,
        wakafy, fetchBuffer, UA, sendHtml, sendRichParts, sendCarousel, sendButtons, sendMediaOrCarousel,
        undefined, process, Buffer, console, fetch, URL,
      )
      const text = fmt(out)
      if (text && text !== 'undefined') await ctx.reply(text.slice(0, 4000))
    } catch (err) {
      await ctx.reply(`error: ${fmt(err).slice(0, 4000)}`)
    }
  },
} satisfies Command

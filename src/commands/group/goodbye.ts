import { DEFAULT_GOODBYE, goodbyeConfig, setGoodbye, toggleGoodbye } from '../../lib/wa/groupSettings.ts'
import type { Button } from '../../lib/wa/buttons.ts'
import { tx } from '../../lib/lang.ts'

const onOff = (w: string): boolean | undefined =>
  w === 'on' || w === 'enable' || w === '1' ? true : w === 'off' || w === 'disable' || w === '0' ? false : undefined

const panel = async (chat: string, prefix: string): Promise<{ text: string; buttons: Button[] }> => {
  const c = goodbyeConfig(chat)
  const text = [
    await tx('goodbyeTitle'),
    '',
    await tx('statusLine', { status: await tx(c.on ? 'toggleOn' : 'toggleOff') }),
    await tx('templateLine', { template: c.msg }),
    '',
    await tx('welcomePlaceholders'),
    await tx('goodbyeHint', { prefix }),
  ].join('\n')
  return {
    text,
    buttons: [{ id: 'goodbye:toggle', text: await tx(c.on ? 'disableButton' : 'enableButton') }],
  }
}

const sendPanel = async (ctx: CommandContext): Promise<void> => {
  const { text, buttons } = await panel(ctx.chat, ctx.prefix)
  try {
    await ctx.sendButtons(buttons, text)
  } catch {
    await ctx.reply(text)
  }
}

export default {
  name: 'goodbye',
  desc: 'set pesan goodbye grup (kirim pp + teks). placeholder: `pp` `mention` `desc` `gcname`',
  aliases: ['leave'],
  groupOnly: true,
  adminOnly: true,
  run: async (ctx: CommandContext) => {
    const raw = ctx.text.trim()
    const sub = raw.toLowerCase()

    if (sub === 'reset') {
      setGoodbye(ctx.chat, DEFAULT_GOODBYE)
      return ctx.reply(await tx('goodbyeReset'))
    }

    if (sub && !onOff(sub) && sub !== 'toggle') {
      setGoodbye(ctx.chat, raw)
      return ctx.reply(await tx('goodbyeSaved'))
    }

    const value = onOff(sub)
    if (sub === 'toggle' || value !== undefined) toggleGoodbye(ctx.chat, value)

    return sendPanel(ctx)
  },
} satisfies Command

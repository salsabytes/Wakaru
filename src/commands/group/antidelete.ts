import { antideleteConfig, toggleAntidelete } from '../../lib/groupSettings.ts'
import type { Button } from '../../lib/buttons.ts'
import { tx } from '../../lib/lang.ts'

const onOff = (w: string): boolean | undefined =>
  w === 'on' || w === 'enable' || w === '1' ? true : w === 'off' || w === 'disable' || w === '0' ? false : undefined

const panel = async (chat: string, prefix: string): Promise<{ text: string; buttons: Button[] }> => {
  const c = antideleteConfig(chat)
  const text = [
    await tx('antideleteTitle'),
    '',
    await tx('statusLine', { status: await tx(c.on ? 'toggleOn' : 'toggleOff') }),
    await tx(c.on ? 'antideleteBodyOn' : 'antideleteBodyOff'),
    '',
    await tx('antideleteNote'),
    await tx('antideleteHint', { prefix }),
  ].join('\n')
  return {
    text,
    buttons: [{ id: 'antidelete:toggle', text: await tx(c.on ? 'disableButton' : 'enableButton') }],
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
  name: 'antidelete',
  desc: 'republish messages deleted in this group (admin only)',
  aliases: ['antihapus', 'antidel'],
  groupOnly: true,
  adminOnly: true,
  run: async (ctx: CommandContext) => {
    const sub = (ctx.args[0] ?? '').toLowerCase()
    const value = onOff(sub)
    if (sub === 'toggle' || value !== undefined) {
      toggleAntidelete(ctx.chat, value)
    } else if (sub) {
      return ctx.reply(await tx('usage', { prefix: ctx.prefix, name: 'antidelete', usage: 'on|off' }))
    }

    return sendPanel(ctx)
  },
} satisfies Command

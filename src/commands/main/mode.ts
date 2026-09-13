import { botMode, setMode, type Mode } from '../../lib/config.ts'
import { t } from '../../lib/lang.ts'

const MODES: Mode[] = ['public', 'self', 'private']

export default {
  name: 'mode',
  desc: 'switch bot reply mode (owner only)',
  aliases: ['self'],
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const want = ctx.text.trim().toLowerCase()
    if (!want || !MODES.includes(want as Mode)) {
      return ctx.reply(t('modeUsage', { prefix: ctx.prefix, mode: botMode() }))
    }
    await ctx.reply(t('modeSet', { mode: setMode(want as Mode) }))
  },
} satisfies Command

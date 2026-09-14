import { language, setLanguage, tx } from '../../lib/lang.ts'

export default {
  name: 'setlang',
  desc: 'change bot reply language (any code, e.g. id/en/ja)',
  aliases: ['lang', 'bahasa'],
  run: async (ctx: CommandContext) => {
    const want = ctx.text.trim().toLowerCase()
    if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(want)) {
      return ctx.reply(await tx('langUsage', { prefix: ctx.prefix, lang: language() }))
    }
    const next = setLanguage(want)
    await ctx.reply(await tx('langSet', { lang: next }))
  },
} satisfies Command

import { language, setLanguage, t } from '../../lib/lang.ts'

export default {
  name: 'setlang',
  desc: 'change bot reply language (id/en)',
  aliases: ['lang', 'bahasa'],
  run: async (ctx: CommandContext) => {
    const want = ctx.text.trim().toLowerCase()
    if (!want || !['id', 'en', 'indonesia', 'indonesian', 'english'].includes(want)) {
      return ctx.reply(t('langUsage', { prefix: ctx.prefix, lang: language() }))
    }
    const next = setLanguage(want === 'en' || want === 'english' ? 'en' : 'id')
    await ctx.reply(t(next === 'en' ? 'langSetEn' : 'langSetId'))
  },
} satisfies Command

import { language, tx } from '../../lib/lang.ts'
import { logger } from '../../lib/logger.ts'
import { searchWiki } from '../../lib/wiki.ts'

export default {
  name: 'wiki',
  desc: 'search Wikipedia in the bot language',
  aliases: ['wikipedia', 'wk'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const q = ctx.text.trim()
    if (!q) return ctx.reply(await tx('wikiUsage', { prefix: ctx.prefix }))
    await ctx.react('⏳')
    try {
      const r = await searchWiki(q, language())
      if (!r) return ctx.reply(await tx('wikiNotFound', { query: q }))
      await ctx.reply(`📖 *${r.title}*\n${r.extract}${r.url ? `\n\n🔗 ${r.url}` : ''}`)
    } catch (err) {
      logger.error('wiki error:', err)
      await ctx.reply(await tx('wikiFailed'))
    }
  },
} satisfies Command

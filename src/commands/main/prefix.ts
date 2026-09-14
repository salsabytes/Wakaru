import { botPrefixes, setPrefixes } from '../../lib/config.ts'
import { t } from '../../lib/lang.ts'

const displayPrefixes = (p: string[]): string => (p.length ? p.join(' ') : t('prefixNone'))

export default {
  name: 'prefix',
  desc: 'change command prefixes, or none for bare mode (owner only)',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const raw = ctx.text.trim().toLowerCase()
    if (!raw) {
      return ctx.reply(t('prefixUsage', { prefix: ctx.prefix, prefixes: displayPrefixes(botPrefixes()) }))
    }
    if (raw === 'none' || raw === 'off' || raw === 'bare') {
      setPrefixes([])
      return ctx.reply(t('prefixSet', { prefixes: displayPrefixes(botPrefixes()) }))
    }
    const next = setPrefixes(raw.split(/\s+/))
    if (!next.length) {
      return ctx.reply(t('prefixUsage', { prefix: ctx.prefix, prefixes: displayPrefixes(botPrefixes()) }))
    }
    await ctx.reply(t('prefixSet', { prefixes: displayPrefixes(next) }))
  },
} satisfies Command

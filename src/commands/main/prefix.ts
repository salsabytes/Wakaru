import { botBare, botPrefixes, setPrefixes, BARE_TOKENS } from '../../lib/config.ts'
import { t } from '../../lib/lang.ts'

const displayPrefixes = (p: string[], bare: boolean): string => {
  if (!p.length) return t('prefixNone')
  return bare ? `${p.join(' ')} + ${t('prefixNone')}` : p.join(' ')
}

export default {
  name: 'prefix',
  desc: 'change command prefixes, multi, and optional bare (owner only)',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const raw = ctx.text.trim().toLowerCase()
    if (!raw) {
      return ctx.reply(t('prefixUsage', { prefix: ctx.prefix, prefixes: displayPrefixes(botPrefixes(), botBare()) }))
    }
    const toks = raw.split(/\s+/)
    const wantBare = toks.some((tok) => BARE_TOKENS.includes(tok))
    const next = setPrefixes(toks.filter((tok) => !BARE_TOKENS.includes(tok)), wantBare)
    if (!next.length && !wantBare) {
      return ctx.reply(t('prefixUsage', { prefix: ctx.prefix, prefixes: displayPrefixes(botPrefixes(), botBare()) }))
    }
    await ctx.reply(t('prefixSet', { prefixes: displayPrefixes(next, botBare()) }))
  },
} satisfies Command

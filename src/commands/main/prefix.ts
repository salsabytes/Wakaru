import { botBare, botPrefixes, setPrefixes, BARE_TOKENS } from '../../lib/config.ts'
import { tx } from '../../lib/lang.ts'

const displayPrefixes = async (p: string[], bare: boolean): Promise<string> => {
  if (!p.length) return tx('prefixNone')
  return bare ? `${p.join(' ')} + ${await tx('prefixNone')}` : p.join(' ')
}

export default {
  name: 'prefix',
  desc: 'change command prefixes, multi, and optional bare (owner only)',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const raw = ctx.text.trim()
    if (!raw) {
      return ctx.reply(await tx('prefixUsage', { prefix: ctx.prefix, prefixes: await displayPrefixes(botPrefixes(), botBare()) }))
    }
    const toks = raw.split(/\s+/)
    const wantBare = toks.some((tok) => BARE_TOKENS.includes(tok.toLowerCase()))
    const next = setPrefixes(
      toks.filter((tok) => !BARE_TOKENS.includes(tok.toLowerCase())),
      wantBare,
    )
    if (!next.length && !wantBare) {
      return ctx.reply(await tx('prefixUsage', { prefix: ctx.prefix, prefixes: await displayPrefixes(botPrefixes(), botBare()) }))
    }
    await ctx.reply(await tx('prefixSet', { prefixes: await displayPrefixes(next, botBare()) }))
  },
} satisfies Command

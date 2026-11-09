import { MAX_MB_DEFAULT, MAX_MB_MAX, MAX_MB_MIN, botMaxDownloadMB, setMaxDownloadMB } from '../../lib/config.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'limit',
  desc: 'set max media download size in MB (owner only)',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const raw = ctx.text.trim()
    if (!raw) {
      return ctx.reply(await tx('limitUsage', { prefix: ctx.prefix, limit: botMaxDownloadMB(), def: MAX_MB_DEFAULT, min: MAX_MB_MIN, max: MAX_MB_MAX }))
    }
    const n = Number(raw.replace(/mb$/i, ''))
    if (!Number.isFinite(n)) {
      return ctx.reply(await tx('limitUsage', { prefix: ctx.prefix, limit: botMaxDownloadMB(), def: MAX_MB_DEFAULT, min: MAX_MB_MIN, max: MAX_MB_MAX }))
    }
    await ctx.reply(await tx('limitSet', { limit: setMaxDownloadMB(n), min: MAX_MB_MIN, max: MAX_MB_MAX }))
  },
} satisfies Command

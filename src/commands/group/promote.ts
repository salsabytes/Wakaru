import { groupGuards, resolveTargets } from '../../lib/group.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'promote',
  desc: 'promote member(s) to group admin (tag or reply)',
  aliases: ['angkat'],
  run: async (ctx: CommandContext) => {
    if (!ctx.isGroup) return ctx.reply(t('groupOnly'))
    const targets = [...ctx.mentionedJid, ...(ctx.quoted?.sender ? [ctx.quoted.sender] : [])]
    if (!targets.length) return ctx.reply(t('promoteUsage', { prefix: ctx.prefix }))
    const g = await groupGuards(ctx)
    if (!g) return
    const resolved = resolveTargets(g.met, targets)
    if (!resolved.length) return ctx.reply(t('kickNotFound'))
    try {
      const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, resolved, 'promote')
      const ok = res.filter((r) => r.status === '200').length
      await ctx.reply(ok ? t('promoteDone', { n: ok }) : t('promoteFailed', { msg: 'status != 200' }))
    } catch (err) {
      await ctx.reply(t('promoteFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  },
} satisfies Command

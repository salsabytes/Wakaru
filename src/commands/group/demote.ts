import { groupGuards, resolveTargets } from '../../lib/group.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'demote',
  desc: 'demote admin(s) back to member (tag or reply)',
  aliases: ['turunkan'],
  run: async (ctx: CommandContext) => {
    if (!ctx.isGroup) return ctx.reply(t('groupOnly'))
    const targets = [...ctx.mentionedJid, ...(ctx.quoted?.sender ? [ctx.quoted.sender] : [])]
    if (!targets.length) return ctx.reply(t('demoteUsage', { prefix: ctx.prefix }))
    const g = await groupGuards(ctx)
    if (!g) return
    const resolved = resolveTargets(g.met, targets)
    if (!resolved.length) return ctx.reply(t('kickNotFound'))
    try {
      const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, resolved, 'demote')
      const ok = res.filter((r) => r.status === '200').length
      await ctx.reply(ok ? t('demoteDone', { n: ok }) : t('demoteFailed', { msg: 'status != 200' }))
    } catch (err) {
      await ctx.reply(t('demoteFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  },
} satisfies Command

import { groupGuards, resolveTargets } from '../../lib/group.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'kick',
  desc: 'kick a member from the group (tag or reply)',
  aliases: ['tendang', 'keluarkan'],
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  run: async (ctx: CommandContext) => {
    const targets = [...ctx.mentionedJid, ...(ctx.quoted?.sender ? [ctx.quoted.sender] : [])]
    if (!targets.length) return ctx.reply(t('kickUsage', { prefix: ctx.prefix }))
    const g = await groupGuards(ctx)
    if (!g) return
    const resolved = resolveTargets(g.met, targets)
    if (!resolved.length) return ctx.reply(t('kickNotFound'))
    try {
      const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, resolved, 'remove')
      const ok = res.filter((r) => r.status === '200').length
      await ctx.reply(ok ? t('kickDone', { n: ok }) : t('kickFailed', { msg: 'status != 200' }))
    } catch (err) {
      await ctx.reply(t('kickFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  },
} satisfies Command

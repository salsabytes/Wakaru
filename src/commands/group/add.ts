import { groupGuards } from '../../lib/group.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'add',
  desc: 'add a member to the group by phone number',
  aliases: ['tambah'],
  run: async (ctx: CommandContext) => {
    if (!ctx.isGroup) return ctx.reply(t('groupOnly'))
    const nums = [
      ...new Set(
        ctx.text
          .trim()
          .split(/\s+/)
          .reduce<string[]>((acc, tok) => {
            const prev = acc[acc.length - 1]
            if (prev && /^\+\d{1,3}$/.test(prev) && !tok.startsWith('+')) acc[acc.length - 1] = prev + tok
            else acc.push(tok)
            return acc
          }, [])
          .map((tok) => tok.replace(/\D/g, ''))
          .filter((n) => n.length >= 8 && n.length <= 15),
      ),
    ]
    if (!nums.length) return ctx.reply(t('addUsage', { prefix: ctx.prefix }))
    const g = await groupGuards(ctx)
    if (!g) return
    try {
      const jids = nums.map((n) => `${n}@s.whatsapp.net`)
      const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, jids, 'add')
      const ok = res.filter((r) => r.status === '200')
      const failed = res.filter((r) => r.status !== '200')
      if (ok.length) await ctx.reply(t('addDone', { n: ok.length }))
      if (failed.length) {
        const detail = failed.map((r) => `${(r.jid ?? '').split('@')[0]}: ${r.status}`).join(', ')
        await ctx.reply(t('addFailed', { msg: detail }))
      }
    } catch (err) {
      await ctx.reply(t('addFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  },
} satisfies Command

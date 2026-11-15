import { sendFeedback } from '../../lib/feedback.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'report',
  desc: 'lapor fitur yang bermasalah ke owner',
  aliases: ['bug', 'lapor', 'masalah'],
  cooldown: 30,
  run: async (ctx: CommandContext) => {
    const text = ctx.text.trim() || ctx.quoted?.text?.trim() || ''
    if (!text) return ctx.reply(await tx('reportUsage', { prefix: ctx.prefix }))
    const ok = await sendFeedback(ctx, 'report', text)
    return ctx.reply(await tx(ok ? 'feedbackSent' : 'feedbackFailed'))
  },
} satisfies Command

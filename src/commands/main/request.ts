import { sendFeedback } from '../../lib/feedback.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'request',
  desc: 'kirim permintaan fitur ke owner',
  aliases: ['fitur', 'ide', 'saran'],
  cooldown: 30,
  run: async (ctx: CommandContext) => {
    const text = ctx.text.trim() || ctx.quoted?.text?.trim() || ''
    if (!text) return ctx.reply(await tx('requestUsage', { prefix: ctx.prefix }))
    const ok = await sendFeedback(ctx, 'request', text)
    return ctx.reply(await tx(ok ? 'feedbackSent' : 'feedbackFailed'))
  },
} satisfies Command

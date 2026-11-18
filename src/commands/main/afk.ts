import { formatDuration } from '../../lib/time.ts'
import { setAfk } from '../../lib/afk.ts'

export default {
  name: 'afk',
  desc: 'tandai kamu AFK: .afk [alasan] (auto-off saat kamu chat lagi)',
  run: async (ctx: CommandContext) => {
    const reason = ctx.text.trim()
    setAfk(ctx.sender, reason)
    const who = ctx.pushName || ctx.sender.split(/[:@]/)[0]
    return ctx.reply(reason ? `${who} sekarang AFK: ${reason}` : `${who} sekarang AFK.`)
  },
} satisfies Command

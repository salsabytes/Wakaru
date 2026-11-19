import { isAiBusy } from '../../lib/ai/aiStatus.ts'

export default {
  name: 'aistatus',
  desc: 'check if the ai is currently processing',
  ownerOnly: true,
  run: async (ctx) => {
    await ctx.reply(isAiBusy() ? 'AI lagi proses sekarang kak' : 'AI lagi nggak proses sekarang kak')
  },
} satisfies Command

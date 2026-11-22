import { hintF100, startF100, stopF100 } from '../../lib/f100.ts'

export { handleF100Answer, pendingF100 } from '../../lib/f100.ts'

export default {
  name: 'family100',
  aliases: ['f100', 'fam100'],
  desc: 'game Family 100 (survei) — jawab langsung di chat, 1 ronde per grup/chat',
  run: async (ctx: CommandContext) => {
    const sub = ctx.args[0]?.toLowerCase()
    if (sub === 'stop' || sub === 'nyerah' || sub === 'skip' || sub === 'surrender' || sub === 'giveup') return stopF100(ctx)
    if (sub === 'hint' || sub === 'clue') return hintF100(ctx)
    await startF100(ctx)
  },
} satisfies Command
import { downloadPinterest } from '../../lib/scrapers/index.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'pinterest',
  desc: 'get images from a Pinterest pin link or search by query',
  aliases: ['pin', 'pins'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const input = await requireUrl(ctx, 'pinterest', '<pin link | query>')
    if (!input) return
    const media = await downloadPinterest(input)
    await sendMedia(ctx, media)
  },
} satisfies Command

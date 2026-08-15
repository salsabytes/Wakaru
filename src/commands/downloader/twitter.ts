import { downloadTwitter } from '../../lib/scrapers/index.ts'
import { requireUrl } from '../../lib/media.ts'

export default {
  name: 'twitter',
  desc: 'download an X (Twitter) video, no watermark',
  aliases: ['x', 'tw', 'twdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'twitter', '<x link>')
    if (!url) return
    const r = await downloadTwitter(url)
    await ctx.sendVideo(r.buf, r.title)
  },
} satisfies Command

import { downloadInstagram } from '../../lib/scraper.ts'
import { requireUrl } from '../../lib/simple.ts'

export default {
  name: 'instagram',
  desc: 'download an Instagram video, reels, photo or carousel without watermark',
  aliases: ['ig', 'igdl'],
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'instagram', '<instagram link>')
    if (!url) return
    const r = await downloadInstagram(url)
    for (const [i, m] of r.media.entries()) {
      const caption = i === 0 ? r.title : undefined
      if (m.type === 'video') await ctx.sendVideo(m.buf, caption)
      else await ctx.sendImage(m.buf, caption)
    }
  },
} satisfies Command

import { downloadTikTok } from '../../lib/scrapers/index.ts'
import { requireUrl } from '../../lib/media.ts'

export default {
  name: 'tiktok',
  desc: 'download a TikTok video without watermark',
  aliases: ['tt', 'ttdl'],
  heavy: true,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'tiktok', '<tiktok link>')
    if (!url) return
    const r = await downloadTikTok(url)
    await ctx.sendVideo(r.buf, r.title)
  },
} satisfies Command

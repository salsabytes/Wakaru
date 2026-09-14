import { downloadTikTok } from '../../lib/scrapers/index.ts'
import { oversizedDoc, requireUrl } from '../../lib/media.ts'

export default {
  name: 'tiktok',
  desc: 'download a TikTok video without watermark',
  aliases: ['tt', 'ttdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'tiktok', '<tiktok link>')
    if (!url) return
    const r = await downloadTikTok(url)
    const doc = oversizedDoc({ type: 'video', buf: r.buf, caption: r.title })
    if (doc) await ctx.sendDocument(doc.buf, doc.name, doc.mime)
    else await ctx.sendVideo(r.buf, r.title)
  },
} satisfies Command

import { downloadTikTok } from '../../lib/scrapers/index.ts'
import { oversizedDoc, requireUrl, asDoc } from '../../lib/media.ts'
import { videoPlayability } from '../../lib/sender.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'tiktok',
  desc: 'download a TikTok video without watermark',
  aliases: ['tt', 'ttdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'tiktok', '<tiktok link>')
    if (!url) return
    const r = await downloadTikTok(url)
    const media = { type: 'video' as const, buf: r.buf, caption: r.title }
    const doc = oversizedDoc(media)
    if (doc) {
      await ctx.sendDocument(doc.buf, doc.name, doc.mime)
      return
    }
    // 1080p60/HEVC files arrive fine but WA's inline player won't play them —
    // send as .mp4 document so they still open in an external player
    if (videoPlayability(r.buf) === 'heavy') {
      const d = asDoc(media)
      await ctx.sendDocument(d.buf, d.name, d.mime)
      await ctx.reply(await tx('tiktokHeavy'))
      return
    }
    await ctx.sendVideo(r.buf, r.title)
  },
} satisfies Command

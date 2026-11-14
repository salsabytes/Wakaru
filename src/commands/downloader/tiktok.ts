import { downloadTikTok, scraperErrorKey } from '../../lib/scrapers/index.ts'
import { oversizedDoc, requireUrl, asDoc } from '../../lib/media.ts'
import { videoPlayability } from '../../lib/sender.ts'
import { tx } from '../../lib/lang.ts'
import { logger } from '../../lib/logger.ts'

export default {
  name: 'tiktok',
  desc: 'download a TikTok video without watermark',
  aliases: ['tt', 'ttdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'tiktok', '<tiktok link>')
    if (!url) return
    try {
      const r = await downloadTikTok(url)
      const media = { type: 'video' as const, buf: r.buf, caption: r.title }
      const doc = oversizedDoc(media)
      if (doc) {
        await ctx.sendDocument(doc.buf, doc.name, doc.mime)
        return
      }
      // WA's inline player can't play 1080p60/HEVC; send a document instead
      if (videoPlayability(r.buf) === 'heavy') {
        const d = asDoc(media)
        await ctx.sendDocument(d.buf, d.name, d.mime)
        await ctx.reply(await tx('tiktokHeavy'))
        return
      }
      await ctx.sendVideo(r.buf, r.title)
    } catch (e) {
      logger.warn('tiktok download failed:', (e as Error).message)
      return ctx.reply(await tx(scraperErrorKey(e)))
    }
  },
} satisfies Command

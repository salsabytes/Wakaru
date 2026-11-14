import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl, sendMediaOrCarousel } from '../../lib/media.ts'
import { scraperErrorKey } from '../../lib/scrapers/index.ts'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'instagram',
  desc: 'download an Instagram video, reels, photo or carousel without watermark',
  aliases: ['ig', 'igdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'instagram', '<instagram link>')
    if (!url) return
    try {
      // one wakafy call: resolve the post, then fetch items straight from CDN
      const r = await wakafy.media('/v1/media/igdl', url, { label: 'instagram' })
      await sendMediaOrCarousel(ctx, r)
    } catch (e) {
      logger.warn('instagram download failed:', (e as Error).message)
      await ctx.reply(await tx(scraperErrorKey(e)))
    }
  },
} satisfies Command

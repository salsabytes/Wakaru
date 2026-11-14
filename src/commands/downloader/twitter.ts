import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl, sendMediaOrCarousel } from '../../lib/media.ts'
import { botMaxDownloadMB } from '../../lib/config.ts'
import { scraperErrorKey } from '../../lib/scrapers/index.ts'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'twitter',
  desc: 'download an X (Twitter) video or photos, no watermark',
  aliases: ['x', 'tw', 'twdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'twitter', '<x link>')
    if (!url) return
    try {
      // X serves big 1080p files, so use the user's download cap, not the 40MB default
      const r = await wakafy.media('/v1/media/xdl', url, { label: 'x', maxTotalMB: botMaxDownloadMB() })
      await sendMediaOrCarousel(ctx, r)
    } catch (e) {
      logger.warn('twitter download failed:', (e as Error).message)
      await ctx.reply(await tx(scraperErrorKey(e)))
    }
  },
} satisfies Command

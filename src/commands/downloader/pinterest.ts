import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl } from '../../lib/media.ts'
import { sendCarousel } from '../../lib/buttons.ts'
import { fetchBuffer, UA } from '../../lib/http.ts'
import { scraperErrorKey } from '../../lib/scrapers/index.ts'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'pinterest',
  desc: 'get images from a Pinterest pin link or search by query',
  aliases: ['pin', 'pins'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const input = await requireUrl(ctx, 'pinterest', '<pin link | query>')
    if (!input) return
    try {
      // pins and search queries both resolve via wakafy; WA fetches the CDN images
      const r = await wakafy.links('/v1/media/pindl', input, { label: 'pinterest' })
      const images = r.media.filter((m) => m.type === 'image').slice(0, 10)
      if (!images.length) throw new Error('pinterest: no images')

      // carousel needs 2-10 cards; a single pin is sent as a normal image
      if (images.length === 1) {
        await ctx.sendImage(await fetchBuffer(images[0].url, { headers: { 'User-Agent': UA } }), r.title)
        return
      }

      await sendCarousel(ctx.sock, ctx.chat, {
        text: r.title,
        cards: images.map((m, i) => ({
          image: m.url,
          body: `📌 ${i + 1}/${images.length}`,
          buttons: [{ text: 'Download', url: m.url }],
        })),
      })
    } catch (e) {
      logger.warn('pinterest download failed:', (e as Error).message)
      await ctx.reply(await tx(scraperErrorKey(e)))
    }
  },
} satisfies Command

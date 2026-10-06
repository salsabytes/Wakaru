import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'pinterest',
  desc: 'get images from a Pinterest pin link or search by query',
  aliases: ['pin', 'pins'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const input = await requireUrl(ctx, 'pinterest', '<pin link | query>')
    if (!input) return
    // pin links and search queries alike: resolve via wakafy, pull items straight from CDN
    const r = await wakafy.media('/v1/media/pindl', input, { label: 'pinterest' })
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

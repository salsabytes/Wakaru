import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'instagram',
  desc: 'download an Instagram video, reels, photo or carousel without watermark',
  aliases: ['ig', 'igdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'instagram', '<instagram link>')
    if (!url) return
    // the whole IG flow in one call: resolve via wakafy direct+meta, pull items straight from CDN
    const r = await wakafy.media('/v1/media/igdl', url, { label: 'instagram' })
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

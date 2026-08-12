import { downloadInstagram } from '../../lib/scrapers/index.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'instagram',
  desc: 'download an Instagram video, reels, photo or carousel without watermark',
  aliases: ['ig', 'igdl'],
  heavy: true,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'instagram', '<instagram link>')
    if (!url) return
    const r = await downloadInstagram(url)
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

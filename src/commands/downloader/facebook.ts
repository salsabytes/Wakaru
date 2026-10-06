import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'facebook',
  desc: 'download a Facebook video or photos',
  aliases: ['fb', 'fbdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'facebook', '<facebook link>')
    if (!url) return
    // the whole FB flow in one call: resolve via wakafy direct+meta, pull items straight from CDN
    const r = await wakafy.media('/v1/media/fbdl', url, { label: 'facebook' })
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

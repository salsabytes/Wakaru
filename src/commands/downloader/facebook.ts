import { downloadFacebook } from '../../lib/scrapers/index.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'facebook',
  desc: 'download a Facebook video or photos',
  aliases: ['fb', 'fbdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'facebook', '<facebook link>')
    if (!url) return
    const r = await downloadFacebook(url)
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

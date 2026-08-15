import { downloadTwitter } from '../../lib/scrapers/index.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'

export default {
  name: 'twitter',
  desc: 'download an X (Twitter) video or photos, no watermark',
  aliases: ['x', 'tw', 'twdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'twitter', '<x link>')
    if (!url) return
    const r = await downloadTwitter(url)
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

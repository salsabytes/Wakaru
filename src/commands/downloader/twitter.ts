import { wakafy } from '../../lib/wakafy.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'
import { botMaxDownloadMB } from '../../lib/config.ts'

export default {
  name: 'twitter',
  desc: 'download an X (Twitter) video or photos, no watermark',
  aliases: ['x', 'tw', 'twdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'twitter', '<x link>')
    if (!url) return
    // X serves 1080p (tens of MB) — budget the user's configured cap, not the 40MB multi-item default
    const r = await wakafy.media('/v1/media/xdl', url, { label: 'x', maxTotalMB: botMaxDownloadMB() })
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

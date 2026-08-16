import { downloadSpotify } from '../../lib/scrapers/index.ts'
import { requireUrl, sendMedia } from '../../lib/media.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'spotify',
  desc: 'download a Spotify track or album as audio (matched on YouTube)',
  aliases: ['sp'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'spotify', '<spotify track/album link>')
    if (!url) return
    await ctx.reply(t('processing'))
    const r = await downloadSpotify(url)
    await sendMedia(
      ctx,
      r.media.map((m, i) => ({ type: m.type, buf: m.buf, caption: i === 0 ? r.title : undefined })),
    )
  },
} satisfies Command

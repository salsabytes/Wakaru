import { downloadFacebook } from '../../lib/scrapers/index.ts'
import { requireUrl } from '../../lib/media.ts'

export default {
  name: 'facebook',
  desc: 'download a Facebook video in HD',
  aliases: ['fb', 'fbdl'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'facebook', '<facebook link>')
    if (!url) return
    const r = await downloadFacebook(url)
    await ctx.sendVideo(r.buf, r.title)
  },
} satisfies Command

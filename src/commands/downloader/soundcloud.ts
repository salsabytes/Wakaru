import { downloadSoundCloud } from '../../lib/scrapers/index.ts'
import { requireUrl } from '../../lib/media.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'soundcloud',
  desc: 'download audio from a SoundCloud link',
  aliases: ['sc'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'soundcloud', '<soundcloud link>')
    if (!url) return
    await ctx.reply(t('processing'))
    const r = await downloadSoundCloud(url)
    await ctx.sendAudio(r.buf, r.title)
  },
} satisfies Command

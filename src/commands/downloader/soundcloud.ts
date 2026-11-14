import { downloadSoundCloud, scraperErrorKey } from '../../lib/scrapers/index.ts'
import { oversizedDoc, requireUrl } from '../../lib/media.ts'
import { tx } from '../../lib/lang.ts'
import { logger } from '../../lib/logger.ts'

export default {
  name: 'soundcloud',
  desc: 'download SoundCloud track',
  aliases: ['sc'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const url = await requireUrl(ctx, 'soundcloud', '<soundcloud link>')
    if (!url) return
    try {
      const r = await downloadSoundCloud(url)
      const media = { type: 'audio' as const, buf: r.buf, caption: r.title }
      const doc = oversizedDoc(media)
      if (doc) return ctx.sendDocument(doc.buf, doc.name, doc.mime)
      await ctx.sendAudio(r.buf, r.title)
    } catch (e) {
      logger.warn('soundcloud download failed:', (e as Error).message)
      return ctx.reply(await tx(scraperErrorKey(e)))
    }
  },
} satisfies Command

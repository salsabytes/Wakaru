import { downloadSoundCloud, isScraperError } from '../../lib/scrapers/index.ts'
import { oversizedDoc, requireUrl } from '../../lib/media.ts'
import { tx } from '../../lib/lang.ts'

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
      if (isScraperError(e)) {
        if (e.type === 'private' || e.type === 'blocked') return ctx.reply('❌ Track ini private/terbatas.')
        if (e.type === 'notfound') return ctx.reply('❌ Track tidak ditemukan atau sudah dihapus.')
        if (e.type === 'rate_limited') return ctx.reply('❌ Terlalu banyak permintaan. Coba lagi nanti.')
      }
      throw e
    }
  },
} satisfies Command

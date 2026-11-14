import { downloadYouTube } from './youtube-dl.ts'
import { oversizedDoc, requireUrl } from './media.ts'
import { tx } from './lang.ts'
import { logger } from './logger.ts'
import { scraperErrorKey } from './scrapers/errors.ts'

export function makeDownloader(o: {
  name: string
  desc: string
  mode: 'audio' | 'video'
  aliases?: string[]
  usage: string
}) {
  return {
    name: o.name,
    desc: o.desc,
    aliases: o.aliases,
    cooldown: 5,
    run: async (ctx: CommandContext) => {
      const url = await requireUrl(ctx, o.name, o.usage)
      if (!url) return
      await ctx.reply(await tx('processing'))
      try {
        const r = await downloadYouTube(url, o.mode)
        const doc = oversizedDoc({ type: o.mode === 'audio' ? 'audio' : 'video', buf: r.buf, caption: r.title })
        if (doc) await ctx.sendDocument(doc.buf, doc.name, doc.mime)
        else if (o.mode === 'audio') await ctx.sendAudio(r.buf, r.title)
        else await ctx.sendVideo(r.buf, r.title)
      } catch (e) {
        logger.warn(`${o.name} download failed:`, (e as Error).message)
        await ctx.reply(await tx(scraperErrorKey(e)))
      }
    },
  }
}
import { download } from './scrapers/index.ts'
import { oversizedDoc, requireUrl } from './media.ts'
import { tx } from './lang.ts'

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
      const r = await download(url, o.mode)
      const doc = oversizedDoc({ type: o.mode === 'audio' ? 'audio' : 'video', buf: r.buf, caption: r.title })
      if (doc) await ctx.sendDocument(doc.buf, doc.name, doc.mime)
      else if (o.mode === 'audio') await ctx.sendAudio(r.buf, r.title)
      else await ctx.sendVideo(r.buf, r.title)
    },
  }
}
import { download } from './scraper.ts'
import { requireUrl } from './simple.ts'

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
    run: async (ctx: CommandContext) => {
      const url = await requireUrl(ctx, o.name, o.usage)
      if (!url) return
      const r = await download(url, o.mode)
      if (o.mode === 'audio') await ctx.sendAudio(r.buf)
      else await ctx.sendVideo(r.buf, r.title)
    },
  }
}
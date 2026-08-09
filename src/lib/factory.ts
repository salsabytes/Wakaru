import { download } from './scraper.ts'

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
      const url = ctx.text.trim()
      if (!url) return ctx.reply(`usage: ${ctx.prefix}${o.name} ${o.usage}`)
      await ctx.react('⏳')
      const r = await download(url, o.mode)
      if (o.mode === 'audio') await ctx.sendAudio(r.buf)
      else await ctx.sendVideo(r.buf, r.title)
    },
  }
}
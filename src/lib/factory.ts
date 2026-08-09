import { download, cleanup } from './scraper.ts'

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
      try {
        const media =
          o.mode === 'audio'
            ? { audio: r.buf, mimetype: 'audio/mpeg' as const }
            : { video: r.buf, caption: r.title }
        await ctx.sock.sendMessage(ctx.chat, media)
      } finally {
        await cleanup(r.dir)
      }
    },
  }
}
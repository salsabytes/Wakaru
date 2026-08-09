import { downloadTikTok } from '../../lib/scraper.ts'

export default {
  name: 'tiktok',
  desc: 'download a TikTok video without watermark',
  aliases: ['tt', 'ttdl'],
  run: async (ctx: CommandContext) => {
    const url = ctx.text.trim()
    if (!url) return ctx.reply(`usage: ${ctx.prefix}tiktok <tiktok link>`)
    await ctx.react('⏳')
    const r = await downloadTikTok(url)
    await ctx.sendVideo(r.buf, r.title)
  },
} satisfies Command

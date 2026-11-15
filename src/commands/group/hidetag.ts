export default {
  name: 'hidetag',
  desc: 'tag semua member tanpa menampilkan nama (admin only)',
  aliases: ['h', 'tagall'],
  groupOnly: true,
  adminOnly: true,
  run: async (ctx: CommandContext) => {
    const text = ctx.text.trim()
    if (!text) return ctx.reply(`pakai: ${ctx.prefix}hidetag <teks>`)
    const met = await ctx.sock.groupMetadata(ctx.chat).catch(() => undefined)
    if (!met) return
    const mentions = met.participants.map((p) => p.id)
    await ctx.sock.sendMessage(ctx.chat, { text, mentions })
  },
} satisfies Command

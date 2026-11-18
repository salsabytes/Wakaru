import { autodlConfig, toggleAutodl } from '../../lib/groupSettings.ts'

const onOff = (w: string): boolean | undefined =>
  w === 'on' || w === 'enable' || w === '1' ? true : w === 'off' || w === 'disable' || w === '0' ? false : undefined

export default {
  name: 'autodl',
  desc: 'auto-download link (TikTok/IG/FB/Pinterest/SoundCloud/Spotify/X) tanpa command',
  aliases: ['autodownload'],
  run: async (ctx: CommandContext) => {
    if (ctx.isGroup && !ctx.isOwner && !ctx.isAdmin) return ctx.reply('Khusus admin grup.')
    const sub = (ctx.args[0] ?? '').toLowerCase()
    const next = onOff(sub)
    const on = toggleAutodl(ctx.chat, next)
    return ctx.reply(on ? 'autodl: ON — link media akan otomatis di-download.' : 'autodl: OFF')
  },
} satisfies Command

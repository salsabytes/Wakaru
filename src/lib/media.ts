import { makeSender, type Sender } from './sender.ts'

const requireUrl = async (ctx: CommandContext, name: string, usage: string): Promise<string | undefined> => {
  const url = ctx.text.trim()
  if (!url) {
    await ctx.reply(`usage: ${ctx.prefix}${name} ${usage}`)
    return undefined
  }
  await ctx.react('⏳')
  return url
}

export { requireUrl }

export interface OutMedia {
  type: 'image' | 'video'
  buf: Buffer
  caption?: string
}

export async function sendMedia(ctx: CommandContext, media: OutMedia[]): Promise<void> {
  const dm = media.length > 1 && ctx.isGroup
  const sendOne = async (s: Sender) => {
    for (const [i, m] of media.entries()) {
      const caption = i === 0 ? m.caption : undefined
      if (m.type === 'video') await s.video(m.buf, caption)
      else await s.image(m.buf, caption)
    }
  }
  try {
    await sendOne(makeSender(ctx.sock, dm ? ctx.sender : ctx.chat))
  } catch (err) {
    if (dm) {
      await sendOne(makeSender(ctx.sock, ctx.chat))
      return
    }
    throw err
  }
  if (dm) await ctx.reply(`📩 ${media.length} file dikirim ke chat pribadimu ya`)
}

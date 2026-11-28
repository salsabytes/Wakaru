import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'
import { isExpiredMedia } from '../../lib/wa/media.ts'
import { sendGroupStatus, type GroupStatusInput } from '../../lib/wa/groupStatus.ts'

const isImage = (t?: string) => t === 'imageMessage'
const isVideo = (t?: string) => t === 'videoMessage'
// GIFs sent as files arrive as documentMessage + image/gif
const isGifDoc = (t?: string, mime?: string) => t === 'documentMessage' && mime === 'image/gif'
const accepts = (t?: string, mime?: string) => isImage(t) || isVideo(t) || isGifDoc(t, mime)

const MEDIA_MAX = 64 * 1024 * 1024 // sanity guard so a 200 MB file never enters the upload; WA enforces its own cap

export default {
  name: 'groupstatus',
  desc: 'post a 24h status visible only to this group (text/photo/video)',
  aliases: ['swgc'],
  groupOnly: true,
  cooldown: 15,
  run: async (ctx: CommandContext) => {
    // media comes from the caption (send directly) or from the replied message
    const media = accepts(ctx.mtype, ctx.mimetype) ? ctx : ctx.quoted && accepts(ctx.quoted.mtype, ctx.quoted.mimetype) ? ctx.quoted : undefined
    const text = ctx.text.trim()
    if (!media && !text) return ctx.reply(await tx('groupStatusUsage', { prefix: ctx.prefix }))

    await ctx.react('⏳')
    try {
      const input: GroupStatusInput = { text: text || undefined }
      if (media) {
        const buf = await media.download()
        if (buf.length > MEDIA_MAX) {
          await ctx.react('❌')
          return ctx.reply(await tx('groupStatusTooBig'))
        }
        if (isImage(media.mtype)) {
          input.image = buf
        } else {
          // video + gif-as-document both go down the video path; only a real gif
          // gets gifPlayback (a plain video must not be muted-ified into a gif)
          input.video = buf
          input.gif = isGifDoc(media.mtype, media.mimetype)
        }
      }
      await sendGroupStatus(ctx.sock, ctx.chat, input)
      await ctx.react('✅')
    } catch (err) {
      logger.error('groupstatus error:', err)
      await ctx.react('❌')
      if (isExpiredMedia(err)) return ctx.reply(await tx('mediaExpired'))
      await ctx.reply(await tx('groupStatusFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  },
} satisfies Command

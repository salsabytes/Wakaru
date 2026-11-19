import { wakafy } from './api/wakafy.ts'
import { downloadTikTok, scraperErrorKey } from './download/scrapers/index.ts'
import { oversizedDoc, asDoc, sendMediaOrCarousel, isExpiredMedia } from './wa/media.ts'
import { downloadYouTube } from './download/youtube-dl.ts'
import { logger } from './logger.ts'
import { tx } from './lang.ts'
import { videoPlayability } from './wa/sender.ts'

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i

const pickUrl = (text: string): string | undefined => text.match(URL_RE)?.[0]?.replace(/[),.!?]+$/, '')

const isTikTok = (u: string) => /tiktok\.com\//i.test(u)
const isInstagram = (u: string) => /instagram\.com\//i.test(u)
const isFacebook = (u: string) => /(?:facebook\.com|fb\.watch)\//i.test(u)
const isTwitter = (u: string) => /(?:twitter\.com|x\.com)\//i.test(u)
const isPinterest = (u: string) => /(?:pinterest\.com|pin\.it)\//i.test(u)
const isYouTube = (u: string) => /(?:youtube\.com|youtu\.be)\//i.test(u)
const isSoundCloud = (u: string) => /soundcloud\.com\//i.test(u)
const isSpotify = (u: string) => /spotify\.com\//i.test(u)

export const maybeAutoDownload = async (ctx: CommandContext): Promise<boolean> => {
  const url = pickUrl(ctx.text || '')
  if (!url) return false
  try {
    if (isTikTok(url)) {
      await ctx.react('⏳').catch(() => {})
      const r = await downloadTikTok(url)
      const media = { type: 'video' as const, buf: r.buf, caption: r.title }
      const doc = oversizedDoc(media)
      if (doc) await ctx.sendDocument(doc.buf, doc.name, doc.mime)
      else if (videoPlayability(r.buf) === 'heavy') {
        const d = asDoc(media)
        await ctx.sendDocument(d.buf, d.name, d.mime)
      } else await ctx.sendVideo(r.buf, r.title)
      return true
    }
    if (isInstagram(url)) {
      await ctx.react('⏳').catch(() => {})
      const r = await wakafy.media('/v1/media/igdl', url, { label: 'instagram' })
      await sendMediaOrCarousel(ctx, r)
      return true
    }
    if (isFacebook(url)) {
      await ctx.react('⏳').catch(() => {})
      const r = await wakafy.media('/v1/media/fbdl', url, { label: 'facebook' })
      await sendMediaOrCarousel(ctx, r)
      return true
    }
    if (isTwitter(url)) {
      await ctx.react('⏳').catch(() => {})
      const r = await wakafy.media('/v1/media/twitterdl', url, { label: 'twitter' })
      await sendMediaOrCarousel(ctx, r)
      return true
    }
    if (isPinterest(url)) {
      await ctx.react('⏳').catch(() => {})
      const r = await wakafy.media('/v1/media/pindl', url, { label: 'pinterest' })
      await sendMediaOrCarousel(ctx, r)
      return true
    }
    if (isYouTube(url)) {
      await ctx.react('⏳').catch(() => {})
      const r = await downloadYouTube(url, 'audio')
      const doc = oversizedDoc({ type: 'audio', buf: r.buf, caption: r.title })
      if (doc) await ctx.sendDocument(doc.buf, doc.name, doc.mime)
      else await ctx.sendAudio(r.buf, r.title)
      return true
    }
    if (isSoundCloud(url) || isSpotify(url)) {
      await ctx.react('⏳').catch(() => {})
      const path = isSoundCloud(url) ? '/v1/media/soundcloud' : '/v1/media/spotify'
      const { buf, title } = await wakafy.file(path, { url }, { strip: /\.(mp3|m4a|mp4|webm)$/i })
      const doc = oversizedDoc({ type: 'audio', buf, caption: title })
      if (doc) await ctx.sendDocument(doc.buf, doc.name, doc.mime)
      else await ctx.sendAudio(buf, title)
      return true
    }
  } catch (e) {
    if (!isExpiredMedia(e)) logger.warn('autodl failed:', (e as Error).message)
    // Stay quiet on failure in autodl to avoid noisy group chats.
  }
  return false
}

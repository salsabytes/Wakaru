// .soundsticker — a sticker that plays a short sound when tapped.
//
// Both halves can arrive in either order, so the command looks at the message
// itself and the quoted message: one must carry a picture/video/gif, the other
// audio (a voice note, an attached mp3/m4a, or the audio of a video).
//
// WhatsApp caps sound stickers at 10 s (5 s when the sound comes from the same
// video the sticker is made from) — the native side trims, always.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'
import { isExpiredMedia } from '../../lib/wa/media.ts'
import { cfg } from '../../lib/config.ts'
import { sendSoundSticker } from '../../lib/wa/soundSticker.ts'

const exec = promisify(execFile)

const BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'audio.exe' : 'audio',
)
const STICKER_BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

const VISUAL = 10 // seconds, sticker from a picture / separate audio
const ANIMATED = 5 // seconds, sticker from a video (WA keeps the video's own sound short)

type Side = { mtype: string; mimetype?: string; download: () => Promise<Buffer> }

const isVisual = (t?: string) => t === 'imageMessage'
const isVideo = (t?: string) => t === 'videoMessage'
const isGifDoc = (t?: string, mime?: string) => t === 'documentMessage' && mime === 'image/gif'
const isAudio = (t?: string) => t === 'audioMessage'
const isAudioDoc = (t?: string, mime?: string) => t === 'documentMessage' && !!mime?.startsWith('audio/')

const picture = (s?: Side) => !!s && (isVisual(s.mtype) || isVideo(s.mtype) || isGifDoc(s.mtype, s.mimetype))
const sound = (s?: Side) => !!s && (isAudio(s.mtype) || isAudioDoc(s.mtype, s.mimetype))

export default {
  name: 'soundsticker',
  desc: 'make a sticker with sound — one picture/video + one audio',
  aliases: ['as', 'ss'],
  cooldown: 10,
  run: async (ctx: CommandContext) => {
    // `as`/`ss` are short enough to collide with ordinary words, so a bare
    // invocation with nothing attached shows usage instead of guessing.
    const self: Side = { mtype: ctx.mtype, mimetype: ctx.mimetype, download: ctx.download }
    const quoted = ctx.quoted

    const candidates: Array<[Side | undefined, Side | undefined]> = [
      [self, quoted],
      [quoted, self],
    ]
    let visual: Side | undefined
    let audio: Side | undefined
    let sameVideo = false
    for (const [a, b] of candidates) {
      if (picture(a) && sound(b)) { visual = a; audio = b; break }
      // a video carries its own sound: one video alone is enough
      if (a && isVideo(a.mtype) && !b) { visual = a; audio = a; sameVideo = true; break }
    }

    if (!visual || !audio) return ctx.reply(await tx('soundstickerUsage'))
    if (!existsSync(BIN)) return ctx.reply(await tx('soundstickerNotBuilt'))
    if (!existsSync(STICKER_BIN)) return ctx.reply(await tx('notBuilt'))

    // WA keeps 5 s whenever the *sticker* comes from a video (replaced audio
    // included), 10 s for anything built from a still image.
    const maxSeconds = isVideo(visual.mtype) ? ANIMATED : VISUAL
    const dir = await mkdtemp(join(tmpdir(), 'wakaru-soundsticker-'))
    try {
      const [visualBuf, audioBuf] = await Promise.all([
        visual.download(),
        audio === visual ? Promise.resolve<Buffer | undefined>(undefined) : audio.download(),
      ])

      const stickerIn = join(dir, sameVideo ? 'in.mp4' : 'in.bin')
      const stickerOut = join(dir, 'sticker.webp')
      const audioIn = join(dir, 'audio.in')
      const audioOut = join(dir, 'audio.ogg')

      await writeFile(stickerIn, visualBuf)
      if (audioBuf) await writeFile(audioIn, audioBuf)
      else await writeFile(audioIn, visualBuf) // video: the native side pulls the audio track

      const packName = cfg('stickerPack', 'Wakaru')
      const author = cfg('stickerAuthor', '')
      const args = packName || author ? [stickerIn, stickerOut, packName, author] : [stickerIn, stickerOut]
      await exec(STICKER_BIN, args, { timeout: 30_000 })

      // stdout is "seconds\tchannels" (see native/audio/src/sound.rs)
      const { stdout } = await exec(BIN, ['soundsticker', audioIn, audioOut, String(maxSeconds)], { timeout: 60_000 })
      const seconds = Number.parseFloat(stdout.trim().split('\t')[0] ?? '')
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`no audio encoded (stdout: ${stdout.trim()})`)

      await sendSoundSticker(ctx.sock, ctx.chat, {
        sticker: await readFile(stickerOut),
        audio: await readFile(audioOut),
        seconds: Math.round(seconds),
        quoted: ctx.quoted?.msg,
      })
    } catch (err) {
      logger.error('soundsticker error:', err)
      if (isExpiredMedia(err)) return ctx.reply(await tx('mediaExpired'))
      await ctx.reply(await tx('soundstickerFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}

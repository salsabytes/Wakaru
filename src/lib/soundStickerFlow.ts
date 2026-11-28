// `.ss` is a two-step flow: the command only captures the picture/video, the bot
// then asks for the sound, and only the sender's answer is accepted — for one
// minute, after which the session (and its timer) dies with a notice.
//
// WhatsApp caps sound stickers at 10 s (5 s when the sound comes from the video
// the sticker is made from) — the native side trims, always.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WAMessage } from 'baileys'
import { cfg } from './config.ts'
import { tx } from './lang.ts'
import { logger } from './logger.ts'
import { withSlot } from './queue.ts'
import { getSock } from '../socket.ts'
import { isExpiredMedia } from './wa/media.ts'
import { makeSender } from './wa/sender.ts'
import type { SerializedMessage } from './wa/serialize.ts'
import { sendSoundSticker } from './wa/soundSticker.ts'

const exec = promisify(execFile)

const BIN = join(
  import.meta.dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'audio.exe' : 'audio',
)
const STICKER_BIN = join(
  import.meta.dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

const VISUAL = 10 // seconds, sticker from a picture / separate audio
const ANIMATED = 5 // seconds, sticker from a video (WA keeps the video's own sound short)

// A `bin/sticker` built before the `--max-ms` flag existed answers with its
// usage block and exits 1 — the whole `.ss` then failed with an error the user
// could do nothing about. The bot rebuilds stale sidecars at boot
// (src/lib/sidecars.ts) but cargo may be missing, so retry with the untrimmed
// argv: a 7 s sticker next to a 5 s sound beats no sticker at all.
const noFlag = (err: unknown): boolean =>
  /\busage: sticker\b|(?:unexpected|unknown) argument/.test(String((err as { stderr?: string })?.stderr ?? ''))

/** Run the sticker sidecar; returns false when it had to drop the trim flags. */
export const runSticker = async (bin: string, argv: string[], untrimmed: string[]): Promise<boolean> => {
  try {
    await exec(bin, argv, { timeout: 30_000 })
    return true
  } catch (err) {
    if (!untrimmed.length || !noFlag(err)) throw err
    await exec(bin, untrimmed, { timeout: 30_000 })
    return false
  }
}

const TTL = 60_000 // how long the bot waits for the sound
const PENDING_MAX = 200

const isVideo = (t?: string) => t === 'videoMessage'
const isGifDoc = (t?: string, mime?: string) => t === 'documentMessage' && mime === 'image/gif'
const isAudio = (t?: string) => t === 'audioMessage'
const isAudioDoc = (t?: string, mime?: string) => t === 'documentMessage' && !!mime?.startsWith('audio/')

const picture = (t?: string, mime?: string) => t === 'imageMessage' || isVideo(t) || isGifDoc(t, mime)
const sound = (t?: string, mime?: string) => isAudio(t) || isAudioDoc(t, mime)

const CANCEL = new Set(['batal', 'cancel', 'gajadi', 'gak jadi', 'nggak jadi'])

// Animation length of a WebP, from its ANMF chunks (16-byte frame header, the
// duration is a 24-bit LE value at offset 12). 0 = a still image.
export const animMs = (webp: Buffer): number => {
  if (webp.length < 12 || webp.toString('ascii', 0, 4) !== 'RIFF') return 0
  let i = 12
  let ms = 0
  while (i + 8 <= webp.length) {
    const size = webp.readUInt32LE(i + 4)
    if (i + 8 + size > webp.length) break
    if (webp.toString('ascii', i, i + 4) === 'ANMF' && size >= 16) {
      const d = i + 8 + 12
      ms += webp[d] | (webp[d + 1] << 8) | (webp[d + 2] << 16)
    }
    i += 8 + size + (size & 1)
  }
  return ms
}

type Session = {
  chat: string
  sender: string
  download: () => Promise<Buffer>
  video: boolean
  maxSeconds: number
  at: number
  timer?: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Session>()
const keyOf = (chat: string, sender: string): string => `${chat}:${sender}`

const drop = (key: string): Session | undefined => {
  const s = pending.get(key)
  if (!s) return undefined
  if (s.timer) clearTimeout(s.timer)
  pending.delete(key)
  return s
}

const prune = (now = Date.now()): void => {
  for (const [key, s] of pending) if (now - s.at > TTL) drop(key)
  while (pending.size > PENDING_MAX) drop(pending.keys().next().value!)
}

// every prompt buys exactly one minute; the notice is fired from the timer so a
// silent expiry doesn't look like the bot ignoring the user
const arm = (key: string, s: Session, text: string): void => {
  if (s.timer) clearTimeout(s.timer)
  s.at = Date.now()
  s.timer = setTimeout(() => {
    if (pending.get(key) !== s) return
    drop(key)
    const sock = getSock()
    if (sock) void makeSender(sock, s.chat).text(text).catch(() => {})
  }, TTL)
  // never the reason a process stays alive (tests, shutdown)
  s.timer.unref?.()
}

const active = (chat: string, sender: string): Session | undefined => {
  const key = keyOf(chat, sender)
  const s = pending.get(key)
  if (!s) return undefined
  // the timer normally removed it already; this covers a sleeping/loaded loop
  if (Date.now() - s.at > TTL) {
    drop(key)
    return undefined
  }
  return s
}

const ownerOf = (chat: string): string | undefined => {
  const now = Date.now()
  for (const s of pending.values()) {
    if (s.chat !== chat) continue
    if (now - s.at > TTL) continue
    return s.sender
  }
  return undefined
}

const build = async (
  chat: string,
  s: Session,
  audioDownload: (() => Promise<Buffer>) | undefined,
  quoted?: WAMessage,
): Promise<void> => {
  const sock = getSock()
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-soundsticker-'))
  try {
    if (!sock) throw new Error('socket not ready')
    const [visualBuf, audioBuf] = await Promise.all([
      s.download(),
      audioDownload ? audioDownload() : Promise.resolve<Buffer | undefined>(undefined),
    ])

    const stickerIn = join(dir, s.video ? 'in.mp4' : 'in.bin')
    const stickerOut = join(dir, 'sticker.webp')
    const audioIn = join(dir, 'audio.in')
    const audioOut = join(dir, 'audio.ogg')

    await writeFile(stickerIn, visualBuf)
    // no separate audio: the native side pulls the video's own track
    await writeFile(audioIn, audioBuf ?? visualBuf)

    const packName = cfg('stickerPack', 'Wakaru')
    const author = cfg('stickerAuthor', '')
    // A video sticker's animation and its sound have to end together: the audio
    // is cut at ANIMATED seconds, so the picture has to be too (sticker.exe
    // defaults to 7 s, which leaves the tail of the sticker playing in silence).
    const trim = s.video ? ['--max-ms', String(s.maxSeconds * 1000)] : []
    const args = packName || author ? [stickerIn, stickerOut, packName, author] : [stickerIn, stickerOut]
    if (!(await runSticker(STICKER_BIN, [...trim, ...args], trim.length ? args : []))) {
      logger.warn('stale bin/sticker (no --max-ms): sticker may outlast its sound — rebuild with: npm run build:sticker')
    }
    const sticker = await readFile(stickerOut)

    // Sound and picture must end together: an animated sticker only plays for
    // its own length, so audio longer than that keeps going after the animation.
    const anim = animMs(sticker)
    const cap = anim > 0 ? Math.min(s.maxSeconds, anim / 1000) : s.maxSeconds

    // stdout is "seconds\tchannels" (see native/audio/src/sound.rs)
    const { stdout } = await exec(BIN, ['soundsticker', audioIn, audioOut, String(cap)], { timeout: 60_000 })
    const seconds = Number.parseFloat(stdout.trim().split('\t')[0] ?? '')
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`no audio encoded (stdout: ${stdout.trim()})`)

    await sendSoundSticker(sock, chat, {
      sticker,
      audio: await readFile(audioOut),
      // never 0: a sub-0.5 s clip (very short gif sticker) rounds to 0 and the
      // client then treats the AudioMessage as empty — silent, no error.
      seconds: Math.max(1, Math.round(seconds)),
      quoted,
    })
  } catch (err) {
    logger.error('soundsticker error:', err)
    if (sock) {
      const text = await tx(isExpiredMedia(err) ? 'mediaExpired' : 'soundstickerFailed')
      await makeSender(sock, chat, quoted).text(text).catch(() => {})
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** `.ss` entry point: capture the visual half and ask for the sound. */
export const startSoundSticker = async (ctx: CommandContext): Promise<void> => {
  const self = { mtype: ctx.mtype, mimetype: ctx.mimetype, download: ctx.download }
  const quoted = ctx.quoted
  const visual = picture(self.mtype, self.mimetype)
    ? self
    : quoted && picture(quoted.mtype, quoted.mimetype)
      ? quoted
      : undefined

  if (!visual) return ctx.reply(await tx('soundstickerUsage'))
  if (!existsSync(BIN)) return ctx.reply(await tx('soundstickerNotBuilt'))
  if (!existsSync(STICKER_BIN)) return ctx.reply(await tx('notBuilt'))

  const video = isVideo(visual.mtype)

  // sound already in hand (caption `.ss` on a photo that quotes a voice note, or
  // the other way round): no reason to ask again
  const other = visual === self ? quoted : self
  if (other && sound(other.mtype, other.mimetype)) {
    const s: Session = {
      chat: ctx.chat,
      sender: ctx.sender,
      download: visual.download,
      video,
      maxSeconds: video ? ANIMATED : VISUAL,
      at: Date.now(),
    }
    // run() is already inside the command slot pool
    return build(ctx.chat, s, other.download, ctx.quoted?.msg)
  }

  prune()
  const key = keyOf(ctx.chat, ctx.sender)
  drop(key) // a second `.ss` restarts the flow instead of stacking sessions
  const s: Session = {
    chat: ctx.chat,
    sender: ctx.sender,
    download: visual.download,
    video,
    maxSeconds: video ? ANIMATED : VISUAL,
    at: Date.now(),
  }
  pending.set(key, s)
  arm(key, s, await tx('soundstickerTimeout'))

  if (!video) return ctx.reply(await tx('soundstickerAskAudio'))

  try {
    await ctx.sendButtons(
      [
        { id: 'ss:video', text: await tx('soundstickerUseVideo') },
        { id: 'ss:audio', text: await tx('soundstickerSendAudio') },
      ],
      await tx('soundstickerPickSound'),
      await tx('soundstickerFooter'),
    )
  } catch (err) {
    drop(key)
    throw err
  }
}

/**
 * Follow-up half of the flow. Returns true when the message belonged to a
 * `.ss` session (so the dispatcher must not process it further).
 */
export const handleSoundStickerInput = async (
  msg: WAMessage,
  m: SerializedMessage,
  sender: string,
): Promise<boolean> => {
  const bid = m.button?.id
  const isButton = !!bid?.startsWith('ss:')
  const session = active(m.chat, sender)

  if (!session) {
    if (!isButton) return false
    // tap after the timeout, or someone else's button
    const other = ownerOf(m.chat)
    const sock = getSock()
    if (sock) {
      const text = other
        ? await tx('soundstickerNotYours', { who: other.split(/[:@]/)[0] })
        : await tx('soundstickerStale')
      await makeSender(sock, m.chat, msg).text(text).catch(() => {})
    }
    return true
  }

  const key = keyOf(m.chat, sender)
  const speak = async (text: string): Promise<void> => {
    const sock = getSock()
    if (sock) await makeSender(sock, m.chat, msg).text(text).catch(() => {})
  }

  // heavy work stays off the dispatch loop, in the same global slot pool as commands
  const fire = (audio?: () => Promise<Buffer>): void => {
    const s = drop(key)
    if (!s) return
    void withSlot(() => build(m.chat, s, audio, msg)).catch((err) => logger.error('soundsticker error:', err))
  }

  if (bid === 'ss:audio') {
    arm(key, session, await tx('soundstickerTimeout'))
    await speak(await tx('soundstickerAskSeparate'))
    return true
  }
  if (bid === 'ss:video' && session.video) {
    // the video already carries the sound
    fire()
    return true
  }
  if (isButton) {
    // a button that doesn't fit this session (e.g. a photo session) must not
    // fall through to the AI fallback
    await speak(await tx('soundstickerStale'))
    return true
  }
  // the sender's next audio is the answer — a command caption on it (e.g. an
  // audio file sent with `.ss`) should not cancel an explicit pending session
  if (sound(m.mtype, m.mimetype)) {
    fire(m.download)
    return true
  }
  if (CANCEL.has(m.text.trim().toLowerCase().replace(/^[^a-z0-9]+/, ''))) {
    drop(key)
    await speak(await tx('soundstickerCancelled'))
    return true
  }
  return false
}

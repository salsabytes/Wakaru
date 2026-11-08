import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { wakafy } from './wakafy.ts'
import { logger } from './logger.ts'

const exec = promisify(execFile)

// `audio extract` lifts the AAC track out of a normal mp4 (samples copied, no
// re-encode) — the last resort when every wakafy audio route refuses a video
const AUDIO_BIN = join(import.meta.dirname, '..', '..', 'bin', process.platform === 'win32' ? 'audio.exe' : 'audio')

const audioFromVideo = async (buf: Buffer): Promise<Buffer | null> => {
  if (!existsSync(AUDIO_BIN)) return null
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-ytaudio-'))
  try {
    const input = join(dir, 'in.mp4')
    const output = join(dir, 'out.m4a')
    await writeFile(input, buf)
    await exec(AUDIO_BIN, ['extract', input, output], { timeout: 120_000 })
    return await readFile(output)
  } catch (err) {
    logger.warn('yt audio extract failed:', (err as Error).message.slice(0, 120))
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// default is a direct m4a; format=mp3 asks the API to transcode, which is a
// different extraction path upstream — the fallback when the direct one 422s
const wakafyAudio = (rawUrl: string, format?: 'mp3') =>
  wakafy.file('/v1/media/ytmp3', format ? { url: rawUrl, format } : { url: rawUrl }, { strip: /\.(mp3|m4a|webm|opus)$/i })
const wakafyVideo = (rawUrl: string) => wakafy.file('/v1/media/ytmp4', { url: rawUrl }, { strip: /\.mp4$/i })

const videoIdOf = (rawUrl: string): string | undefined => {
  const m = rawUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|(?:embed|live)\/([A-Za-z0-9_-]{11})|[?&]v=([A-Za-z0-9_-]{11})/)
  return (m && (m[1] ?? m[2] ?? m[3] ?? m[4])) || undefined
}

// disk cache by video id — repeat requests (the norm in groups) skip the download
const CACHE_DIR = join(import.meta.dirname, '..', '..', 'bin', 'cache')
const CACHE_MAX = 150 * 1024 * 1024

const cacheGet = async (vid: string, ext: 'mp3' | 'm4a' | 'mp4'): Promise<{ buf: Buffer; title: string } | null> => {
  try {
    const [buf, title] = await Promise.all([
      readFile(join(CACHE_DIR, `${vid}.${ext}`)),
      readFile(join(CACHE_DIR, `${vid}.${ext}.title`), 'utf8'),
    ])
    return { buf, title }
  } catch {
    return null
  }
}

const cachePut = async (vid: string, ext: 'mp3' | 'm4a' | 'mp4', buf: Buffer, title: string) => {
  await mkdir(CACHE_DIR, { recursive: true })
  // over cap → wipe all (no LRU, cache is just a nicety)
  try {
    const files = await readdir(CACHE_DIR)
    let total = 0
    for (const f of files) total += (await stat(join(CACHE_DIR, f))).size
    if (total > CACHE_MAX) for (const f of files) await rm(join(CACHE_DIR, f), { force: true })
  } catch {}
  await Promise.all([
    writeFile(join(CACHE_DIR, `${vid}.${ext}`), buf),
    writeFile(join(CACHE_DIR, `${vid}.${ext}.title`), title),
  ])
  // superseded entry: wakafy flipped default mp3→m4a, so eagerly evict the
  // stale transcoded mp3 instead of leaving it orphaned until a cap wipe
  if (ext === 'm4a') {
    await rm(join(CACHE_DIR, `${vid}.mp3`), { force: true }).catch(() => {})
    await rm(join(CACHE_DIR, `${vid}.mp3.title`), { force: true }).catch(() => {})
  }
}

// m4a carries an ftyp box at byte 4, mp3 starts with an ID3/0xFF frame
const audioExt = (buf: Buffer): 'm4a' | 'mp3' => (buf.subarray(4, 8).toString() === 'ftyp' ? 'm4a' : 'mp3')

export async function downloadYouTube(url: string, mode: 'audio' | 'video') {
  // audio is cached under the format we actually got (m4a normally, mp3 when the
  // direct route failed) so a stale transcoded entry is never served as the other
  const vid = videoIdOf(url)
  if (vid) {
    for (const ext of mode === 'audio' ? (['m4a', 'mp3'] as const) : (['mp4'] as const)) {
      const hit = await cacheGet(vid, ext)
      if (hit) return hit
    }
  }
  // both modes are single direct downloads from wakafy (720p default for video)
  let buf: Buffer
  let title: string
  if (mode === 'audio') {
    // the direct m4a route 422s on a fair share of videos; the transcoded mp3
    // route is served by a different pipeline and often still works
    try {
      const got = await wakafyAudio(url)
      buf = got.buf
      title = got.title
    } catch (err) {
      logger.warn('yt audio direct failed, retrying as mp3:', (err as Error).message.slice(0, 120))
      try {
        const got = await wakafyAudio(url, 'mp3')
        buf = got.buf
        title = got.title
      } catch (err2) {
        // both audio routes refused, but ytmp4 still serves the video for almost
        // every one of these — pull the sound out of it instead of failing
        const got = await wakafyVideo(url)
        const extracted = await audioFromVideo(got.buf)
        if (!extracted) throw err2
        logger.info('yt audio recovered from mp4:', (extracted.length / 1024 / 1024).toFixed(1) + 'MB')
        buf = extracted
        title = got.title
      }
    }
  } else {
    const got = await wakafyVideo(url)
    buf = got.buf
    title = got.title
  }
  if (vid) await cachePut(vid, mode === 'audio' ? audioExt(buf) : 'mp4', buf, title).catch(() => {})
  return { buf, title } as const
}

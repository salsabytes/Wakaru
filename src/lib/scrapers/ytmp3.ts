import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { wakafy } from './wakafy.ts'

const wakafyAudio = (rawUrl: string) => wakafy.file('/v1/media/ytmp3', { url: rawUrl }, { strip: /\.(mp3|m4a|webm|opus)$/i })
const wakafyVideo = (rawUrl: string) => wakafy.file('/v1/media/ytmp4', { url: rawUrl }, { strip: /\.mp4$/i })

const videoIdOf = (rawUrl: string): string | undefined => {
  const m = rawUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|(?:embed|live)\/([A-Za-z0-9_-]{11})|[?&]v=([A-Za-z0-9_-]{11})/)
  return (m && (m[1] ?? m[2] ?? m[3] ?? m[4])) || undefined
}

// disk cache by video id — repeat requests (the norm in groups) skip the download
const CACHE_DIR = join(import.meta.dirname, '..', '..', '..', 'bin', 'cache')
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

export async function download(url: string, mode: 'audio' | 'video') {
  // audio comes from wakafy as direct m4a now (mp3 only via ?format=mp3) —
  // key the cache by the real format so stale transcoded .mp3 entries
  // from before the flip are never served again
  const ext = mode === 'audio' ? 'm4a' : 'mp4'
  const vid = videoIdOf(url)
  if (vid) {
    const hit = await cacheGet(vid, ext)
    if (hit) return hit
  }
  // both modes are single direct downloads from wakafy (720p default for video)
  let buf: Buffer
  let title: string
  if (mode === 'audio') {
    const got = await wakafyAudio(url)
    buf = got.buf
    title = got.title
  } else {
    const got = await wakafyVideo(url)
    buf = got.buf
    title = got.title
  }
  if (vid) await cachePut(vid, ext, buf, title).catch(() => {})
  return { buf, title } as const
}
